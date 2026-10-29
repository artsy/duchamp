# AI review in Datadog

Each review posts its numbers to [volley](https://github.com/artsy/volley), which
forwards them to Datadog as `ai_pr_review.*` metrics. No key is needed: the
"Report review usage" step in `claude-review.yml` sets `VOLLEY_URL`, and every repo
using the shared workflow reports.

| Metric | Type | What |
| --- | --- | --- |
| `reviews` | counter | One per review |
| `cost_cents` | counter | Cost, in cents, because counters take whole numbers |
| `denied_tool_calls` | counter | Tool calls the review was not allowed |
| `tokens` | counter | Tokens, with a `kind` tag: input, cache_write, cache_read or output |
| `cost_usd` | histogram | Cost per review |
| `turns` | histogram | Turns per review |
| `duration_ms` | histogram | Run time per review |
| `inline_comments` | histogram | Inline comments the review asked to post, leaving out failed calls, `confirmed: false` calls and repeats. The action drops probe comments after the session, so this can run slightly high |
| `cache_hit_rate` | histogram | Share of input tokens read from the prompt cache |
| `skill_calls` | counter | Skill tool calls, with a `skill` tag naming the skill |
| `skill_reference_reads` | counter | Reads of a skill's `references/*.md`, with `skill` and `reference` tags |

All of them carry the tags `repo`, `pr`, `group` (experiment, standard or unknown), `mode`
(full, rereview or unknown), `outcome`, `model` and `effort`. Reviews from after the
security experiment also carry `security` (true when the
[security pass](../README.md#security-pass) ran). Reviews from after the best-practices
experiment carry `best_practices` (true when the review ran a
[stack skill](../../best-practices-experiment/README.md)). Reviews from after the
related-repos experiment carry `related_repos` (true when the review read a
[related repo](../../related-repos-experiment/README.md)). `group:experiment` means
[lean reviews](../../lean-reviews-experiment/README.md), which was called the review
experiment when the tag was added; the value stays so the dashboard's history lines
up. Before related repos split out, those reviews also read related repos.

[`../experiments.md`](../experiments.md) lists every experiment and its tag.

Datadog bills custom metrics by the series seen each hour, and reviews rarely share
every tag in the same hour, so the `pr` tag adds few series. The `pr` tag holds the number alone, so filter
by `repo` too when looking at one PR.

Use counters for totals and averages: spend is `cost_cents / 100`, average cost is
`cost_cents / reviews / 100`, both `.as_count()`. Histograms reach Datadog as `.avg`,
`.median`, `.95percentile`, `.max` and `.count`, combined per volley host every 10
seconds. Reviews are rare, so each interval usually holds one review, but read median
and p95 over a period as close, not exact.

Volley answers 202 even when it drops a metric. If its `METRIC_NAME_ALLOWLIST` or
`METRIC_TAG_ALLOWLIST` is set in production, the names and tags above need adding to
it, or the metrics never arrive. Check with `hokusai production env get
METRIC_NAME_ALLOWLIST` and the same for `METRIC_TAG_ALLOWLIST` in artsy/volley.

## The dashboard

`dashboard.json` is the "AI PR review" dashboard: reviews, spend, cost per review,
turns, duration, cache hit rate, success rate, denied tool calls, tokens, inline
comments and the most expensive PRs, split by group and mode, with filters for repo,
group, mode, model and PR. Edit the file rather than the
dashboard in the UI, then apply it again.

To create it, use Dashboards → New Dashboard → the gear menu → Import dashboard JSON,
or the API with an application key that can write dashboards:

```bash
curl -sS -X POST "https://api.datadoghq.com/api/v1/dashboard" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" -d @review/datadog/dashboard.json
```

To update it, `PUT` the same file to `/api/v1/dashboard/<id>`.

Metrics start with the first review after this ships. Earlier reviews stay in the job
logs, where `scripts/collect-review-usage.ts` can still read them.
