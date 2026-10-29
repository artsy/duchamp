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
| `artsy-react-native` | eigen, palette-mobile, energy | Artsy: rules learned from our own incidents |
| `react-native-best-practices` | eigen, palette-mobile, energy | [Callstack](https://github.com/callstackincubator/agent-skills/tree/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices), MIT |
| `swm-react-native-best-practices` | eigen, palette-mobile, energy | [Software Mansion](https://github.com/software-mansion-labs/skills/tree/58afa0a09b01dc47819af8fd48bb062561414108/skills/react-native-best-practices), MIT |

The two general skills overlap on lists and animations. Callstack leans to profiling
and bundle size; Software Mansion, who maintain Reanimated, Gesture Handler and
react-native-svg, go deeper on animations, gestures, SVG and threading. Neither says
plainly that animating SVG props in a loop freezes the app on Fabric, which is how
eigen #14142 broke. `artsy-react-native` holds rules like that one: things that broke
in our apps, each with the severity a finding gets.

A review runs a skill when all three hold: the PR is in this experiment, its repo is
listed, and the diff touches app code, meaning TypeScript outside tests, stories,
mocks, snapshots, generated files and `ignore_paths`. Native-only changes (Swift,
Kotlin, Gradle, Podfile) don't count yet, although some references cover them. We'll
decide whether to widen this once the TypeScript results are in. The list lives in
duchamp, so a PR can't drop a skill from its own review, and adding a repo takes a
duchamp PR.

When a skill runs, `scripts/stack-skills.ts` adds a "Stack Practices" section to the
prompt. It tells the reviewer to:

- call the skill with the Skill tool after reading the diff
- open the reference files that match the change and read them before judging that
  code, and not run the skill's profiling or build commands, since nothing can be
  measured in CI
- name the rule in each finding it leads to, as `(rule: js-lists-flatlist-flashlist)`
- put these findings under Suggestions unless the diff itself proves the problem. An
  `artsy-react-native` rule's `Severity:` overrides that and goes inline unscored;
  the `impact:` labels in the general skills don't
- skip steps the skills wrote for interactive sessions, such as asking the user or
  fetching outside pages

## Vendored skills

Stack skills live in `../.claude/stack-skills/<name>/`, apart from the review skills
in `.claude/skills/`. The workflow copies to the runner only the stack skills a review
picked (the `stack_skills` output of the prompt step). Copying them to every review
would let a review outside the experiment load one from its description alone, and
that would mix the two groups. Their frontmatter is left as upstream where possible,
since the prompt calls them by name.

Each folder name must match the skill's frontmatter `name`, and no two skills may
share a name, or Claude Code loads only one. `scripts/stack-skills.files.test.ts`
checks this. Only the top-level `SKILL.md` registers: Software Mansion's sub-guides
have their own `SKILL.md` with names like `animations`, but CLI 2.1.312 doesn't load
a `SKILL.md` nested under `references/`, so those names can't clash.

`react-native-best-practices` holds `SKILL.md`, `references/*.md` and the LICENSE,
from upstream commit `59e9d17`. Upstream's `POWER.md` (a packaging file for Kiro),
`agents/` and the screenshots under `references/images/` (6.4 MB) are left out. The
reviewer can't use them, so a few image links in the references go nowhere. To
update, copy the same files from a newer commit and change the SHA here.

`swm-react-native-best-practices` holds upstream's whole `react-native-best-practices`
folder from commit `58afa0a`, apart from its README. Upstream names it
`react-native-best-practices` too, so the frontmatter `name` is changed to avoid
clashing with Callstack's. `SOURCE.md` records this. Upstream states MIT in its README
and frontmatter but ships no LICENSE file. Its sub-guides sit one level deeper
(`references/animations/animations-performance.md`), and Datadog's `reference` tag
keeps that folder.

`artsy-react-native` is ours. Add a rule when a review misses something that broke an
Artsy app: say what to flag, what not to flag, the severity, and the incident.

## Knowing it ran

`scripts/review-usage.ts` counts, from the run's execution file:

- `ai_pr_review.skill_calls`, tagged `skill:<name>`: the reviewer loaded the skill
- `ai_pr_review.skill_reference_reads`, tagged `skill:` and `reference:<file>`:
  which rules it opened

Every review metric also carries `best_practices:true|false`: true when the review
ran a stack skill, not merely when the PR was in the group. Rule citations in the
comments show where a skill changed the review.

Volley drops names and tags outside its allowlists, if those are set in production.
See [the Datadog notes](../review/datadog/README.md).
