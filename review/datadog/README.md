# AI review in Datadog

Each review sends one log event to Datadog when the caller passes `datadog-api-key`
(see [Usage](../README.md#usage)). These files turn those events into a dashboard.

- `log-metrics.json`: log-based metrics for reviews, cost, turns, duration, cache hit
  rate and denied tool calls, tagged by `repo`, `group`, `mode`, `outcome` and
  `model`. Metrics last 15 months, so trends outlive log retention.
- `dashboard.json`: the "AI PR review" dashboard. Its charts read the metrics, and its
  "Recent reviews" list reads the logs.

Edit these files rather than the dashboard in the UI, then apply them again.

## Setting it up

1. Create a Datadog API key for this job only. Add it as the org secret
   `DD_REVIEW_API_KEY`, and pass it from each repo's caller as `datadog-api-key`.
2. Create the metrics and the dashboard. This needs an API key and an application key
   that can write log metrics and dashboards:

   ```bash
   export DD_API_KEY=... DD_APP_KEY=... DD_SITE=datadoghq.com
   jq -c '.[]' review/datadog/log-metrics.json | while read -r metric; do
     curl -sS -X POST "https://api.$DD_SITE/api/v2/logs/config/metrics" \
       -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
       -H "Content-Type: application/json" -d "$metric"
   done
   curl -sS -X POST "https://api.$DD_SITE/api/v1/dashboard" \
     -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
     -H "Content-Type: application/json" -d @review/datadog/dashboard.json
   ```

   To update the dashboard later, `PUT` the same file to `/api/v1/dashboard/<id>`.
   To change a metric, `PATCH /api/v2/logs/config/metrics/<id>` with its `compute`
   left out, because Datadog doesn't let you change it.
3. In Logs, add measures for `@review.costUsd`, `@review.turns` and
   `@review.durationMs` on `service:ai-pr-review`, so the "Recent reviews" columns and
   ad hoc log queries can sort and chart them.

Metrics only count events from the moment they exist, so create them before the
first review sends usage. Earlier reviews stay in the job logs, where
`scripts/collect-review-usage.ts` can still read them.
