# Source

Adapted from two skills, both MIT:

- [Warp's `merge-risk`](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/merge-risk/SKILL.md)
  at commit `8792394`, copyright Denver Technologies, Inc. It credits Matt Pocock's
  [`pr` skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/pr/SKILL.md).
  Source of the categories, verdicts, weights, thresholds and output format.
- [Cursor's `blast-radius`](https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/blast-radius/SKILL.md)
  at commit `bb68f23`, copyright Lauren Tan. Source of the blast-radius steps, the "one
  fact it's safe because of", and the levels of proof.

Changes from upstream:

- One skill. Blast radius feeds the Impact rating and a "Safe because" line instead of
  a separate writeup.
- Proof stops at level 3 ("walked it"). The reviewer has no Bash beyond git and gh, so
  it can't run a script; it names one under "Before you merge" instead.
- Dropped blast-radius's references to `how`, `why`, `arena` and `unslop`. The review
  runs `plain-english` as its last pass.
- The block goes in the review summary, rates the whole PR even on a re-review, and
  sends real bugs through the normal findings instead of repeating them.
- Wording tightened; Artsy examples for one-way doors.
