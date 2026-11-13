# Enabling the AI PR review in a repo

The AI PR review reads every pull request and comments on it: inline comments marked
by severity (🔴 blocking, 🟠 required, 🔵 nit, ⚪ question) and a summary with a
verdict. It is a second reader, not a merge gate. One shared workflow in this repo
runs it for every Artsy repo that turns it on.

This page is how to turn it on. For every option, see the
[`run-claude-review.yml` reference](./actions.md#run-claude-reviewyml). For how the
review works, see [`review/README.md`](../review/README.md).

## The steps

1. Copy [`templates/run-claude-review.yml`](../templates/run-claude-review.yml) to
   `.github/workflows/run-claude-review.yml` in the repo. Keep it as is.
2. Check the repo can read the `ANTHROPIC_API_KEY` secret. Artsy sets it for the whole
   org, so most repos need nothing. See
   [Setting Up the API Key](./actions.md#run-claude-reviewyml) if it is missing.
3. Optional: add a `.claude-review.yml` at the repo root with the repo's own focus
   areas, ignored paths and context. The review works without it, and is better with
   it. See [Repo Configuration](./actions.md#run-claude-reviewyml).
4. Open a PR with those files. The review runs on that PR too, so it is the first
   test. `.claude-review.yml` takes effect from the PR that adds it, except
   `related_repos`, which is read from the default branch and so applies once merged.

## Or let Claude Code do it

Paste this into Claude Code from the root of the repo. It does the steps above,
drafts the `.claude-review.yml` from the repo's own conventions, and opens a PR
without merging it.

```text
Enable Artsy's shared AI PR review in this repo. The docs are at
https://github.com/artsy/duchamp/blob/main/docs/actions.md#run-claude-reviewyml

1. Add .github/workflows/run-claude-review.yml with the content of
   https://github.com/artsy/duchamp/blob/main/templates/run-claude-review.yml
   (fetch it with `gh api repos/artsy/duchamp/contents/templates/run-claude-review.yml`).
   Keep it as is. If the repo already has this file, stop and tell me.

2. Check that the ANTHROPIC_API_KEY secret reaches this repo:
   `gh api repos/{owner}/{repo}/actions/organization-secrets` and
   `gh secret list`. If it is missing, or you cannot tell, say so in the PR
   description. Never ask me for the key and never print one.

3. Write a .claude-review.yml at the repo root. Read AGENTS.md, CLAUDE.md, the
   README and enough of the code to know the stack and its conventions first.
   - context: 3 to 6 lines on what the repo is, its stack, and which checks CI
     already runs, so the review doesn't repeat them.
   - focus_areas: 3 to 6 rules a reviewer can check against a diff, taken from
     conventions the repo documents or clearly follows. Say what to flag and
     what not to flag. Leave out anything a linter or the type checker catches.
   - ignore_paths: generated files, lockfiles the default doesn't cover, vendored
     code and snapshots.
   - related_repos: only if this repo plainly serves or consumes another Artsy
     repo (for example a client of metaphysics). At most 3, as artsy/<name>. If
     you add any and this repo is private, also pass
     `review-app-private-key: ${{ secrets.REVIEW_APP_PRIVATE_KEY }}` in the workflow.
   If the repo is public, keep internal details out of this file.

4. Open a PR titled "chore: enable the AI PR review", following the repo's PR
   template if it has one. Say what the review will do here, list the focus areas
   you chose and why, and note anything you could not verify. Do not merge it.

Change nothing else in the repo.
```

Read the `.claude-review.yml` it drafts before merging. Focus areas shape every
review in the repo from then on, and a vague one produces noisy comments.

## Once it is on

- **Skipping a PR.** Drafts, bots and PRs titled "Deploy" are skipped. Add the
  `in-progress` label to hold the review on a PR you are still working on.
- **Who gets reviewed.** Only PRs whose author has write access to the repo.
- **After the first review.** A new push gets a re-review of what changed, not a
  second full review.
- **A security read.** Add the `security-review` label to a PR for a security pass on
  the whole change.
- **Experiments.** New behaviour ships as an experiment first, on for some authors,
  some repos or everyone. [`review/experiments.md`](../review/experiments.md) lists
  what is active and how to try one on a single PR.
- **Feedback.** React with 👍 or 👎 on the review's comments. Where the repo's
  workflow lists `closed`, as the template does, those reactions are counted when the
  PR merges.

## Tuning it

When the review keeps raising something the team doesn't want, or keeps missing
something it should catch, edit `focus_areas` in the repo's `.claude-review.yml`. Say
what to flag and what not to flag: the reference has
[examples](./actions.md#run-claude-reviewyml), and `artsy/gravity` and `artsy/volt`
have long-lived ones.
