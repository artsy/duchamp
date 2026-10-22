import * as fs from "fs"

/**
 * Write what a review cost to the job's step summary: model, cost, turns, tokens,
 * cache hit rate. Reads the execution file that claude-code-action writes.
 *
 * Only numbers go in the summary. The execution file also holds the conversation,
 * which carries PR content, and step summaries can be public.
 */

interface Usage {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}

interface ResultMessage {
  type: "result"
  subtype?: string
  duration_ms?: number
  num_turns?: number
  total_cost_usd?: number
  usage?: Usage
  modelUsage?: Record<string, unknown>
  permission_denials?: unknown[]
}

export interface ReviewUsage {
  outcome: string
  models: string[]
  costUsd: number
  turns: number
  durationMs: number
  inputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
  permissionDenials: number
  inlineComments: number
}

const isResultMessage = (message: unknown): message is ResultMessage =>
  typeof message === "object" &&
  message !== null &&
  (message as { type?: unknown }).type === "result"

const INLINE_COMMENT_TOOL = "mcp__github_inline_comment__create_inline_comment"

interface ContentBlock {
  type?: string
  id?: string
  name?: string
  tool_use_id?: string
  is_error?: boolean
  input?: {
    path?: string
    line?: number
    startLine?: number
    body?: string
    confirmed?: boolean
  }
}

const contentBlocks = (message: unknown): ContentBlock[] => {
  const content = (message as { message?: { content?: unknown } })?.message
    ?.content
  return Array.isArray(content) ? content : []
}

/**
 * Inline comments the review asked to post. Leaves out failed calls, `confirmed: false`
 * calls, which never post, and repeats, such as a buffered call sent again confirmed.
 * The action drops probe comments after the session, so this can run slightly high.
 */
const countInlineComments = (messages: unknown[]): number => {
  const blocks = messages.flatMap(contentBlocks)
  const failed = new Set(
    blocks
      .filter(block => block.type === "tool_result" && block.is_error)
      .map(block => block.tool_use_id)
  )
  const comments = blocks
    .filter(
      block =>
        block.type === "tool_use" &&
        block.name === INLINE_COMMENT_TOOL &&
        block.input?.confirmed !== false &&
        !failed.has(block.id)
    )
    .map(({ input }) =>
      JSON.stringify([input?.path, input?.line, input?.startLine, input?.body])
    )
  return new Set(comments).size
}

/** The final result entry of an execution file, or null if there is none. */
export const parseReviewUsage = (content: string): ReviewUsage | null => {
  let messages: unknown
  try {
    messages = JSON.parse(content)
  } catch {
    return null
  }

  if (!Array.isArray(messages)) {
    return null
  }

  const result = messages.filter(isResultMessage).pop()
  if (!result) {
    return null
  }

  const usage = result.usage ?? {}
  return {
    outcome: result.subtype ?? "unknown",
    models: Object.keys(result.modelUsage ?? {}),
    costUsd: result.total_cost_usd ?? 0,
    turns: result.num_turns ?? 0,
    durationMs: result.duration_ms ?? 0,
    inputTokens: usage.input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    permissionDenials: result.permission_denials?.length ?? 0,
    inlineComments: countInlineComments(messages),
  }
}

const totalInputTokens = (usage: ReviewUsage): number =>
  usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens

/** Share of input tokens served from the prompt cache. */
export const cacheHitRate = (usage: ReviewUsage): number => {
  const totalInput = totalInputTokens(usage)
  return totalInput === 0 ? 0 : usage.cacheReadTokens / totalInput
}

export const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

const formatCount = (n: number): string => n.toLocaleString("en-US")

export const formatUsageSummary = (
  usage: ReviewUsage,
  modelArgs: string
): string => {
  const rows: [string, string][] = [
    ["Outcome", usage.outcome],
    ["Model", usage.models.join(", ") || "unknown"],
    ["Claude args", modelArgs ? `\`${modelArgs}\`` : "unknown"],
    ["Cost", `$${usage.costUsd.toFixed(2)}`],
    ["Turns", String(usage.turns)],
    ["Duration", formatDuration(usage.durationMs)],
    ["Input tokens (uncached)", formatCount(usage.inputTokens)],
    ["Cache write tokens", formatCount(usage.cacheWriteTokens)],
    ["Cache read tokens", formatCount(usage.cacheReadTokens)],
    ["Output tokens", formatCount(usage.outputTokens)],
    ["Cache hit rate", `${(cacheHitRate(usage) * 100).toFixed(1)}%`],
    ["Denied tool calls", String(usage.permissionDenials)],
    ["Inline comments", String(usage.inlineComments)],
  ]

  return [
    "## AI review usage",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    ...rows.map(([metric, value]) => `| ${metric} | ${value} |`),
    "",
  ].join("\n")
}

export const USAGE_LOG_PREFIX = "REVIEW_USAGE "

/** One JSON line for scripts/collect-review-usage.ts to find in the job log. */
export const formatUsageLogLine = (
  usage: ReviewUsage,
  modelArgs: string,
  reviewMode: string,
  experiment: string
): string =>
  USAGE_LOG_PREFIX +
  JSON.stringify({
    ...usage,
    modelArgs,
    reviewMode: reviewMode || null,
    experiment:
      experiment === "true" ? true : experiment === "false" ? false : null,
  })

export interface MetricsContext {
  repo: string
  prNumber: string
  modelArgs: string
  reviewMode: string
  experiment: string
}

type VolleyMetric =
  | { type: "increment"; name: string; tags: string[] }
  | {
      type: "incrementBy" | "histogram"
      name: string
      value: number
      tags: string[]
    }

const reviewGroup = (experiment: string): string =>
  experiment === "true"
    ? "experiment"
    : experiment === "false"
      ? "standard"
      : "unknown"

