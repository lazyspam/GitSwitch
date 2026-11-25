//! Commit guard: block commits whose author or `Co-authored-by:` lines match a
//! list of names or emails (for example AI agents that sign themselves in).
//!
//! It works through a global `core.hooksPath` that points at a folder GitSwitch
//! owns. That folder holds one copy of `hook.sh` per client hook name: the
//! `commit-msg` copy runs the check, and every copy then hands off to the hook
//! git would have run without GitSwitch (the previous global hooks path, or
//! the repo's own `.git/hooks`), so existing hooks keep working.
//!
//! "Enabled" is read from git config every time, never stored, so the UI stays
//! right if someone changes `core.hooksPath` by hand.

use crate::git;
use crate::ssh::expand_path;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const HOOK_SCRIPT: &str = include_str!("hook.sh");
const BLOCKED_FILE: &str = "gitswitch-blocked";
const PREVIOUS_FILE: &str = "gitswitch-previous";
const HOOKS_PATH_KEY: &str = "core.hooksPath";

/// The client-side hooks that get a pass-through copy, because a global
/// `core.hooksPath` hides the repo's own `.git/hooks` from git. Left out on
/// purpose: `reference-transaction` and `post-index-change` fire on nearly
/// every git command, and a shell per call is slow (most of all on Windows).
const HOOK_NAMES: &[&str] = &[
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
    "pre-auto-gc",
    "post-rewrite",
    "sendemail-validate",
    "push-to-checkout",
];

/// Used until the user saves their own list: Claude Code's co-author email.
const DEFAULT_BLOCKED: &[&str] = &["noreply@anthropic.com"];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GuardState {
    pub enabled: bool,
    pub blocked: Vec<String>,
    /// A global hooks path that isn't ours: it keeps running after the check
    /// while the guard is on (or is what we'd chain to when turned on).
    pub other_hooks_path: Option<String>,
}

fn hooks_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    Ok(dir.join("hooks"))
}

/// How a path is written into git config and the hook files: forward slashes,
/// which git and its bundled `sh` both understand on Windows too.
fn config_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn same_dir(value: &str, dir: &Path) -> bool {
    let a = expand_path(value);
    let a = a.canonicalize().unwrap_or(a);
    let b = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    config_path(&a).trim_end_matches('/') == config_path(&b).trim_end_matches('/')
}

/// Trim, drop blanks and comments, and dedupe (case-insensitively). An empty
/// entry would match every commit, so it must never reach the hook.
fn clean(list: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for entry in list {
        let entry = entry.replace(['\r', '\n'], " ");
        let entry = entry.trim();
        if entry.is_empty() || entry.starts_with('#') {
            continue;
        }
        if !out.iter().any(|e| e.eq_ignore_ascii_case(entry)) {
            out.push(entry.to_string());
        }
    }
    out
}

fn read_blocked(dir: &Path) -> Vec<String> {
    match fs::read_to_string(dir.join(BLOCKED_FILE)) {
        Ok(text) => clean(&text.lines().map(str::to_string).collect::<Vec<_>>()),
        Err(_) => DEFAULT_BLOCKED.iter().map(|s| s.to_string()).collect(),
    }
}

fn write_file(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

fn install_scripts(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    // LF only: a CRLF checkout on Windows would break the shebang.
    let script = HOOK_SCRIPT.replace("\r\n", "\n");
    for name in HOOK_NAMES {
        let path = dir.join(name);
        write_file(&path, &script)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Could not make {} executable: {e}", path.display()))?;
        }
    }
    Ok(())
}

pub fn state_in(dir: &Path) -> GuardState {
    let current = git::global(HOOKS_PATH_KEY);
    let enabled = current.as_deref().is_some_and(|v| same_dir(v, dir));
    let other_hooks_path = if enabled {
        fs::read_to_string(dir.join(PREVIOUS_FILE))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        current
    };
    GuardState {
        enabled,
        blocked: read_blocked(dir),
        other_hooks_path,
    }
}

