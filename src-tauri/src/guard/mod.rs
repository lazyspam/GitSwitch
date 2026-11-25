//! Commit guard: strips `Co-authored-by:` lines matching a list (AI agents that
//! sign your commits) and stops commits whose author matches.
//!
//! A global `core.hooksPath` points at a folder GitSwitch owns. Every hook there
//! is the same script: `commit-msg` cleans the message, then each hook hands off
//! to whatever git would have run without us (the previous global hooks path, or
//! the repo's own `.git/hooks`). "Enabled" is read from git config, never stored.

use crate::git;
use crate::ssh::expand_path;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const LIST: &str = "gitswitch-blocked";
const PREVIOUS: &str = "gitswitch-previous";
const KEY: &str = "core.hooksPath";
const DEFAULT: &str = "noreply@anthropic.com";

/// Left out: `reference-transaction` and `post-index-change` fire on nearly
/// every git command, and a shell per call is slow (most of all on Windows).
#[rustfmt::skip]
const HOOKS: &[&str] = &[
    "applypatch-msg", "pre-applypatch", "post-applypatch", "pre-commit",
    "pre-merge-commit", "prepare-commit-msg", "commit-msg", "post-commit",
    "pre-rebase", "post-checkout", "post-merge", "pre-push", "pre-auto-gc",
    "post-rewrite", "sendemail-validate", "push-to-checkout",
];

/// POSIX sh, run by the `sh` git ships on every platform. Matching is
/// fixed-string and case-insensitive; a missing list lets everything through.
const SCRIPT: &str = r##"#!/bin/sh
# Written by GitSwitch (Settings > Commits). Rewritten on every launch; don't edit.
hook=${0##*/}; dir=$(dirname -- "$0"); list="$dir/gitswitch-blocked"; next=""

if [ "$hook" = commit-msg ] && [ -f "$list" ] && [ -f "$1" ]; then
  # Drop matching Co-authored-by lines (above the `commit -v` scissors) and the blank lines they leave.
  awk -v list="$list" -v gone="$1.gone" '
    BEGIN { while ((getline l < list) > 0) { gsub(/^[ \t]+|[ \t\r]+$/, "", l); if (l != "" && l !~ /^#/) p[++n] = tolower(l) } }
    $0 == "# ------------------------ >8 ------------------------" { cut = 1 }
    !cut && tolower($0) ~ /^[ \t]*co-authored-by:/ { for (i = 1; i <= n; i++) if (index(tolower($0), p[i])) { print > gone; next } }
    !cut && /^[ \t]*$/ { b = b $0 "\n"; next }
    { printf "%s", b; b = ""; print }
  ' "$1" > "$1.new" && [ -s "$1.gone" ] && cat "$1.new" > "$1" && sed 's/^[[:space:]]*/GitSwitch removed: /' "$1.gone" >&2
  rm -f "$1.new" "$1.gone"

  # A hook can't change the author, so a matching author stops the commit.
  author=$(git var GIT_AUTHOR_IDENT 2>/dev/null | sed 's/ [0-9]* [-+][0-9]*$//')
  while IFS= read -r e || [ -n "$e" ]; do
    e=$(printf '%s' "$e" | tr -d '\r'); case "$e" in '' | '#'*) continue ;; esac
    if printf '%s\n' "$author" | grep -iqF -- "$e"; then
      echo "GitSwitch stopped this commit: author \"$author\" matches \"$e\"." >&2; exit 1
    fi
  done < "$list"
fi

# Hand off. Not `rev-parse --git-path hooks`: that resolves back to this folder.
[ -f "$dir/gitswitch-previous" ] && prev=$(cat "$dir/gitswitch-previous") && [ -n "$prev" ] && next="$prev/$hook"
[ -z "$next" ] && common=$(git rev-parse --git-common-dir 2>/dev/null) && next="$common/hooks/$hook"
[ -f "$next" ] && [ -x "$next" ] && exec "$next" "$@"
exit 0
"##;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GuardState {
    pub enabled: bool,
    pub blocked: Vec<String>,
    /// A global hooks path that isn't ours; it runs after the check.
    pub other_hooks_path: Option<String>,
}

fn hooks_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("hooks"))
        .map_err(|e| e.to_string())
}

