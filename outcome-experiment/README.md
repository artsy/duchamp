# Outcome experiment

An opt-in addition to the [AI PR review](../review/README.md) that measures the review
and changes nothing in it. When a PR in it merges, a job records what happened to each
inline comment the review left. It is separate from the other
[experiments](../review/experiments.md): a PR can be in any mix of them.

Until now Datadog had cost, turns and duration, and nothing on whether a comment was
useful. This gives every later change to the review a number to be judged by.

## Joining

1. **Enable it in the repo.** Add `closed` to the trigger in the repo's
   `run-claude-review.yml`. Without it the job never runs there:

   ```yaml
   on:
     pull_request:
       types: [opened, synchronize, ready_for_review, labeled, unlabeled, closed]
   ```

2. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author is then measured when it merges, in any repo that lists `closed`. Case does
   not matter.
3. **Per PR.** Add the `ai-review-outcome` label to a single PR before it merges.

Leaving is the same in reverse: remove your login, or drop the label.

## What is measured

One `ai_pr_review.findings` count per inline comment from Claude or Codex, with these
tags:

| Tag | Values | Source |
| --- | --- | --- |
| `addressed` | yes, no, unclear | the code: a judge compares the comment with how its file changed between the review and the merge |
| `reaction` | up, down, none | 👍/👎 on the comment. A 👎 wins over a 👍 |
| `reply` | dismissed, agreed, other, none | what people replied, labelled by the judge. "This is not a problem" is `dismissed` |
| `severity` | blocking, required, nit, question, none | the comment's marker (🔴 🟠 🔵 ⚪) |
| `reviewer` | claude, codex | who posted it |

`addressed` is the main number, because it needs nobody to do anything. Reactions and
replies are a second opinion: `addressed:no` with `reply:dismissed` or a 👎 is a likely
false positive, and `addressed:no` with neither may have been ignored or deferred. A
reply or a 👍 never counts as addressed.

Datadog gets numbers and tags only. The job's summary lists each finding's file and
verdict, never its text.

## How it works

The `outcome` job in `claude-review.yml` runs `scripts/review-outcome.ts` when a PR
closes as merged. For each finding it fetches the file as it was at the commit the
comment was posted on and as it was at the PR's last commit, and diffs the two. It
compares file versions and not commits, so it still works after a rebase or force push
rewrote the branch.

One call to `claude-haiku-5-5` then judges every finding on the PR: the comment, the
diff hunk it was posted on, the file's diff since, and the replies. The comment and
reply text is passed as data, with an instruction not to follow anything inside it.

## Limits

- The judge only sees the finding's own file. A fix made in another file counts as
  `unclear`.
- A file's diff since the comment includes changes a rebase brought in from the base
  branch.
- At most 50 findings per PR, the newest.
- PRs closed without merging, and PRs from forks (no secrets), are not measured.

## Checking the judge

`--dry-run` prints the verdicts for any PR without sending anything, and ignores
enrolment and merge state:

```bash
GITHUB_REPOSITORY=artsy/duchamp PR_NUMBER=162 ANTHROPIC_API_KEY=... \
  npx ts-node scripts/review-outcome.ts --dry-run
```
