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
}

const isResultMessage = (message: unknown): message is ResultMessage =>
  typeof message === "object" &&
  message !== null &&
  (message as { type?: unknown }).type === "result"

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
  }
}

/** Share of input tokens served from the prompt cache. */
export const cacheHitRate = (usage: ReviewUsage): number => {
  const totalInput =
    usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens
  return totalInput === 0 ? 0 : usage.cacheReadTokens / totalInput
}

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

const formatCount = (n: number): string => n.toLocaleString("en-US")

export const formatUsageSummary = (
  usage: ReviewUsage,
  modelArgs: string,
  reviewMode: string
): string => {
  const rows: [string, string][] = [
    ["Outcome", usage.outcome],
    ["Review mode", reviewMode || "unknown"],
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

export interface StatsContext {
  modelArgs: string
  reviewMode: string
  /** Short SHA of the earlier review, on a re-review. */
  reviewedSince: string
  /** Cost of the PR's finished reviews, this one included. */
  totalUsd: number
  runs: number
}

/** The collapsed stats block appended to the review summary comment. */
export const formatStatsDetails = (
  usage: ReviewUsage,
  context: StatsContext
): string => {
  const cost = `$${usage.costUsd.toFixed(2)}`
  const total = `$${context.totalUsd.toFixed(2)}`
  const turns = `${usage.turns} turns`
  const duration = formatDuration(usage.durationMs)
  const headline =
    context.runs > 1
      ? [
          `${cost} this run`,
          `${total} across ${context.runs} reviews`,
          turns,
          duration,
        ]
      : [cost, turns, duration]

  const effort = context.modelArgs.match(/--effort (\S+)/)?.[1]
  const model = [
    usage.models.join(", ") || "unknown",
    effort && `${effort} effort`,
  ]
    .filter(Boolean)
    .join(", ")
  const mode =
    context.reviewMode === "rereview" && context.reviewedSince
      ? `rereview since \`${context.reviewedSince}\``
      : context.reviewMode || "full"
  const totalInput =
    usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens

  const rows: [string, string][] = [
    ["Model", model],
    ["Mode", mode],
    ["Cost", cost],
    ...(context.runs > 1
      ? ([["PR total", `${total} across ${context.runs} finished reviews`]] as [
          string,
          string,
        ][])
      : []),
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
    `<summary>Review stats · ${headline.join(" · ")}</summary>`,
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
    "",
    "</details>",
  ].join("\n")
}

const main = (): void => {
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

  const summary = formatUsageSummary(
    usage,
    process.env.MODEL_ARGS ?? "",
    process.env.REVIEW_MODE ?? ""
  )
  console.log(summary)

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    fs.appendFileSync(summaryPath, summary)
  }
}

if (require.main === module) {
  main()
}
