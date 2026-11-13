# Missed-findings experiment

An opt-in addition to the [AI PR review](../review/README.md) that measures the review
and changes nothing in it. When a PR in it merges, a job compares what human reviewers
said in their inline comments with what the AI review said, and records the points
the AI missed. It is separate from the other [experiments](../review/experiments.md):
a PR can be in any mix of them.

The [outcome experiment](../outcome-experiment/README.md) asks whether the review's
comments were useful. This one asks the opposite question: what did people have to
catch themselves?

## Joining

1. **Enable it in the repo.** Add `closed` to the trigger in the repo's
   `run-claude-review.yml`, as for the outcome experiment. Without it the job never
   runs there.

With `everyone: true` in `participants.yml`, every merged PR in such a repo is
checked, whoever wrote it, and there is nothing else to join. It is still an
experiment: the numbers and the judge are being checked, and it can be turned off in
one line. Setting `everyone` to false makes it opt-in again, with two ways in:

2. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author is then checked when it merges. Case does not matter.
3. **Per PR.** Add the `ai-review-missed-findings` label to a single PR before it
   merges.

Leaving is the same in reverse: remove your login, or drop the label.

## What is measured

One `ai_pr_review.human_comments` count per inline thread started by a reviewer with
write access, other than the PR's author, with these tags:

| Tag | Values |
| --- | --- |
| `category` | bug, security, performance, tests, design, convention, question, other |
| `caught` | true when one of the AI's inline comments made the same point about the same code |

The share of `bug` and `security` comments with `caught:false` is the review's miss
rate. Replies inside the AI's own threads, the author's own comments and review
summaries are not counted. Neither are comments from people without write access:
on a public repo anyone can comment, and that text would reach the judge and the log.

## Where the text goes

Datadog gets counts and tags only. For each missed comment the job also prints one
line to its own log: the category, the file and a one-sentence restatement written by
the judge.

```text
MISSED_FINDING {"repo":"artsy/volt","pr":"12376","category":"bug","path":"app/models/show.rb","summary":"The scope ignores unpublished shows, so drafts leak into the list."}
```

The log stays inside the repo, so a private repo's review text never reaches Datadog
or duchamp, which is public.

## Turning misses into rules

`scripts/collect-missed-findings.ts` reads those lines and groups them by repo and
category:

```bash
yarn ts-node scripts/collect-missed-findings.ts --repos gravity,volt --since 2026-11-01
```

A person reads the list. A point that repeats becomes a `focus_areas` entry in that
repo's `.claude-review.yml`, by PR. Nothing writes rules automatically.

## How it works

The `outcome` job in `claude-review.yml` runs `scripts/review-missed.ts` when a PR
closes as merged. One call to `claude-haiku-5-5` gets the human comments with their
diff hunks and the AI's inline comments, and returns the category, whether each was
caught, and the restatement. The text is passed as data, with an instruction not to
follow anything inside it. A comment the judge skips or answers badly is left out,
not guessed.

## Limits

- Most PRs get few human inline comments, so a repo needs a few weeks before a
  pattern shows.
- `caught` only looks at the AI's inline comments, not its summary. A point the
  summary made counts as missed.
- At most 50 human comments per PR, the newest.

`--dry-run` prints the result for any PR without sending anything:

```bash
GITHUB_REPOSITORY=artsy/force PR_NUMBER=17926 ANTHROPIC_API_KEY=... \
  npx ts-node scripts/review-missed.ts --dry-run
```
