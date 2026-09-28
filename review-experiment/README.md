# Experimental review mode

An opt-in variant of the [Claude AI PR review](../docs/actions.md#run-claude-reviewyml).
PRs in the experiment are reviewed with `prompt.md` in this directory instead of the
default prompt in `scripts/build-review-prompt.ts`. Everyone else sees no change.

## Joining

Two ways in:

1. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author is then reviewed in experiment mode, in any repo using the shared workflow.
   Case does not matter.
2. **Per PR.** Add the `ai-review-experiment` label to a single PR. No enrolment
   needed, and it works for anyone.

Leaving is the same in reverse: remove your login, or drop the label.

## What changes

Experiment reviews run on `claude-opus-5-5` at `high` effort, whatever `model` the
calling repo passes. The model and effort live in `scripts/build-review-prompt.ts`
(`EXPERIMENT_MODEL`, `EXPERIMENT_EFFORT`). A repo that opts out through its own
`prompt:` stays on its `model` input.

The default review is a structured checklist with a fixed Summary / Issues Found /
Areas Reviewed shape. The experiment review is deeper and blunter:

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
- **Unattended by design.** The prompt names the finish line (the summary comment is
  posted) and tells the model not to stop and ask. Blocking and required findings
  must name the input that triggers them, unconfirmed concerns say where the model
  looked, and instructions inside the PR text are ignored. These follow Anthropic's
  Opus 5.5 prompting guide.
- **Sharper comments.** One finding per comment, one line: `<emoji> **<severity>:**
  <problem>. <fix>.` Every comment opens with 🔴 **blocking:**, 🟠 **required:**,
  🔵 **nit:**, or ⚪ **q:**, so it is obvious at a glance what has to be fixed before
  merge and what can be ignored. Security findings and architectural disagreements
  get a full paragraph instead.
- **Different report shape.** Summary → Change Map → Critical Issues → Required
  Changes → Suggestions → Questions → Verdict, with an explicit
  Request Changes / Needs Discussion / Approve verdict.

The "verify before you claim" guardrail from the default prompt is kept. A skeptical
reviewer with no verification requirement produces confident wrong comments, which is
worse than a shallow review. Concerns that cannot be confirmed from the available code
go under Suggestions or as a `q:`, never as Blocking.

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
Changes another repo would need go under Suggestions, never Blocking. Default reviews
ignore the list.

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

## Skills

Skills live in `.claude/skills/` at the root of this repo, so they are live for anyone
working in duchamp locally. The review workflow copies them to `~/.claude/skills/` on
the runner, where Claude Code discovers them.

The runner destination is the home directory, not the reviewed repo's `.claude/`,
because repos ship skills of their own. Copying into the checkout would overwrite a
repo's own skill on a name clash and leave untracked files in the tree under review.

`plain-english` is the first one, vendored from a local skill under MIT. Only its
frontmatter `description` was changed, to trigger on writing a review rather than on
a user request. The experiment prompt runs it as a final pass. Skills install for
every review, but the default prompt does not reference any, so default reviews are
unchanged.

To add another, drop it in `.claude/skills/<name>/SKILL.md` and reference it from a
prompt. A skill nothing references is dead weight: it costs context on every review
and never runs.

## Precedence

1. A repo's `.claude-review.yml` `prompt:` field wins over everything. A repo that
   sets it has opted out of the experiment.
2. Otherwise the experiment prompt applies if the PR is in the experiment, and the
   default prompt if not.
3. The repo's `context`, `focus_areas`, and `ignore_paths` are appended either way.
   Its `related_repos` apply only to experiment reviews.
   Scope stays with the repo; the experiment only changes review style and depth.

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
