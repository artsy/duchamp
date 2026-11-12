#!/usr/bin/env bash
# PreToolUse hook for the autofix fix agent.
# Usage: fix-guard.sh <repo dir> <out dir> <packet dir>
#
# Exit 2 blocks the call and shows stderr to the model. Permission rules say the same
# things; this hook holds even if the target repo's own .claude/settings.json widens
# them, because a hook's block wins over any allow rule.

set -euo pipefail

block() {
  echo "BLOCKED by fix-guard.sh: $1" >&2
  exit 2
}
# Exit 1 would only warn and let the call through, so any failure here blocks.
trap 'block "hook error"' ERR

# Python resolves every path (symlinks included, missing tails allowed) so the checks
# below compare real locations. -I keeps it from importing anything from the cwd.
parsed="$(mktemp)"
python3 -I -c '
import json, os, sys
repo, out, packet = (os.path.realpath(p) for p in sys.argv[1:4])
skills = os.path.realpath(os.path.expanduser("~/.claude/skills"))
data = json.load(sys.stdin)
tool = data.get("tool_name", "")
args = data.get("tool_input") or {}
value = args.get("command") or args.get("file_path") or args.get("notebook_path") or args.get("path") or ""
value = str(value)
target = os.path.realpath(os.path.join(repo, value)) if value else ""
sys.stdout.write("\0".join([tool, value, target, repo, out, packet, skills]) + "\0")
' "$1" "$2" "$3" > "$parsed"
fields=()
while IFS= read -r -d '' field; do fields+=("$field"); done < "$parsed"
rm -f "$parsed"
[ "${#fields[@]}" -eq 7 ] || block "could not read the tool call"
tool="${fields[0]}"
value="${fields[1]}"
target="${fields[2]}"
repo="${fields[3]}"
out="${fields[4]}"
packet="${fields[5]}"
skills="${fields[6]}"

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
    # Only plain `git log` and `git blame`. No shell syntax, and no options that
    # write files or run diff drivers.
    [[ "$value" =~ ^git\ (log|blame)(\ |$) ]] || block "only git log and git blame may run"
    [[ "$value" != *[\;\&\|\`\$\<\>\(\)\{\}\\]* ]] || block "shell syntax is not allowed"
    [[ "$value" != *$'\n'* ]] || block "one command per call"
    [[ ! "$value" =~ --output(=|\ |$)|--ext-diff|--textconv ]] || block "git option not allowed"
    exit 0
    ;;
  WebFetch | WebSearch | mcp__*)
    block "$tool is not available in this job"
    ;;
  Read | Grep | Glob)
    # The workspace sits under $HOME on GitHub runners, so this is an allowlist
    # rather than a deny on ~.
    [ -n "$value" ] || exit 0
    case "$target/" in
      */.git/*) block "the .git directory is off limits" ;;
      "$repo"/* | "$packet"/* | "$out"/* | "$skills"/*) exit 0 ;;
      *) block "$value is outside the repo and the error packet" ;;
    esac
    ;;
esac

exit 0