/**
 * The review's numbers as metrics for volley, which forwards them to Datadog as
 * `ai_pr_review.<name>`. Counters give exact totals; histograms give the spread per
 * review. Tags are what the dashboard splits by. Numbers only, no PR text.
 */
export const formatVolleyPayload = (
  usage: ReviewUsage,
  context: MetricsContext
): { serviceName: string; metrics: VolleyMetric[] } => {
  const effort = context.modelArgs.match(/--effort (\S+)/)?.[1]
  // modelUsage also lists background models, such as Haiku, so tag the one asked for.
  const model =
    context.modelArgs.match(/--model (\S+)/)?.[1] ??
    usage.models[0] ??
    "unknown"
  const tags = [
    `repo:${context.repo}`,
    ...(context.prNumber ? [`pr:${context.prNumber}`] : []),
    `group:${reviewGroup(context.experiment)}`,
    `mode:${context.reviewMode || "unknown"}`,
    `outcome:${usage.outcome}`,
    `model:${model}`,
    ...(effort ? [`effort:${effort}`] : []),
  ]
  const histogram = (name: string, value: number): VolleyMetric => ({
    type: "histogram",
    name,
    value,
    tags,
  })

  return {
    serviceName: "ai_pr_review",
    metrics: [
      { type: "increment", name: "reviews", tags },
      // Counters take whole numbers.
      {
        type: "incrementBy",
        name: "cost_cents",
        value: Math.round(usage.costUsd * 100),
        tags,
      },
      {
        type: "incrementBy",
        name: "denied_tool_calls",
        value: usage.permissionDenials,
        tags,
      },
      ...(
        [
          ["input", usage.inputTokens],
          ["cache_write", usage.cacheWriteTokens],
          ["cache_read", usage.cacheReadTokens],
          ["output", usage.outputTokens],
        ] as const
      ).map(
        ([kind, value]): VolleyMetric => ({
          type: "incrementBy",
          name: "tokens",
          value,
          tags: [...tags, `kind:${kind}`],
        })
      ),
      histogram("cost_usd", usage.costUsd),
      histogram("turns", usage.turns),
      histogram("duration_ms", usage.durationMs),
      histogram("inline_comments", usage.inlineComments),
      // A run that failed before its first turn has no rate, not a rate of 0.
      ...(totalInputTokens(usage) > 0
        ? [histogram("cache_hit_rate", cacheHitRate(usage))]
        : []),
    ],
  }
}

/** The step runs on every review, so a stalled volley must not hold the runner. */
const VOLLEY_TIMEOUT_MS = 10_000

/**
 * Post the metrics when the workflow sets a volley URL. Volley answers 202 even when
 * it drops a metric, so only a failed request is reported, as a warning.
 */
export const sendToVolley = async (
  payload: ReturnType<typeof formatVolleyPayload>,
  url: string | undefined
): Promise<void> => {
  if (!url) {
    return
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(VOLLEY_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.log(
        `::warning::Volley rejected the review metrics: HTTP ${response.status}`
      )
      return
    }
    console.log("Review metrics sent to volley")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(
      `::warning::Could not send review metrics to volley: ${message}`
    )
  }
}

/** 1.2M, 6.1k, 950. */
const formatCompact = (n: number): string => {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`
  }
  return String(n)
}

/** The collapsed stats block appended to the review summary comment. */
export const formatStatsDetails = (
  usage: ReviewUsage,
  modelArgs: string,
  reviewedSince = ""
): string => {
  const cost = `$${usage.costUsd.toFixed(2)}`
  const duration = formatDuration(usage.durationMs)
  const effort = modelArgs.match(/--effort (\S+)/)?.[1]
  const model = [
    usage.models.join(", ") || "unknown",
    effort && `${effort} effort`,
  ]
    .filter(Boolean)
    .join(", ")
  const totalInput =
    usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens

  const rows: [string, string][] = [
    ["Model", model],
    ...(reviewedSince
      ? ([["Mode", `rereview since \`${reviewedSince}\``]] as [
          string,
          string,
        ][])
      : []),
    ["Cost", cost],
    ["Turns", String(usage.turns)],
    ["Duration", duration],
    [
      "Tokens",
      `${formatCompact(totalInput)} in (${Math.round(cacheHitRate(usage) * 100)}% cached), ${formatCompact(usage.outputTokens)} out`,
    ],
    ["Denied tool calls", String(usage.permissionDenials)],
  ]

  return [
    "<details>",
    `<summary>Review stats · ${cost} · ${usage.turns} turns · ${duration}</summary>`,
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
    "",
    "</details>",
  ].join("\n")
}

const main = async (): Promise<void> => {
  const executionFile = process.env.EXECUTION_FILE
  if (!executionFile || !fs.existsSync(executionFile)) {
    console.log("No execution file, so no usage to report")
    return
  }

  const usage = parseReviewUsage(fs.readFileSync(executionFile, "utf8"))
  if (!usage) {
    console.log("Execution file has no result entry, so no usage to report")
    return
  }

  const modelArgs = process.env.MODEL_ARGS ?? ""
  const reviewMode = process.env.REVIEW_MODE ?? ""
  const experiment = process.env.EXPERIMENT ?? ""

  const summary = formatUsageSummary(usage, modelArgs)
  console.log(summary)
  console.log(formatUsageLogLine(usage, modelArgs, reviewMode, experiment))

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    fs.appendFileSync(summaryPath, summary)
  }

  await sendToVolley(
    formatVolleyPayload(usage, {
      repo: process.env.GITHUB_REPOSITORY ?? "",
      prNumber: process.env.PR_NUMBER ?? "",
      modelArgs,
      reviewMode,
      experiment,
    }),
    process.env.VOLLEY_URL
  )
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
