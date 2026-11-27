# LiteLLM experiment

An opt-in change to the [AI PR review](../review/README.md). Reviews in it call Claude
through Artsy's [LiteLLM gateway](https://github.com/artsy/artsy-litellm) instead of
Anthropic directly. The review itself doesn't change: same prompt, models and effort.
What changes is where the calls go, and what that adds:

- Every call is traced to Phoenix, so a single review can be opened and read call by
  call, and real reviews can become a dataset for testing prompt changes.
- Each repo can get its own virtual key, with a budget and rate limits, instead of the
  raw Anthropic key.

It is separate from the other [experiments](../review/experiments.md): a PR can be in
any mix of them, and they all work through the gateway.

## Joining

A review goes through the gateway when both hold:

1. **The PR is in the experiment:** its author is in `participants.yml`, its repo is
   under `repos`, or it carries the `ai-review-litellm` label.
2. **The repo passes the key** in its `run-claude-review.yml`:

   ```yaml
   secrets:
     anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
     litellm-api-key: ${{ secrets.AI_REVIEW_LITELLM_API_KEY }}
     litellm-edge-token: ${{ secrets.AI_REVIEW_LITELLM_EDGE_TOKEN }}
   ```

Without the key, enrolment does nothing and the review calls Anthropic as before. The
Anthropic key stays required, so leaving the experiment never breaks a review.

## How it works

- `base_url` in `participants.yml` names the gateway. It must be an https URL on
  `artsy.net`, with no port or credentials; anything else sends reviews to Anthropic, so
  an edit can't hand the key and the diffs to another host. Moving from staging to
  production is a one-line change.
- The review step sets `ANTHROPIC_BASE_URL` and passes the LiteLLM key as the API key.
  claude-code-action hands both to Claude Code.
- Through a gateway, Claude Code can't tell a model has a 1M context window and budgets
  200K. The model names get the `[1m]` selector, as
  [claude-code-action's docs](https://github.com/anthropics/claude-code-action/blob/main/docs/configuration.md)
  advise.
- The merge-time judges (the [outcome](../outcome-experiment/README.md) and
  [missed findings](../missed-findings-experiment/README.md) jobs) use the same gateway,
  key and headers.
- **Edge check.** Once the gateway checks a header at Cloudflare, set `edge_header` in
  `participants.yml` to its name, and repos pass the value as `litellm-edge-token`.
  Claude Code sends it on every call through `ANTHROPIC_CUSTOM_HEADERS`.
- Codex isn't affected. It still calls OpenAI with its own key.

## What the gateway needs

In LiteLLM's admin UI, for the key the repos use:

- The models the review uses: `claude-opus-5-5`, `claude-sonnet-5-5` and
  `claude-haiku-5-5` (Claude Code's background calls and the judges).
- `{"phoenix_project_name": "duchamp-review"}` in the key's metadata, so review traces
  don't mix with other apps'.
- A budget and rate limits.
- Key type "AI APIs", so the key can call models but not manage the gateway. Never use
  the master key.

The key is the org secret `AI_REVIEW_LITELLM_API_KEY`, shared with selected repos. The
staging admin UI is https://litellm.stg.artsy.systems (VPN): Logs shows each call, and
the key's page shows its spend against the budget.

## Trying the gateway by hand

From your own terminal, not a shared session, so the key stays private:

```sh
printf "LiteLLM key: "; read -rs LITELLM_KEY; export LITELLM_KEY; echo
ANTHROPIC_BASE_URL=https://litellm-staging.artsy.net ANTHROPIC_API_KEY=$LITELLM_KEY \
  claude -p "Say hi" --model "claude-opus-5-5[1m]" --output-format json |
  jq '{result, total_cost_usd, usage}'
```

A reply with a non-zero `total_cost_usd` and cache token counts in `usage` means the
review's cost and cache metrics will work through the gateway.

## Measuring it

Every gateway call carries two headers that LiteLLM reads. `x-litellm-tags`
(`ai-review`, `job:review` or `job:judge`, `repo:<owner/name>`) splits spend by repo and
job in LiteLLM's Usage page. `x-litellm-spend-logs-metadata` (repo, PR number, job, tier
and the Actions run URL) lands in each Phoenix span's metadata, so you can filter traces
by PR.

Datadog tags each review `gateway:litellm` or `gateway:anthropic`. Compare cost, cache
hit rate, turns, duration, denied tool calls and outcome between the two. Cost stays
comparable: Claude Code works it out from token counts, whichever way the calls went.

## What to watch

- **Cache hit rate.** If the gateway drops prompt caching, cost roughly doubles.
- **Effort.** The review sends `--effort high`. A gateway that drops unknown parameters
  would leave Opus 5.5 at its default, medium, without an error.
- **Permission mode.** With `ANTHROPIC_BASE_URL` set, claude-code-action keeps the
  earlier permission defaults instead of auto mode. The review's `--allowedTools` list
  then applies strictly, so denied tool calls may rise.
- **Which Anthropic account the gateway uses.** Its rate limits, model access and data
  retention apply, not those of the repo's own key.

## Limits

- Every call, PR diffs included, is stored in Phoenix. Phoenix stays behind the VPN.
- Staging LiteLLM shares staging's database, so the experiment stays small until it
  points at production.
