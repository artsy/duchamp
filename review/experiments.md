# AI review experiments

Every change to the [AI PR review](README.md) that ran as an opt-in trial first, or
that rolled out and was taken back. Active experiments are independent: a PR can be in
any mix of them. Each has a `participants.yml` for enrolling authors and a label for
trying it on one PR.

| Experiment | Status | What it changes | How to join | Datadog | Created by | PR | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Lean reviews](../lean-reviews-experiment/README.md) | 🟢 Active | Cheaper, quieter reviews: AGENTS.md and the diff in the prompt, re-reviews of only what changed, Sonnet 5.5 at medium effort for small diffs, fewer inline comments, summary with cost stats | `lean-reviews-experiment/participants.yml`, or label `ai-review-lean` (old `ai-review-experiment` still works) | `group:experiment` | [@MounirDhahri](https://github.com/MounirDhahri) | [#116](https://github.com/artsy/duchamp/pull/116) |  |
| [Related repos](../related-repos-experiment/README.md) | 🟢 Active | Reads the other Artsy repos in `.claude-review.yml` `related_repos`, such as metaphysics when reviewing eigen | `related-repos-experiment/participants.yml`, or label `ai-review-related-repos` | `related_repos:true` when it read one | [@MounirDhahri](https://github.com/MounirDhahri) | [#128](https://github.com/artsy/duchamp/pull/128) |  |
| [Security](../security-experiment/README.md) | 🟢 Active | A subagent reads sensitive files only for security; the reviewer checks its leads before posting | `security-experiment/participants.yml`, or label `security-review` (starts a full review straight away, on the whole PR) | `security:true` when the pass ran | [@MounirDhahri](https://github.com/MounirDhahri) | [#146](https://github.com/artsy/duchamp/pull/146) |  |
| [Best practices](../best-practices-experiment/README.md) | 🟢 Active | Stack skills from `skills.yml`: Callstack's and Software Mansion's React Native skills and Artsy's own rules, for eigen, palette-mobile and energy | `best-practices-experiment/participants.yml`, or label `ai-review-best-practices` | `best_practices:true` when a skill ran | [@MounirDhahri](https://github.com/MounirDhahri) | [#147](https://github.com/artsy/duchamp/pull/147) |  |
| Experimental review prompt | ✅ Adopted | The skeptical, verify-before-you-claim prompt with severity markers (🔴 blocking, 🟠 required, 🔵 nit, ⚪ q) and a Request Changes / Needs Discussion / Approve verdict. Now `review/prompt.md` |  |  | [@MounirDhahri](https://github.com/MounirDhahri) | [#116](https://github.com/artsy/duchamp/pull/116) | Every review, in [#132](https://github.com/artsy/duchamp/pull/132) |
| plain-english | ✅ Adopted | The [`plain-english`](../.claude/skills/plain-english/SKILL.md) skill as a last pass over the summary and every inline comment |  |  | [@MounirDhahri](https://github.com/MounirDhahri) | [#120](https://github.com/artsy/duchamp/pull/120) | Every review, in [#132](https://github.com/artsy/duchamp/pull/132) |
| Opus 5.5 | ✅ Adopted | `claude-opus-5-5` instead of Opus 4.8, with prompt edits from Anthropic's Opus 5.5 guide |  |  | [@MounirDhahri](https://github.com/MounirDhahri) | [#125](https://github.com/artsy/duchamp/pull/125) | Every review, in [#132](https://github.com/artsy/duchamp/pull/132) |
| Opus 5 | ❌ Dismissed | `claude-opus-5` for every review, rolled out without an opt-in |  |  | [@MounirDhahri](https://github.com/MounirDhahri) | [#108](https://github.com/artsy/duchamp/pull/108) | Reverted to Opus 4.8 in [#112](https://github.com/artsy/duchamp/pull/112): reviews got chattier, with more findings that didn't hold up (see [#110](https://github.com/artsy/duchamp/pull/110)) |
| Two-pass review | ❌ Dismissed | A read-only "find" pass listing every candidate issue, then a "filter" pass that verified and posted. Behind a flag, for eigen and volt |  |  | [@MounirDhahri](https://github.com/MounirDhahri) | [#110](https://github.com/artsy/duchamp/pull/110) | Reverted with Opus 5 in [#112](https://github.com/artsy/duchamp/pull/112); it was built to tame Opus 5's noise |

[#132](https://github.com/artsy/duchamp/pull/132) made the experiment the default in one
step: its prompt, plain-english and Opus 5.5 reached every review, and the experiment
kept only what came after. A first attempt,
[#129](https://github.com/artsy/duchamp/pull/129), was reverted in
[#131](https://github.com/artsy/duchamp/pull/131) over a worry that related repos leaked
a private repo into a public PR. The logs showed related repos hadn't run on that PR,
and [#132](https://github.com/artsy/duchamp/pull/132) reapplied it.

## Adding an experiment

1. Create `<name>-experiment/participants.yml` and a README, and a label constant and
   `in<Name>` check in `scripts/build-review-prompt.ts`, following the others.
2. Tag the review in Datadog with whether the change ran, not whether the PR was in
   the group, so the dashboard compares like with like.
3. Add a row to the table above with status 🟢 Active.

When an experiment ends, set its status to ✅ Adopted or ❌ Dismissed and say in
Outcome which PR did it, and why for a dismissal.
