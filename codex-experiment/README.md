# Codex experiment

An opt-in addition to the [AI PR review](../review/README.md). PRs in it get a second
review from OpenAI Codex, from the same prompt and the same checkout as Claude's. One
comment shows the two reviews side by side. It is separate from the other
[experiments](../review/experiments.md): a PR can be in any mix of them.

## What the PR shows

Claude's review is unchanged: its inline comments on the diff and its summary comment.
Then one more comment, "AI reviews: Claude | Codex", with two columns:

- **Claude:** its summary, then a one-line copy of each inline comment it posted on
  this commit, with its `file:line`.
- **Codex:** its summary, which holds every finding, since Codex can't post inline.

A new push replaces the side-by-side comment. If one review fails, its column says so.
`scripts/post-side-by-side.ts` builds it.

## Joining

1. **Enable it in the repo.** Pass the OpenAI key to the shared workflow, next to the
   Anthropic one. Without it, Codex never runs there:

   ```yaml
   secrets:
     anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
     openai-api-key: ${{ secrets.OPENAI_API_KEY }}
   ```

2. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author then gets a Codex review, in any repo that passes the key. Case does not
   matter.
3. **Per PR.** Add the `ai-review-codex` label to a single PR. It takes effect on the
   next push.

## One prompt for both

`scripts/build-review-prompt.ts` builds the prompt once. Claude gets it as before.
Codex gets the same text plus a short "Running in Codex" section at the end
(`formatCodexNote`), which covers only what Codex can't do the same way:

- **No GitHub tools.** Codex can't post, so every finding goes in its summary with a
  `file:line`, including the ones Claude would post inline. The workflow posts it in
  the side-by-side comment.
- **No network.** A step saves `gh pr view --comments` to a file before Claude runs, and
  Codex reads that. It never sees Claude's review of the same push.
- **Skills.** The workflow copies the installed skills to `~/.agents/skills`, where
  Codex finds them, and the note tells it to read `SKILL.md` where the prompt says to
  run a skill. So when a PR is also in the [merge risk](../merge-risk-experiment/README.md)
  or best-practices experiment, Codex gets the same section and the same skill as
  Claude, and its summary carries its own Merge Risk block.
- **CLAUDE.md.** Claude Code loads it; Codex doesn't, so the note tells it to read it.
- **No subagents.** Where the security pass hands work to a subagent, Codex does the
  read itself.

The workflow's opening lines (repo, PR number, base branch, read AGENTS.md or
CLAUDE.md first) moved from the YAML into the script, so both reviewers get them.

## How it runs

The Codex steps are the last in the `review` job, so they reuse the checkout, the
related repo clones and the installed skills. `openai/codex-action@v1` runs with
`sandbox: read-only`, the default `drop-sudo` safety strategy, `gpt-6.1-terra` and
`high` effort, like Claude. The model is named so a new Codex release can't change it. Codex runs even when Claude's review failed, and its
failures don't turn the review check red.

Before Codex starts, the workflow removes the job's GitHub token from both checkouts'
`.git/config`, so Codex can't read it and print it into its comment.

## Limits

- **No inline comments from Codex.** Its `output-schema` could return findings with a
  file and line for a script to post.
- **Re-reviews follow Claude.** In lean reviews, a re-review hands over the previous
  summary, which is Claude's, and the changes since. Codex reviews those changes, not
  the whole PR again.
- **No Datadog numbers** for Codex's tokens or cost yet. The OpenAI project's usage
  page shows spend.
- **One timeout.** Both reviews share the job's `timeout-minutes` (default 30).