pub fn apply_in(dir: &Path, enabled: bool, blocked: &[String]) -> Result<GuardState, String> {
    let blocked = clean(blocked);
    fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    write_file(&dir.join(BLOCKED_FILE), &(blocked.join("\n") + "\n"))?;

    let current = git::global(HOOKS_PATH_KEY);
    let ours = current.as_deref().is_some_and(|v| same_dir(v, dir));

    if enabled {
        install_scripts(dir)?;
        if !ours {
            // Remember what was there so it keeps running, and comes back on disable.
            let previous = current
                .map(|v| config_path(&expand_path(&v)))
                .unwrap_or_default();
            write_file(&dir.join(PREVIOUS_FILE), &previous)?;
            git::set_global(HOOKS_PATH_KEY, &config_path(dir))?;
        }
    } else if ours {
        let previous = fs::read_to_string(dir.join(PREVIOUS_FILE)).unwrap_or_default();
        let previous = previous.trim();
        if previous.is_empty() {
            git::unset_global(HOOKS_PATH_KEY)?;
        } else {
            git::set_global(HOOKS_PATH_KEY, previous)?;
        }
        let _ = fs::remove_file(dir.join(PREVIOUS_FILE));
    }
    Ok(state_in(dir))
}

#[tauri::command(async)]
pub fn get_commit_guard(app: AppHandle) -> Result<GuardState, String> {
    Ok(state_in(&hooks_dir(&app)?))
}

#[tauri::command(async)]
pub fn set_commit_guard(
    app: AppHandle,
    enabled: bool,
    blocked: Vec<String>,
) -> Result<GuardState, String> {
    apply_in(&hooks_dir(&app)?, enabled, &blocked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_drops_blanks_comments_and_duplicates() {
        let input = vec![
            "  noreply@anthropic.com ".to_string(),
            "".to_string(),
            "   ".to_string(),
            "# note".to_string(),
            "NOREPLY@anthropic.com".to_string(),
            "two\nlines".to_string(),
        ];
        assert_eq!(clean(&input), vec!["noreply@anthropic.com", "two lines"]);
    }

    #[test]
    fn script_has_no_carriage_returns() {
        assert!(!HOOK_SCRIPT.contains('\r'));
        assert!(HOOK_SCRIPT.starts_with("#!/bin/sh\n"));
    }
    /// Turn on and off against a throwaway global git config, never the real one.
    #[test]
    fn enable_disable_round_trips_the_previous_hooks_path() {
        let root = std::env::temp_dir().join(format!("gitswitch-guard-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dir = root.join("App Support").join("hooks");
        fs::create_dir_all(&root).unwrap();
        // The only test in this crate that touches the environment or runs git.
        std::env::set_var("GIT_CONFIG_GLOBAL", root.join("gitconfig"));
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        let blocked = vec!["noreply@anthropic.com".to_string(), " ".to_string()];

        // Nothing set before: on, then off unsets it again.
        let on = apply_in(&dir, true, &blocked).unwrap();
        assert!(on.enabled);
        assert_eq!(on.blocked, vec!["noreply@anthropic.com"]);
        assert_eq!(on.other_hooks_path, None);
        assert!(dir.join("commit-msg").exists() && dir.join("pre-push").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join("commit-msg"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o111, 0o111);
        }
        let off = apply_in(&dir, false, &blocked).unwrap();
        assert!(!off.enabled);
        assert_eq!(git::global(HOOKS_PATH_KEY), None);

        // A path the user already had is chained, survives a second "on", and comes back.
        git::set_global(HOOKS_PATH_KEY, "/opt/team-hooks").unwrap();
        assert_eq!(
            state_in(&dir).other_hooks_path.as_deref(),
            Some("/opt/team-hooks")
        );
        apply_in(&dir, true, &blocked).unwrap();
        let again = apply_in(&dir, true, &blocked).unwrap();
        assert!(again.enabled);
        assert_eq!(again.other_hooks_path.as_deref(), Some("/opt/team-hooks"));
        apply_in(&dir, false, &blocked).unwrap();
        assert_eq!(
            git::global(HOOKS_PATH_KEY).as_deref(),
            Some("/opt/team-hooks")
        );

        // The list is remembered while off.
        assert_eq!(state_in(&dir).blocked, vec!["noreply@anthropic.com"]);
        let _ = fs::remove_dir_all(&root);
    }
}
