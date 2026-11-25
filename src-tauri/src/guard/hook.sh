#!/bin/sh
# Installed by GitSwitch (Settings > Commit guard). GitSwitch rewrites this file, so don't edit it.
# One copy per hook name. For commit-msg it first checks the author and Co-authored-by lines against
# the blocked list; then every hook hands off to the hook git would have run without GitSwitch.
hook=${0##*/}
dir=$(dirname -- "$0")
next=""

if [ "$hook" = commit-msg ] && [ -f "$dir/gitswitch-blocked" ] && [ -f "$1" ]; then
  author=$(git var GIT_AUTHOR_IDENT 2>/dev/null | sed 's/ [0-9][0-9]* [-+][0-9][0-9]*$//')
  # Drop comment lines and everything below the `commit -v` scissors, then take every
  # Co-authored-by line. Not `interpret-trailers --parse`: it skips a final paragraph that
  # mixes prose and trailers, while GitHub still credits the co-author there.
  coauthors=$(sed -e '/^# -\{24\} >8 -\{24\}$/,$d' -e '/^#/d' "$1" |
    grep -i '^[[:space:]]*co-authored-by:')
  while IFS= read -r entry || [ -n "$entry" ]; do
    entry=$(printf '%s' "$entry" | tr -d '\r')
    case "$entry" in '' | '#'*) continue ;; esac
    hit=""
    if printf '%s\n' "$author" | grep -iqF -- "$entry"; then
      hit="Author: $author"
    elif [ -n "$coauthors" ]; then
      hit=$(printf '%s\n' "$coauthors" | grep -iF -- "$entry" | head -n 1)
    fi
    if [ -n "$hit" ]; then
      {
        echo "GitSwitch blocked this commit:"
        echo "  $hit"
        echo "  matches \"$entry\" on your blocked list."
        echo "Remove that line from the message or change the author, or edit the list in GitSwitch > Settings."
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
