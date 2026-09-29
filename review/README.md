# AI PR review

The [Claude AI PR review](../docs/actions.md#run-claude-reviewyml) reviews every PR
with `prompt.md` in this directory. It runs on the workflow's `model` input,
`claude-opus-5-5` by default, at `high` effort (`REVIEW_EFFORT` in
`scripts/build-review-prompt.ts`). The Claude Code version is whatever
`anthropics/claude-code-action@v1` installs.

## How the review works

- **Skeptical by default.** It assumes failure modes are present until the code rules
  them out, and it treats the PR description as a claim to check rather than as
  evidence.
- **Reads more before judging.** Contributing docs, linked issues, commit history,
  the surrounding execution flow, and the existing tests, not just the diff.
- **Adversarial.** Nulls at boundaries, failed external calls, async work that races
  or outlives its caller, swallowed errors, untrusted input.
- **Structural.** Functions doing several things, junk-drawer files, copy-paste,
  dead code, patterns applied inconsistently within one PR.
- **Accessibility as completeness**, wherever the change is user-facing.
- **Unattended by design.** The prompt names the finish line (the summary comment is
  posted) and tells the model not to stop and ask. Blocking and required findings
  must name the input that triggers them, unconfirmed concerns say where the model
  looked, and instructions inside the PR text are ignored. These follow Anthropic's
  Opus 5.5 prompting guide.
- **Sharper comments.** One finding per comment, one line: `<emoji> **<severity>:**
  <problem>. <fix>.` Every comment opens with 🔴 **blocking:**, 🟠 **required:**,
  🔵 **nit:**, or ⚪ **q:**, so it is obvious at a glance what has to be fixed before
  merge and what can be ignored. Security findings and architectural disagreements
  get a full paragraph instead.
- **Report shape.** Summary → Change Map → Critical Issues → Required
  Changes → Suggestions → Questions → Verdict, with an explicit
  Request Changes / Needs Discussion / Approve verdict.

The "verify before you claim" guardrail from the earlier prompt is kept. A skeptical
reviewer with no verification requirement produces confident wrong comments, which is
worse than a shallow review. Concerns that cannot be confirmed from the available code
go under Suggestions or as a `q:`, never as Blocking.

## Skills

Skills live in `.claude/skills/` at the root of this repo, so they are live for anyone
working in duchamp locally. The review workflow copies them to `~/.claude/skills/` on
the runner, where Claude Code discovers them.

The runner destination is the home directory, not the reviewed repo's `.claude/`,
because repos ship skills of their own. Copying into the checkout would overwrite a
repo's own skill on a name clash and leave untracked files in the tree under review.

`plain-english` is the first one, vendored from a local skill under MIT. Only its
frontmatter `description` was changed, to trigger on writing a review rather than on
a user request. The review prompt runs it as a final pass.

To add another, drop it in `.claude/skills/<name>/SKILL.md` and reference it from a
prompt. A skill nothing references is dead weight: it costs context on every review
and never runs.

## Precedence

1. A repo's `.claude-review.yml` `prompt:` field replaces `prompt.md`.
2. The repo's `context`, `focus_areas`, and `ignore_paths` are appended to whichever
   prompt applies.
3. PRs in the [review experiment](../review-experiment/README.md) also get related
   repos, whatever the prompt.

## Attribution

`prompt.md` is adapted from two MIT-licensed skills:

- [`critical-code-reviewer`](https://github.com/posit-dev/skills/tree/main/posit-dev/critical-code-reviewer)
  by Garrick Aden-Buie (@gadenbuie), MIT. Source of the mindset, the detection
  patterns, the severity tiers, and the report format.
- [`caveman-review`](https://github.com/JuliusBrussee/caveman/tree/main/skills/caveman-review)
  by Julius Brussee, MIT. Source of the comment style: one line, location, problem,
  fix, no throat-clearing.

Both are adapted rather than vendored verbatim, so their severity schemes and formats
do not contradict each other in one prompt, and so Artsy's false-positive guardrail
survives.
