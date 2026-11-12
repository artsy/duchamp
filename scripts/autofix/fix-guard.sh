#!/usr/bin/env bash
# PreToolUse hook for the autofix fix agent.
# Usage: fix-guard.sh <repo dir> <out dir> <packet dir>
#
# Exit 2 blocks the call and shows stderr to the model. Permission rules say the same
# things; this hook holds even if the target repo's own .claude/settings.json widens
# them, because a hook's block wins over any allow rule.

set -Eeuo pipefail

block() {
  echo "BLOCKED by fix-guard.sh: $1" >&2
  exit 2
}
# Exit 1 would only warn and let the call through, so any failure here blocks.
# set -E makes the trap fire inside functions too.
trap 'block "hook error"' ERR

# Python resolves every path (symlinks included, missing tails allowed) so the checks
# below compare real locations. -I keeps it from importing anything from the cwd.
parsed="$(mktemp)"
python3 -I -c '
import fnmatch, json, os, re, sys
repo, out, packet = (os.path.realpath(p) for p in sys.argv[1:4])
skills = os.path.realpath(os.path.expanduser("~/.claude/skills"))
data = json.load(sys.stdin)
tool = data.get("tool_name", "")
args = data.get("tool_input") or {}
key = {"Bash": "command", "NotebookEdit": "notebook_path", "Grep": "path", "Glob": "path"}.get(tool, "file_path")
value = str(args.get(key) or "")
target = os.path.realpath(os.path.join(repo, value)) if value else ""
glob = str(args.get({"Glob": "pattern", "Grep": "glob"}.get(tool, "")) or "")
# A bare * or ** is left to the tools, which skip .git themselves.
glob_git = any(
    seg not in ("*", "**") and fnmatch.fnmatchcase(".git", seg.lower())
    for seg in re.split(r"[/{},]", glob) if seg
)
sys.stdout.write("\0".join([tool, value, target, repo, out, packet, skills, glob, str(int(glob_git))]) + "\0")
' "$1" "$2" "$3" > "$parsed"
fields=()
while IFS= read -r -d '' field; do fields+=("$field"); done < "$parsed"
rm -f "$parsed"
[ "${#fields[@]}" -eq 9 ] || block "could not read the tool call"
tool="${fields[0]}"
value="${fields[1]}"
target="${fields[2]}"
repo="${fields[3]}"
out="${fields[4]}"
packet="${fields[5]}"
skills="${fields[6]}"
glob="${fields[7]}"
glob_git="${fields[8]}"

path_re='^[A-Za-z0-9_][A-Za-z0-9_./-]*$'
rev='([0-9a-fA-F]{7,40}|HEAD(~[0-9]{1,4})?)'
range_re="^$rev(\\.\\.$rev)?\$"
rev_re="^$rev\$"

repo_path() {
  [[ "$1" =~ $path_re ]] || block "$1 is not a plain repo-relative path"
  [[ "/$1" != */.* ]] || block "$1 has a dot-file, dot-directory or .."
}

# -p, --stat and -S run diff machinery, so they need external diff and textconv off.
check_log() {
  local word expect="" paths=0 diff=0 no_ext=0 no_textconv=0
  for word in "$@"; do
    if [ "$expect" = count ]; then
      [[ "$word" =~ ^[0-9]{1,4}$ ]] || block "-n needs a number"
      expect=""
      continue
    fi
    if [ "$paths" = 1 ]; then
      repo_path "$word"
      continue
    fi
    case "$word" in
      --) paths=1 ;;
      --oneline | --follow | --no-merges | --first-parent | --reverse) ;;
      --date=short | --date=iso | --date=relative) ;;
      --no-ext-diff) no_ext=1 ;;
      --no-textconv) no_textconv=1 ;;
      -p | --patch | --stat) diff=1 ;;
      -n) expect=count ;;
      *)
        if [[ "$word" =~ ^(-n?|--max-count=)[0-9]{1,4}$ ]]; then
          :
        elif [[ "$word" =~ ^--(format|pretty)=[A-Za-z0-9%:,._-]+$ ]]; then
          # %G placeholders run gpg to check signatures.
          [[ "$word" != *%G* ]] || block "%G placeholders are not allowed"
        elif [[ "$word" =~ ^--(since|until|after|before)=[A-Za-z0-9.:,_-]+$ ]]; then
          :
        elif [[ "$word" =~ ^--author=[A-Za-z0-9.@_-]+$ ]]; then
          :
        elif [[ "$word" =~ ^-S[A-Za-z0-9_.:]+$ ]]; then
          diff=1
        elif [[ "$word" =~ $range_re ]]; then
          :
        else
          block "git log option not allowed: $word"
        fi
        ;;
    esac
  done
  [ -z "$expect" ] || block "-n needs a number"
  if [ "$diff" = 1 ] && { [ "$no_ext" = 0 ] || [ "$no_textconv" = 0 ]; }; then
    block "-p, --stat and -S need --no-ext-diff --no-textconv"
  fi
}

