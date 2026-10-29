# Review experiment

An opt-in addition to the [AI PR review](../review/README.md). Experiment PRs:

- get the repo's AGENTS.md and the PR diff in the prompt (see
  [Context in the prompt](../review/README.md#context-in-the-prompt))
- after the first review, re-review only what changed (see
  [Re-reviews](../review/README.md#re-reviews))
- run on `claude-sonnet-5-5` at medium effort when the change is docs only, or small and
  away from sensitive code (see [Model routing](../review/README.md#model-routing))
- get the summary posted by the workflow with a "Review stats" block (cost, turns,
  tokens), where other PRs get it from Claude directly (see
  [Usage](../review/README.md#usage))
- get fewer inline comments. Nits go to the summary, at most three. Questions go
  inline only when the answer decides whether the PR is safe to merge. A required
  finding stays inline only if how likely it is (1 to 5) times how bad it is (1 to
  5) reaches 6; below that it becomes a suggestion in the summary. Blocking findings
  always go inline. The rules are `EXPERIMENT_INLINE_SECTION` in
  `scripts/build-review-prompt.ts`.

Every review uses the same prompt file and model, in the experiment or not. The
experiment adds sections to that prompt. Reading other Artsy repos used to be part of
this experiment; it is now the
[related-repos experiment](../related-repos-experiment/README.md).

## Joining

Two ways in:

1. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author then gets these changes, in any repo using the shared workflow. Case does
   not matter.
2. **Per PR.** Add the `ai-review-experiment` label to a single PR. No enrolment
   needed, and it works for anyone.

Leaving is the same in reverse: remove your login, or drop the label.
