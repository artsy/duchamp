# Review experiment: related repos

An opt-in addition to the [AI PR review](../review/README.md). Experiment PRs can read
other Artsy repos alongside the one under review. Every review uses the same prompt
and model, in the experiment or not.

## Joining

Two ways in:

1. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author then reads related repos, in any repo using the shared workflow. Case does
   not matter.
2. **Per PR.** Add the `ai-review-experiment` label to a single PR. No enrolment
   needed, and it works for anyone.

Leaving is the same in reverse: remove your login, or drop the label.

## Related repos

An experiment review can read other Artsy repos, so it can tell when a field already
exists in metaphysics, or when logic added to a client belongs in metaphysics instead.
A repo lists them in `.claude-review.yml`:

```yaml
related_repos:
  - artsy/metaphysics
  - artsy/gravity
```

For experiment PRs, `scripts/build-review-prompt.ts` shallow-clones each one's
default branch into `$RUNNER_TEMP/related/` and passes it to Claude with `--add-dir`.
It also appends a "Related Repositories" section to the prompt. That section tells the
agent the checkouts are the default branch, so a missing field may be in an open PR.
Changes another repo would need go under Suggestions, never Blocking. Every other
review ignores the list.

Only `artsy/<name>` entries count, the repo under review is dropped, and the list is
capped at five. The list is read from the default branch's `.claude-review.yml`,
not the PR's and not the PR's base branch. The author picks the base, and could point
the PR at a branch they pushed with their own list. A PR can't grant its own review
access to a repo, so adding one takes a change merged into the default branch. A PR
that adds `related_repos` gets no related repos in its own review.

Private repos are read through the Artsy Review Context GitHub App, which has
Contents: read on the repos it is installed on. The org holds its ID as the
`REVIEW_APP_ID` variable and its key as the `REVIEW_APP_PRIVATE_KEY` secret. Callers
pass the key as `review-app-private-key`, and the workflow mints a token that lasts
one hour and is revoked when the job ends. A private repo the App isn't installed
on, or a caller that doesn't pass the key, fails to clone, and the review skips that
repo with a log line. The token goes to git as a one-off header, so it is never
written to disk where the agent could read it. To add a private repo, install the
App on it.

Review comments on a public repo like eigen are public. When a public PR's review
reads a private repo, the script adds a "Private repos on a public PR" section to the
prompt. It lets a comment state a conclusion about the PR's own line ("`saleMessage`
isn't served by the API") and forbids quoting, paraphrasing, or naming anything
inside the private repo. The rule is enforced only by the prompt, so check the first
reviews on public repos for slips. A repo counts as private when it can't be cloned
without the token.

### What changes in a review

These are made-up PRs, to show the shape of the comments.

**A gravity PR (private): full detail.** The PR renames `sale_message` to
`availability_message` in the artwork API response. Gravity reads metaphysics and
volt, which consume that API.

- Before, seeing gravity only:
  > 🔵 **nit:** `availability_message` duplicates the `availability` field's meaning.
  > Consider folding it into `availability_details`.
- After, also seeing metaphysics and volt:
  > 🔴 **blocking:** metaphysics still reads `sale_message` from this endpoint
  > (`src/schema/v2/artwork/index.ts`, the `saleMessage` resolver). After this ships,
  > `saleMessage` returns `null` for every artwork, on web and in the app. Keep
  > `sale_message` as an alias until metaphysics moves over, or pair this with an MP PR.

A private PR can name consumer files, because everyone who can read it can read them.

**An eigen PR (public): nudges only.** The PR adds a "Sold out" badge by working out
availability in the app from `artwork.editionSets`.

- Before:
  > 🔵 **nit:** extract `isSoldOut` into `app/utils/artwork.ts` so other scenes can
  > share it.
- After:
  > 🟠 **required:** `isSoldOut` recomputes availability that the API already decides,
  > and gets it wrong for works with a hold. The badge will disagree with the Buy
  > button. Use `artwork.isSold` (already in `data/schema.graphql`) instead of
  > deriving it here.

  > ⚪ **q:** the backend treats "on hold" as unavailable, but this counts it as
  > available. Is showing those works as for sale intended?
- Not allowed, because it describes how gravity is built on a public PR:
  > ~~🟠 **required:** gravity's `Artwork#sold?` checks `edition_sets.any?(&:on_hold)`
  > too, so this disagrees with it.~~

**A metaphysics PR (public): nudges only.** The PR adds a `partnerRevenue` field to
`Partner` with a new loader.

- After:
  > ⚪ **q:** the API doesn't seem to serve revenue at this endpoint for non-admin
  > tokens. Does this loader need `authenticatedLoaders`, or will it return `null`
  > for every regular user?

On a private PR, related repos give full specifics. On a public PR, they give
conclusions about the PR's own lines.
