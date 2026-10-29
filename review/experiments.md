# AI review experiments

Every change to the [AI PR review](README.md) that ran as an opt-in trial first, or
that rolled out and was taken back. Active experiments are independent: a PR can be in
any mix of them. Each has a `participants.yml` for enrolling authors and a label for
trying it on one PR.

## Active

| Experiment | What it changes | Join | Label for one PR | Datadog | Created by | PR |
| --- | --- | --- | --- | --- | --- | --- |
| [Lean reviews](../lean-reviews-experiment/README.md) | Cheaper, quieter reviews: AGENTS.md and the diff in the prompt, re-reviews of only what changed, Sonnet 5.5 at medium effort for small diffs, fewer inline comments, summary with cost stats | `lean-reviews-experiment/participants.yml` | `ai-review-lean` (old `ai-review-experiment` still works) | `group:experiment` | [@MounirDhahri](https://github.com/MounirDhahri) | [#116](https://github.com/artsy/duchamp/pull/116) |
| [Related repos](../related-repos-experiment/README.md) | Reads the other Artsy repos in `.claude-review.yml` `related_repos`, such as metaphysics when reviewing eigen | `related-repos-experiment/participants.yml` | `ai-review-related-repos` | `related_repos:true` when it read one | [@MounirDhahri](https://github.com/MounirDhahri) | [#128](https://github.com/artsy/duchamp/pull/128) |
| [Security](../security-experiment/README.md) | A subagent reads sensitive files only for security; the reviewer checks its leads before posting | `security-experiment/participants.yml` | `security-review` (starts a full review straight away, on the whole PR) | `security:true` when the pass ran | [@MounirDhahri](https://github.com/MounirDhahri) | [#146](https://github.com/artsy/duchamp/pull/146) |
| [Best practices](../best-practices-experiment/README.md) | Stack skills from `skills.yml`: Callstack's and Software Mansion's React Native skills and Artsy's own rules, for eigen, palette-mobile and energy | `best-practices-experiment/participants.yml` | `ai-review-best-practices` | `best_practices:true` when a skill ran | [@MounirDhahri](https://github.com/MounirDhahri) | [#147](https://github.com/artsy/duchamp/pull/147) |

## Adopted for everyone

| Experiment | What it changed | Created by | PR | Adopted in |
| --- | --- | --- | --- | --- |
| Experimental review prompt | The skeptical, verify-before-you-claim prompt with severity markers (🔴 blocking, 🟠 required, 🔵 nit, ⚪ q) and a Request Changes / Needs Discussion / Approve verdict. Now `review/prompt.md` | [@MounirDhahri](https://github.com/MounirDhahri) | [#116](https://github.com/artsy/duchamp/pull/116) | [#132](https://github.com/artsy/duchamp/pull/132) |
| plain-english | The [`plain-english`](../.claude/skills/plain-english/SKILL.md) skill as a last pass over the summary and every inline comment | [@MounirDhahri](https://github.com/MounirDhahri) | [#120](https://github.com/artsy/duchamp/pull/120) | [#132](https://github.com/artsy/duchamp/pull/132) |
| Opus 5.5 | `claude-opus-5-5` instead of Opus 4.8, with prompt edits from Anthropic's Opus 5.5 guide | [@MounirDhahri](https://github.com/MounirDhahri) | [#125](https://github.com/artsy/duchamp/pull/125) | [#132](https://github.com/artsy/duchamp/pull/132) |

[#132](https://github.com/artsy/duchamp/pull/132) made the experiment the default in one
step: its prompt, plain-english and Opus 5.5 reached every review, and the experiment
kept only what came after. A first attempt,
[#129](https://github.com/artsy/duchamp/pull/129), was reverted in
[#131](https://github.com/artsy/duchamp/pull/131) over a worry that related repos leaked
a private repo into a public PR. The logs showed related repos hadn't run on that PR,
and [#132](https://github.com/artsy/duchamp/pull/132) reapplied it.

## Dismissed

| Experiment | What it changed | Why it went | Created by | PR | Dismissed in |
| --- | --- | --- | --- | --- | --- |
| Opus 5 | `claude-opus-5` for every review, rolled out without an opt-in | Reviews got chattier, with more findings that didn't hold up (see [#110](https://github.com/artsy/duchamp/pull/110)) | [@MounirDhahri](https://github.com/MounirDhahri) | [#108](https://github.com/artsy/duchamp/pull/108) | [#112](https://github.com/artsy/duchamp/pull/112) |
| Two-pass review | A read-only "find" pass listing every candidate issue, then a "filter" pass that verified and posted. Behind a flag, for eigen and volt | Built to tame Opus 5's noise; went back with it to single-pass Opus 4.8 | [@MounirDhahri](https://github.com/MounirDhahri) | [#110](https://github.com/artsy/duchamp/pull/110) | [#112](https://github.com/artsy/duchamp/pull/112) |

## Adding an experiment

1. Create `<name>-experiment/participants.yml` and a README, and a label constant and
   `in<Name>` check in `scripts/build-review-prompt.ts`, following the others.
2. Tag the review in Datadog with whether the change ran, not whether the PR was in
   the group, so the dashboard compares like with like.
3. Add a row to the Active table above.

When an experiment ends, move its row to Adopted or Dismissed with the PR that did it.
