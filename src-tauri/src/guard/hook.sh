#!/bin/sh
# Installed by GitSwitch (Settings > Commit guard). GitSwitch rewrites this file, so don't edit it.
# One copy per hook name. For commit-msg it first removes Co-authored-by lines that match the list
# (and stops a commit whose author matches); then every hook hands off to the hook git would have
# run without GitSwitch.
hook=${0##*/}
dir=$(dirname -- "$0")
next=""

if [ "$hook" = commit-msg ] && [ -f "$dir/gitswitch-blocked" ] && [ -f "$1" ]; then
  # 1. Co-authored-by lines that match the list are removed, and the commit goes on.
  #    Fixed-string, case-insensitive. Comment lines and the `commit -v` diff below the
  #    scissors are left alone; trailing blank lines left behind are dropped.
  removed="$1.gitswitch-removed"
  if awk -v list="$dir/gitswitch-blocked" -v removed="$removed" '
    BEGIN {
      while ((getline line < list) > 0) {
        sub(/\r$/, "", line); sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
        if (line != "" && substr(line, 1, 1) != "#") pats[++n] = tolower(line)
      }
    }
    $0 == "# ------------------------ >8 ------------------------" { cut = 1 }
    !cut && /^[ \t]*[Cc][Oo]-[Aa][Uu][Tt][Hh][Oo][Rr][Ee][Dd]-[Bb][Yy]:/ {
      low = tolower($0)
      for (i = 1; i <= n; i++) if (index(low, pats[i])) { print > removed; next }
    }
    !cut && /^[ \t]*$/ { blanks = blanks $0 "\n"; next }
    { printf "%s", blanks; blanks = ""; print }
  ' "$1" >"$1.gitswitch-tmp"; then
    if [ -s "$removed" ]; then
      cat "$1.gitswitch-tmp" >"$1"
      sed 's/^[[:space:]]*/GitSwitch removed: /' "$removed" >&2
    fi
  fi
  rm -f "$1.gitswitch-tmp" "$removed"

  # 2. The author can't be rewritten from a hook, so a blocked author stops the commit.
  author=$(git var GIT_AUTHOR_IDENT 2>/dev/null | sed 's/ [0-9][0-9]* [-+][0-9][0-9]*$//')
  while IFS= read -r entry || [ -n "$entry" ]; do
    entry=$(printf '%s' "$entry" | tr -d '\r')
    case "$entry" in '' | '#'*) continue ;; esac
    if printf '%s\n' "$author" | grep -iqF -- "$entry"; then
      {
        echo "GitSwitch stopped this commit: the author \"$author\""
        echo "matches \"$entry\" on your list. Commit as yourself, or edit the list in GitSwitch > Settings."
      } >&2
      exit 1
    fi
  done <"$dir/gitswitch-blocked"
fi

if [ -f "$dir/gitswitch-previous" ]; then
  previous=$(cat "$dir/gitswitch-previous")
  [ -n "$previous" ] && next="$previous/$hook"
fi
if [ -z "$next" ]; then
  # Not `rev-parse --git-path hooks`: that resolves to this folder. Linked worktrees share the common dir.
  common=$(git rev-parse --git-common-dir 2>/dev/null) && next="$common/hooks/$hook"
fi
if [ -n "$next" ] && [ -f "$next" ] && [ -x "$next" ]; then
  exec "$next" "$@"
fi
exit 0
