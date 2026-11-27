import * as fs from "fs"
import { GEMINI_MODEL } from "./build-review-prompt"
import { parseReviewOutput } from "./post-side-by-side"
import { sendToVolley, type VolleyMetric } from "./review-usage"

/**
 * For Gemini experiment PRs: sends the Gemini review's numbers to Datadog through volley,
 * under the same metric names as Claude's and tagged `reviewer:gemini`, so the dashboard
 * can compare the two. Reads the JSON envelope `agy --output-format json` prints.
 */

export interface AgyUsage {
  status?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  costUsd?: number
  turns?: number
  durationMs?: number
}

export const GEMINI_USAGE_LOG_PREFIX = "GEMINI_USAGE "

/**
 * Gemini Neon 4's standard-tier list price in dollars per token, from public write-ups
 * (Antigravity reports no cost). An estimate: check it against LiteLLM's Usage page.
 */
export const GEMINI_PRICE_PER_TOKEN = {
  input: 3 / 1_000_000,
  output: 15 / 1_000_000,
  cacheRead: 0.15 / 1_000_000,
}

/** The review's cost at list price, or undefined without token counts. */
export const estimateCostUsd = (usage: AgyUsage | null): number | undefined => {
  if (
    usage?.inputTokens === undefined &&
    usage?.outputTokens === undefined &&
    usage?.cachedTokens === undefined
  ) {
    return undefined
  }
  const cost =
    (usage.inputTokens ?? 0) * GEMINI_PRICE_PER_TOKEN.input +
    (usage.outputTokens ?? 0) * GEMINI_PRICE_PER_TOKEN.output +
    (usage.cachedTokens ?? 0) * GEMINI_PRICE_PER_TOKEN.cacheRead
  return Math.round(cost * 10_000) / 10_000
}

const num = (...values: unknown[]): number | undefined =>
  values.find((v): v is number => typeof v === "number" && Number.isFinite(v))

/** Antigravity's field names aren't settled across versions, so this accepts both spellings. */
export const parseAgyUsage = (envelope: unknown): AgyUsage | null => {
  if (!envelope || typeof envelope !== "object") {
    return null
  }
  const e = envelope as Record<string, unknown>
  const u = (e.usage && typeof e.usage === "object" ? e.usage : {}) as Record<
    string,
    unknown
  >
  const fields: AgyUsage = {
    status: typeof e.status === "string" ? e.status.toLowerCase() : undefined,
    inputTokens: num(u.input_tokens, u.prompt_tokens),
    outputTokens: num(u.output_tokens, u.completion_tokens),
    cachedTokens: num(
      u.cache_read_tokens,
      u.cached_tokens,
      u.cache_read_input_tokens
    ),
    costUsd: num(u.total_cost_usd, u.cost_usd, e.total_cost_usd, e.cost_usd),
    turns: num(e.num_turns),
    durationMs:
      num(e.duration_ms) ??
      (typeof e.duration_seconds === "number"
        ? Math.round(e.duration_seconds * 1000)
        : undefined),
  }
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  ) as AgyUsage
}

export const geminiMetrics = (
  usage: AgyUsage | null,
  context: {
    repo: string
    prNumber: string
    reviewMode: string
    inlineComments: number
    durationMs: number
  }
): VolleyMetric[] => {
  const outcome = usage?.status === "success" ? "success" : "error"
  const tags = [
    `repo:${context.repo}`,
    ...(context.prNumber ? [`pr:${context.prNumber}`] : []),
    `mode:${context.reviewMode || "unknown"}`,
    `outcome:${outcome}`,
    `model:${GEMINI_MODEL}`,
    "reviewer:gemini",
  ]
  const histogram = (name: string, value: number): VolleyMetric => ({
    type: "histogram",
    name,
    value,
    tags,
  })
  const tokens: [string, number][] = []
  for (const [kind, value] of [
    ["input", usage?.inputTokens],
    ["cache_read", usage?.cachedTokens],
    ["output", usage?.outputTokens],
  ] as const) {
    if (value !== undefined) {
      tokens.push([kind, value])
    }
  }

  const reported = usage?.costUsd
  const costUsd = reported ?? estimateCostUsd(usage)
  const costTags =
    reported === undefined
      ? [...tags, "cost:estimated"]
      : [...tags, "cost:reported"]

  return [
    { type: "increment", name: "reviews", tags },
    ...(costUsd !== undefined
      ? [
          {
            type: "incrementBy" as const,
            name: "cost_cents",
            value: Math.round(costUsd * 100),
            tags: costTags,
          },
          {
            type: "histogram" as const,
            name: "cost_usd",
            value: costUsd,
            tags: costTags,
          },
        ]
      : []),
    ...tokens.map(
      ([kind, value]): VolleyMetric => ({
        type: "incrementBy",
        name: "tokens",
        value,
        tags: [...tags, `kind:${kind}`],
      })
    ),
    ...(usage?.turns !== undefined ? [histogram("turns", usage.turns)] : []),
    histogram("duration_ms", context.durationMs),
    histogram("inline_comments", context.inlineComments),
  ]
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const main = async (): Promise<void> => {
  const file = process.env.GEMINI_REVIEW_FILE ?? ""
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const usage = parseAgyUsage(parseJson(text))
  const startedAt = Number(process.env.GEMINI_STARTED_AT)
  const durationMs =
    usage?.durationMs ??
    (Number.isFinite(startedAt) && startedAt > 0 ? Date.now() - startedAt : 0)
  const review = parseReviewOutput(text)

  const context = {
    repo: process.env.GITHUB_REPOSITORY ?? "",
    prNumber: process.env.PR_NUMBER ?? "",
    reviewMode: process.env.REVIEW_MODE ?? "",
    inlineComments: review?.comments.length ?? 0,
    durationMs,
  }
  console.log(
    `${GEMINI_USAGE_LOG_PREFIX}${JSON.stringify({ ...usage, ...context })}`
  )
  await sendToVolley(
    { serviceName: "ai_pr_review", metrics: geminiMetrics(usage, context) },
    process.env.VOLLEY_URL
  )
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
