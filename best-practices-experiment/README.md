# Best-practices experiment

An opt-in addition to the [AI PR review](../review/README.md). Reviews of PRs in it
check the change against best-practice skills for the repo's stack. It is separate
from the [review experiment](../review-experiment/README.md): a PR can be in one,
both or neither.

## Joining

1. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author then gets the stack skills, in any repo using the shared workflow. Case
   does not matter.
2. **Per PR.** Add the `ai-review-best-practices` label to a single PR. It takes
   effect on the next push.

Leaving is the same in reverse: remove your login, or drop the label.

## Stack skills

`../review/skills.yml` maps each skill to the repos it reviews:

| Skill | Repos | Source |
| --- | --- | --- |
| `react-native-best-practices` | eigen, palette-mobile, energy | [Callstack](https://github.com/callstackincubator/agent-skills/tree/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices), MIT |

A review runs a skill when all three hold: the PR is in this experiment, its repo is
listed, and the diff touches app code, meaning TypeScript outside tests, stories,
mocks, snapshots, generated files and `ignore_paths`. The list lives in duchamp, so a
PR can't drop a skill from its own review, and adding a repo takes a duchamp PR.

When a skill runs, `scripts/stack-skills.ts` adds a "Stack Practices" section to the
prompt. It tells the reviewer to:

- call the skill with the Skill tool after reading the diff
- open only the reference files that match the change, and not run the skill's
  profiling or build commands, since nothing can be measured in CI
- name the rule in each finding it leads to, as `(rule: js-lists-flatlist-flashlist)`
- put these findings under Suggestions unless the diff itself proves the problem

## Vendored skills

Skills live in `../.claude/skills/<name>/` and are copied to the runner with the
others (see [Skills](../review/README.md#skills)). Their frontmatter is left as
upstream, since the prompt calls them by name.

`react-native-best-practices` holds `SKILL.md`, `references/*.md` and the LICENSE,
from upstream commit `59e9d17`. Upstream's `POWER.md` (a packaging file for Kiro),
`agents/` and the screenshots under `references/images/` (6.4 MB) are left out. The
reviewer can't use them, so a few image links in the references go nowhere. To
update, copy the same files from a newer commit and change the SHA here.

## Knowing it ran

`scripts/review-usage.ts` counts, from the run's execution file:

- `ai_pr_review.skill_calls`, tagged `skill:<name>`: the reviewer loaded the skill
- `ai_pr_review.skill_reference_reads`, tagged `skill:` and `reference:<file>`:
  which rules it opened

Every review metric also carries `best_practices:true|false`. Rule citations in the
comments show where a skill changed the review.