check_blame() {
  local word expect="" dashdash=0 revs=0 files=0
  for word in "$@"; do
    if [ "$expect" = lines ]; then
      [[ "$word" =~ ^[0-9]{1,6},[0-9]{1,6}$ ]] || block "-L needs <start>,<end>"
      expect=""
      continue
    fi
    if [ "$dashdash" = 0 ]; then
      case "$word" in
        --) dashdash=1; continue ;;
        -w | -M | -C | --no-textconv) continue ;;
        -L) expect=lines; continue ;;
      esac
      if [[ "$word" =~ ^-L[0-9]{1,6},[0-9]{1,6}$ ]]; then
        continue
      fi
      if [[ "$word" =~ $rev_re ]] && [ "$revs" = 0 ] && [ "$files" = 0 ]; then
        revs=1
        continue
      fi
      [[ "$word" != -* ]] || block "git blame option not allowed: $word"
    fi
    repo_path "$word"
    files=$((files + 1))
  done
  [ -z "$expect" ] || block "-L needs <start>,<end>"
  [ "$files" = 1 ] || block "git blame takes exactly one path"
}

glob_in_repo() {
  [ -n "$glob" ] || return 0
  [[ "$glob" != /* && "$glob" != *~* ]] || block "$glob is not relative to the repo"
  [[ "$glob" != *\\* ]] || block "$glob has a backslash escape"
  [[ ! "$glob" =~ (^|[/{,])\.\.($|[/},]) ]] || block "$glob climbs out with .."
  [[ ! "$glob" =~ [{,]/ ]] || block "$glob is not relative to the repo"
  [ "$glob_git" = 0 ] || block "$glob can match the .git directory"
}

case "$tool" in
  Edit | Write | MultiEdit | NotebookEdit)
    [ -n "$value" ] || block "$tool without a path"
    if [ "$target" = "$out/result.json" ] || [ "$target" = "$out/pr-body.md" ]; then
      exit 0
    fi
    rel="${target#"$repo"/}"
    [ "$rel" != "$target" ] || block "$value is outside the repo"
    [[ "$rel" =~ ^[A-Za-z0-9_./-]+$ ]] || block "$rel has characters outside [A-Za-z0-9_./-]"
    [[ "/$rel" != */.* ]] || block "$rel has a dot-file or dot-directory"
    case "$rel" in
      lib/tasks/*) block "lib/tasks/ is off limits" ;;
      spec/spec_helper.rb | spec/rails_helper.rb | spec/support/*) block "spec helpers and spec/support/ are off limits" ;;
      app/* | lib/* | spec/*) exit 0 ;;
      *) block "only app/, lib/ and spec/ may change, not $rel" ;;
    esac
    ;;
  Bash)
    # An allowlist: git log and git blame, each word checked against a fixed set of
    # flags. No quotes (--out"put" reaches git as --output) and no shell syntax.
    [[ "$value" =~ ^[A-Za-z0-9\ ._/:=,~%@-]+$ ]] || block "only letters, digits, spaces and ._/:=,~%@- are allowed"
    read -ra words <<<"$value"
    [ "${words[0]:-}" = git ] || block "only git log and git blame may run"
    case "${words[1]:-}" in
      log) check_log "${words[@]:2}" ;;
      blame) check_blame "${words[@]:2}" ;;
      *) block "only git log and git blame may run" ;;
    esac
    exit 0
    ;;
  Read | Grep | Glob)
    # The workspace sits under $HOME on GitHub runners, so this is an allowlist
    # rather than a deny on ~.
    glob_in_repo
    [ -n "$value" ] || exit 0
    case "$target/" in
      */.git/*) block "the .git directory is off limits" ;;
      "$repo"/* | "$packet"/* | "$out"/* | "$skills"/*) exit 0 ;;
      *) block "$value is outside the repo and the error packet" ;;
    esac
    ;;
  Skill | TodoWrite)
    exit 0
    ;;
  *)
    block "$tool is not available in this job"
    ;;
esac
