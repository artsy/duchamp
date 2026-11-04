# Codex experiment

An opt-in addition to the [AI PR review](../review/README.md). PRs in it get a second
review from OpenAI Codex, next to Claude's. Codex reads the same prompt and the same
checkout, and posts one summary comment titled `## Codex Review`. It is separate from
the other [experiments](../review/experiments.md): a PR can be in any mix of them.

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
  `file:line`, including the ones Claude would post inline. The workflow posts the
  summary.
- **No network.** A step saves `gh pr view --comments` to a file before Claude runs, and
  Codex reads that. It never sees Claude's review of the same push.
- **Skills.** The workflow copies the installed skills to `~/.agents/skills`, where
  Codex finds them, and the note tells it to read `SKILL.md` where the prompt says to
  run a skill.
- **No subagents.** Where the security pass hands work to a subagent, Codex does the
  read itself.

The workflow's opening lines (repo, PR number, base branch, read AGENTS.md or
CLAUDE.md first) moved from the YAML into the script, so both reviewers get them.

## How it runs

The Codex steps are the last in the `review` job, so they reuse the checkout, the
related repo clones and the installed skills. `openai/codex-action@v1` runs with
`sandbox: read-only`, the default `drop-sudo` safety strategy, Codex's default model
and `high` effort, like Claude. Codex runs even when Claude's review failed, and its
failures don't turn the review check red.

Before Codex starts, the workflow removes the job's GitHub token from both checkouts'
`.git/config`, so Codex can't read it and print it into its comment.

## Limits

- **Summary only.** No inline comments yet. Codex's `output-schema` could return
  findings with a file and line for a script to post.
- **Re-reviews follow Claude.** In lean reviews, a re-review hands over the previous
  summary, which is Claude's, and the changes since. Codex reviews those changes, not
  the whole PR again.
- **No Datadog numbers** for Codex's tokens or cost yet. The OpenAI project's usage
  page shows spend.
- **One timeout.** Both reviews share the job's `timeout-minutes` (default 30).
