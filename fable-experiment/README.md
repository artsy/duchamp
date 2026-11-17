# Fable experiment

An opt-in addition to the [AI PR review](../review/README.md). PRs in it get their
large and risky reviews from Claude Fable 5.2, a stronger and dearer model than the
default Opus 5.5. Everything else about the review stays the same: the prompt, the
tools and the effort. It is separate from the other
[experiments](../review/experiments.md): a PR can be in any mix of them.

The question it answers: does a stronger model find more of what matters on the PRs
where a miss costs most, and is that worth about 1.7 times the price?

## Joining

1. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author then gets it, in any repo using the shared workflow. Case does not matter.
2. **Per PR.** Add the `ai-review-fable` label to a single PR. It takes effect on the
   next push.

Leaving is the same in reverse: remove your login, or drop the label.

## Which reviews use Fable

`scripts/review-risk.ts` sorts each review's changes into a
[tier](../review/README.md#model-routing). Only the deep tier changes:

| Tier | When | Model in this experiment |
| --- | --- | --- |
| light | Docs only, or at most 40 changed lines and no sensitive file | `claude-sonnet-5-5`, as before |
| standard | Anything else | `claude-opus-5-5`, as before |
| deep | A sensitive file changed, or more than 400 changed lines | `claude-fable-5-2` |

- **Sensitive files** are the `SENSITIVE_PATTERNS` in `scripts/review-risk.ts`:
  workflows, auth, sessions, tokens, secrets, permissions, payments, orders,
  migrations, `Dockerfile`, `.tf` and `.sql` files. One changed line in such a file is
  enough.
- **A large docs-only change stays light.**
- **Re-reviews are sorted again**, on the changes since the earlier review. A PR whose
  first review was deep can get a standard or light re-review after a small push.

## Rules

- **Fallback.** The review passes `--fallback-model` with the default model, so when
  Fable is overloaded or unavailable the review runs on Opus 5.5 and doesn't fail.
- **A repo's own model wins.** A caller that sets the workflow's `model` input keeps
  that model on every review.
- **Effort** stays `high`.

## Measuring it

Datadog tags each review with `model`, so the dashboard's model filter and the "by
model" table split cost, turns and duration. A review that ran only on the fallback is
tagged with the fallback model. One that switched part-way is tagged
`claude-fable-5-2`; the review stats in the summary comment list every model that ran.

## Limits

- The [outcome](../outcome-experiment/README.md) and
  [missed findings](../missed-findings-experiment/README.md) metrics carry no `model`
  tag. Comparing addressed rate by model means joining on the `pr` tag by hand.
- Fable's safety checks can decline a request, and a diff full of auth or security code
  is the likeliest place. The fallback covers an unavailable model. Whether it covers a
  declined request is not confirmed.
- Fable is not offered to Anthropic organisations on zero data retention.