/// Forward slashes: what git and its `sh` expect, Windows included.
fn slash(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn is_ours(value: &str, dir: &Path) -> bool {
    let norm = |p: PathBuf| {
        slash(&p.canonicalize().unwrap_or(p))
            .trim_end_matches('/')
            .to_string()
    };
    norm(expand_path(value)) == norm(dir.to_path_buf())
}

/// Trimmed, no blanks or comments, deduped. An empty entry would match everything.
fn clean<S: AsRef<str>>(list: &[S]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in list
        .iter()
        .map(|e| e.as_ref().replace(['\r', '\n'], " ").trim().to_string())
    {
        if !e.is_empty() && !e.starts_with('#') && !out.iter().any(|o| o.eq_ignore_ascii_case(&e)) {
            out.push(e);
        }
    }
    out
}

fn read(path: PathBuf) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn write(path: PathBuf, text: &str) -> Result<(), String> {
    fs::write(&path, text).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

fn install(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for name in HOOKS {
        write(dir.join(name), SCRIPT)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join(name), fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn state_in(dir: &Path) -> GuardState {
    let current = git::global(KEY);
    let enabled = current.as_deref().is_some_and(|v| is_ours(v, dir));
    let blocked = match read(dir.join(LIST)) {
        Some(text) => clean(&text.lines().collect::<Vec<_>>()),
        None => vec![DEFAULT.to_string()],
    };
    let other_hooks_path = if enabled {
        read(dir.join(PREVIOUS)).filter(|s| !s.is_empty())
    } else {
        current
    };
    GuardState {
        enabled,
        blocked,
        other_hooks_path,
    }
}

pub fn apply_in(dir: &Path, enabled: bool, blocked: &[String]) -> Result<GuardState, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    write(dir.join(LIST), &(clean(blocked).join("\n") + "\n"))?;
    let current = git::global(KEY);
    let ours = current.as_deref().is_some_and(|v| is_ours(v, dir));
    if enabled {
        install(dir)?;
        if !ours {
            // Remember what was there: it keeps running, and comes back when turned off.
            write(
                dir.join(PREVIOUS),
                &current.map(|v| slash(&expand_path(&v))).unwrap_or_default(),
            )?;
            git::set_global(KEY, &slash(dir))?;
        }
    } else if ours {
        match read(dir.join(PREVIOUS)).filter(|s| !s.is_empty()) {
            Some(prev) => git::set_global(KEY, &prev)?,
            None => git::unset_global(KEY)?,
        }
        let _ = fs::remove_file(dir.join(PREVIOUS));
    }
    Ok(state_in(dir))
}

/// At launch: rewrite the hooks if the guard is on, so updates reach every repo.
pub fn refresh(app: &AppHandle) {
    if let Ok(dir) = hooks_dir(app) {
        if state_in(&dir).enabled {
            if let Err(e) = install(&dir) {
                eprintln!("commit guard refresh failed: {e}");
            }
        }
    }
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
        let got = clean(&[
            " noreply@anthropic.com ",
            "",
            " ",
            "# note",
            "NOREPLY@anthropic.com",
            "a\nb",
        ]);
        assert_eq!(got, ["noreply@anthropic.com", "a b"]);
        assert!(SCRIPT.starts_with("#!/bin/sh\n") && !SCRIPT.contains('\r'));
    }

    /// On and off against a throwaway global git config, never the real one.
    #[test]
    fn enable_disable_round_trips_the_previous_hooks_path() {
        let root = std::env::temp_dir().join(format!("gitswitch-guard-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dir = root.join("App Support/hooks");
        fs::create_dir_all(&root).unwrap();
        // The only test that touches the environment or runs git.
        std::env::set_var("GIT_CONFIG_GLOBAL", root.join("gitconfig"));
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        let list = vec![DEFAULT.to_string(), " ".to_string()];

        let on = apply_in(&dir, true, &list).unwrap();
        assert!(on.enabled && on.other_hooks_path.is_none());
        assert_eq!(on.blocked, [DEFAULT]);
        assert_eq!(fs::read_to_string(dir.join("pre-push")).unwrap(), SCRIPT);
        assert!(!apply_in(&dir, false, &list).unwrap().enabled);
        assert_eq!(git::global(KEY), None);

        git::set_global(KEY, "/opt/team-hooks").unwrap();
        apply_in(&dir, true, &list).unwrap();
        let again = apply_in(&dir, true, &list).unwrap(); // a second "on" must not record itself
        assert_eq!(again.other_hooks_path.as_deref(), Some("/opt/team-hooks"));
        apply_in(&dir, false, &list).unwrap();
        assert_eq!(git::global(KEY).as_deref(), Some("/opt/team-hooks"));
        assert_eq!(state_in(&dir).blocked, [DEFAULT]); // the list survives while off
        let _ = fs::remove_dir_all(&root);
    }
}
