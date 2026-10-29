# AI PR review

The [Claude AI PR review](../docs/actions.md#run-claude-reviewyml) reviews every PR
with `prompt.md` in this directory. It runs on the workflow's `model` input,
`claude-opus-5-5` by default, at `high` effort (`REVIEW_EFFORT` in
`scripts/build-review-prompt.ts`). Small experiment PRs run on a lighter model; see
[Model routing](#model-routing). The Claude Code version is whatever
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
- **A security pass** on risky changes in the security experiment, by a subagent that
  reads only for security. See [Security pass](#security-pass).
- **Unattended by design.** The prompt names the finish line (inline comments posted,
  summary returned) and tells the model not to stop and ask. Blocking and required findings
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

Stack skills, such as `react-native-best-practices`, live in `.claude/stack-skills/`
instead. The [best-practices experiment](../best-practices-experiment/README.md) runs
them on the repos in `skills.yml`, and the workflow copies only the ones a review uses.
See that README for when they run and how we count their use.

## Context in the prompt

For PRs in the [review experiment](../review-experiment/README.md),
`build-review-prompt.ts` puts the repo's root `AGENTS.md` and the PR diff into the
prompt, so the reviewer doesn't spend its first turns fetching them. Every turn resends
the whole conversation, so fewer turns cost less. Other reviews get the same prompt as
before.

- `CLAUDE.md` stays out: the action loads it itself, and `AGENTS.md` with it when
  `CLAUDE.md` imports `@AGENTS.md`.
- A symlinked `AGENTS.md` is skipped, since a PR could point it at the runner's
  environment.
- The diff leaves out lockfiles and `ignore_paths` (read with `.gitignore` rules), and
  lists the left-out files by name.
- The prompt reaches the action as one environment variable, which Linux caps at
  128 KB. `AGENTS.md` is capped at 20 KB, and the diff at 60 KB or whatever the rest of
  the prompt leaves under 120 KB. Over its cap, the reviewer gets the list of changed
  files and reads the diff itself.

## Model routing

For PRs in the [review experiment](../review-experiment/README.md),
`scripts/review-risk.ts` sorts the changes into a tier before the run:

| Tier | When | Model and effort |
| --- | --- | --- |
| light | Every changed file is docs (`*.md`, `*.mdx`, `*.txt`, images, `docs/`, `LICENSE`), or at most 40 changed lines and no sensitive file | `claude-sonnet-5-5`, `medium` |
| standard | Anything else | the workflow's `model` input, `high` |

- A sensitive file keeps a PR on standard however small the change. `SENSITIVE_PATTERNS`
  lists them: workflows and actions, paths naming auth, sessions, tokens, secrets,
  permissions, policies, payments, checkout, billing or orders, migrations,
  `Dockerfile`, `.tf` and `.sql` files. The list leans broad, because a false match
  only costs a standard review.
- Lockfiles and `ignore_paths` don't count, as in the diff.
- A full review counts the whole PR. A [re-review](#re-reviews) counts the changes
  since the earlier review.
- A caller that sets `model` to anything but the default keeps that model on every PR.
- If git fails, the review is standard.

The job log prints the tier and why. Datadog already tags each review with `model:`
and `effort:`, so the dashboard splits by tier without a new tag. Other PRs stay on
standard until those numbers show light reviews hold up.

## Security pass

The main review weighs security against everything else. For risky changes, a
second agent reads only for security:

- **When.** PRs in the [security experiment](../security-experiment/README.md) that
  touch a sensitive file (the same `SENSITIVE_PATTERNS` as
  [Model routing](#model-routing)), and any PR with the `security-review` label, which
  also puts the PR in that experiment.
- **The label.** Adding it starts a full review straight away, even when the PR was
  already reviewed at its current commit, where a re-review would otherwise skip
  (`pickReviewMode`). The workflow passes the label that started the run as
  `TRIGGER_LABEL`. With the label, the pass covers every file in the whole PR, not only
  sensitive files and not only the commits since the last review.
- **How.** `formatSecuritySection` in `scripts/build-review-prompt.ts` adds a
  "Security Pass" section listing the files to check and allows the `Agent` tool. Once
  the reviewer has the diff, it starts the `duchamp-security-reviewer` subagent,
  defined in `.claude/agents/duchamp-security-reviewer.md`. The prompt step writes the
  diff for those files to `$RUNNER_TEMP/security.diff` (`writeSecurityDiff`), and the
  reviewer passes the subagent that path instead of copying the hunks. The name is
  namespaced because Claude Code prefers an agent of the same name defined in the repo
  under review, which a PR could add.
- **The subagent** has checks for Artsy's stacks: Actions injection and permissions,
  GraphQL loaders and IDOR, Rails params and authorization, React HTML injection and
  redirects, React Native secrets, deep links and WebViews. It returns leads, each with
  a `file:line`, the input that triggers it and what an attacker gets. Its tools are
  Read, Grep and Glob, so it can't post comments on any path. It gets no Bash because
  a subagent's Bash runs under the main reviewer's allowlist, which on reviews outside
  the review experiment includes `gh pr comment`. Narrowing Bash in the agent's
  frontmatter doesn't work in CLI 2.1.312: `Bash(git diff:*)` in `tools` allows every
  command the main reviewer can run, and the same pattern in `disallowedTools` removes
  Bash entirely.
- **The main reviewer** checks each lead against the code before posting it, as it
  would any other claim, and says in the summary how many it posted.

Agents in `.claude/agents/` are copied to `~/.claude/agents/` on the runner, like
skills and for the same reason. A caller pinned to a workflow from before this change
runs the current tooling without that copy step, so the agent is missing. The prompt
tells the reviewer to do the security read itself in that case and say so.

Datadog tags each review `security:true` or `security:false`.

## Re-reviews

For PRs in the [review experiment](../review-experiment/README.md), the posted summary
ends with a hidden marker naming the commit it reviewed:
`<!-- ai-review-sha: <commit> -->`. On the next push, `scripts/review-mode.ts` reads
the marker from the latest `github-actions[bot]` comment and picks a mode:

| Mode | When | What happens |
| --- | --- | --- |
| full | No earlier review, its commit left the branch history (force push, rebase), or a merge since then (such as "Update branch") | The whole PR, as on a first review |
| skip | Only lockfiles or `ignore_paths` changed since | No run. The earlier review stays up |
| rereview | Anything else | The prompt holds the earlier summary and the diff since then. The reviewer re-checks the earlier findings, reviews the new changes in depth, and returns a full summary |

Other PRs get a full review on every push and no marker.

Anything that posts with the repo's `GITHUB_TOKEN` writes as `github-actions[bot]`,
including a workflow a PR adds. So a PR author with write access could plant a marker
and skip the AI review of their own changes. The AI review is not a merge gate, so the
experiment accepts that. Signing the marker would close it before a wider rollout.

## Precedence

1. A repo's `.claude-review.yml` `prompt:` field replaces `prompt.md`.
2. The repo's `context`, `focus_areas`, and `ignore_paths` are appended to whichever
   prompt applies.
3. PRs in the [review experiment](../review-experiment/README.md) also get related
   repos, whatever the prompt.

## Usage

The model posts its inline comments as `claude[bot]`. Who posts the summary depends on
the group (`formatDelivery` in `scripts/build-review-prompt.ts`):

- **Standard PRs.** The model posts the summary itself with `gh pr comment`, so it
  shows as `claude[bot]`, with no stats.
- **[Experiment](../review-experiment/README.md) PRs.** The model returns the summary
  as structured output, and `scripts/post-review-summary.ts` posts it as
  `github-actions[bot]` with a collapsed "Review stats" block: model and effort, cost,
  turns, duration, tokens, and denied tool calls. It has to work this way: the run's
  cost is only known after the run, and the action revokes the Claude app token when
  its step ends, so nothing can edit Claude's comment afterwards. The re-review marker
  rides in the same footer.

In both groups the earlier summary is deleted only after the new one posts: the step
after the run keeps the newest summary and deletes the rest. The step before the run
just resolves Claude's old inline threads. So a run that is cancelled or fails leaves
the earlier summary up.

After each review, the job's step summary shows what it cost: model, cost, turns,
duration, input, cache and output tokens, cache hit rate, and denied tool calls.
`scripts/review-usage.ts` reads these from the action's execution file. It writes
numbers only, never the conversation, because that holds PR content.

The same step also posts the numbers to volley, which forwards them to Datadog as
`ai_pr_review.*` metrics tagged by repo, group, mode, outcome, model and effort. Again
numbers only. A failed send is a warning and doesn't fail the job. `datadog/` holds
the dashboard; see [its README](datadog/README.md).

The same numbers go to the job log as one `REVIEW_USAGE {...}` JSON line. To compare
reviews before and after a change, collect them across repos and split by date:

```bash
yarn ts-node scripts/collect-review-usage.ts --repos eigen,force,metaphysics \
  --since 2026-10-14 --split 2026-10-22
```

It prints median cost, turns, time and cache hit rate per window, group and review
mode. The group is `experiment` for PRs in the
[review experiment](../review-experiment/README.md), `standard` for the rest, and
`unknown` for log lines from before the group was recorded. The two groups differ in
more than one way (experiment PRs also read related repos), so compare each group
with itself before and after a change.
It finds runs by the caller's workflow file, `run-claude-review.yml` unless you pass
`--workflow`. GitHub keeps logs for 90 days by default, so older windows are gone.
This is a before/after comparison, not a controlled test: the mix of PRs changes
from week to week. Runs from before re-reviews existed show as mode `all`; after,
they split into `full` and `rereview`. An `all` row and a `full` row cover different
PRs, so don't compare those two directly. Add up each window's rows instead.
"Not success" counts runs that ended early, such as at the turn limit. They are
cheap, so a rise there can look like a saving. Over 1,000 runs in a repo, GitHub
drops the oldest and the script warns.

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

`.claude/stack-skills/swm-react-native-best-practices/` is vendored from
[Software Mansion's `skills`](https://github.com/software-mansion-labs/skills/tree/58afa0a09b01dc47819af8fd48bb062561414108/skills/react-native-best-practices),
MIT, renamed to avoid a clash; see its `SOURCE.md`.

`.claude/stack-skills/react-native-best-practices/` is vendored from
[Callstack's `agent-skills`](https://github.com/callstackincubator/agent-skills/tree/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices),
MIT, with its LICENSE alongside.
