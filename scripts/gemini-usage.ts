import * as fs from "fs"
import { GEMINI_STANDARD_MODEL } from "./build-review-prompt"
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

const perMillion = (input: number, output: number, cacheRead: number) => ({
  input: input / 1_000_000,
  output: output / 1_000_000,
  cacheRead: cacheRead / 1_000_000,
})

/**
 * Standard-tier list prices in dollars per token, by Google's model ID, from public
 * write-ups (Antigravity reports no cost). Estimates: check them against LiteLLM's Usage
 * page. Gemini 3.8 Flash's introductory rate runs to 2026-12-31, then doubles.
 */
export const GEMINI_PRICES: Record<string, ReturnType<typeof perMillion>> = {
  "gemini-4-neon": perMillion(3, 15, 0.15),
  "gemini-3.8-flash": perMillion(0.75, 3.75, 0.075),
}

/** Antigravity's model name, such as gemini-4-neon-high, as Google's ID and the effort. */
export const splitAgyModel = (
  name: string
): { model: string; effort: string } => {
  const match = name.match(/^(.*)-(low|medium|high|xhigh|max)$/)
  return match
    ? { model: match[1], effort: match[2] }
    : { model: name, effort: "unknown" }
}

/** The review's cost at list price, or undefined without token counts or a price. */
export const estimateCostUsd = (
  usage: AgyUsage | null,
  model: string
): number | undefined => {
  const price = GEMINI_PRICES[model]
  if (
    !price ||
    (usage?.inputTokens === undefined &&
      usage?.outputTokens === undefined &&
      usage?.cachedTokens === undefined)
  ) {
    return undefined
  }
  const cost =
    (usage.inputTokens ?? 0) * price.input +
    (usage.outputTokens ?? 0) * price.output +
    (usage.cachedTokens ?? 0) * price.cacheRead
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
    /** Antigravity's model name, such as gemini-4-neon-high. */
    model: string
    repo: string
    prNumber: string
    reviewMode: string
    inlineComments: number
    durationMs: number
  }
): VolleyMetric[] => {
  const outcome = usage?.status === "success" ? "success" : "error"
  const { model, effort } = splitAgyModel(context.model)
  const tags = [
    `repo:${context.repo}`,
    ...(context.prNumber ? [`pr:${context.prNumber}`] : []),
    `mode:${context.reviewMode || "unknown"}`,
    `outcome:${outcome}`,
    `model:${model}`,
    `effort:${effort}`,
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
  const costUsd = reported ?? estimateCostUsd(usage, model)
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
    model: process.env.GEMINI_MODEL || GEMINI_STANDARD_MODEL,
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
