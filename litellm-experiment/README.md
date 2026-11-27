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

Repos that call `agent-review.yml` pass only the LiteLLM key, so every review they run
goes through the gateway:

```yaml
secrets:
  litellm-api-key: ${{ secrets.AI_REVIEW_LITELLM_API_KEY }}
```

A repo that still passes `anthropic-api-key` calls Anthropic directly, and goes through
the gateway only when the PR is in the experiment: its author is in `participants.yml`,
its repo is under `repos`, or it carries the `ai-review-litellm` label. Without the
LiteLLM key, enrolment does nothing.

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

## What the gateway needs

In LiteLLM's admin UI, for the key the repos use:

- The models the review uses: `claude-opus-5-5`, `claude-sonnet-5-5` and
  `claude-haiku-5-5` (Claude Code's background calls and the judges).
- `{"phoenix_project_name": "duchamp-review"}` in the key's metadata, so review traces
  don't mix with other apps'.
- A budget and rate limits.

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
