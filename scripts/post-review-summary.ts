import { execFileSync } from "child_process"
import * as fs from "fs"
import { reviewMarker } from "./review-mode"
import {
  formatStatsDetails,
  parseReviewUsage,
  type ReviewUsage,
} from "./review-usage"

/**
 * Post the review summary. The model returns it as structured output instead of
 * posting it, because only after the run do we know what the run cost. The action
 * revokes the Claude app token when it ends, so this posts as github-actions[bot].
 */

/** The summary from the action's structured_output, or null if there isn't one. */
export const parseSummary = (
  structuredOutput: string | undefined
): string | null => {
  if (!structuredOutput) {
    return null
  }

  try {
    const summary = JSON.parse(structuredOutput)?.summary
    return typeof summary === "string" && summary.trim() ? summary : null
  } catch {
    return null
  }
}

export interface CommentInput {
  summary: string
  usage: ReviewUsage | null
  headSha: string
  modelArgs: string
  reviewMode: string
  reviewedSince: string
  previousTotalUsd: number
  previousRuns: number
}

/** Summary, then the stats block, then the marker the next review reads. */
export const buildCommentBody = (input: CommentInput): string => {
  const totalUsd = input.previousTotalUsd + (input.usage?.costUsd ?? 0)
  const runs = input.previousRuns + (input.usage ? 1 : 0)

  const stats = input.usage
    ? formatStatsDetails(input.usage, {
        modelArgs: input.modelArgs,
        reviewMode: input.reviewMode,
        reviewedSince: input.reviewedSince,
        totalUsd,
        runs,
      })
    : ""

  return [
    input.summary.trimEnd(),
    stats,
    reviewMarker(input.headSha, totalUsd, runs),
  ]
    .filter(Boolean)
    .join("\n\n")
}

const main = (): void => {
  const summary = parseSummary(process.env.STRUCTURED_OUTPUT)
  if (!summary) {
    console.log(
      "::warning::The review returned no summary, so nothing was posted"
    )
    return
  }

  const executionFile = process.env.EXECUTION_FILE
  const usage =
    executionFile && fs.existsSync(executionFile)
      ? parseReviewUsage(fs.readFileSync(executionFile, "utf8"))
      : null

  const body = buildCommentBody({
    summary,
    usage,
    headSha: process.env.HEAD_SHA ?? "",
    modelArgs: process.env.MODEL_ARGS ?? "",
    reviewMode: process.env.REVIEW_MODE ?? "",
    reviewedSince: process.env.REVIEWED_SINCE ?? "",
    previousTotalUsd: Number(process.env.PREVIOUS_TOTAL_USD) || 0,
    previousRuns: Number(process.env.PREVIOUS_RUNS) || 0,
  })

  execFileSync(
    "gh",
    [
      "pr",
      "comment",
      process.env.PR_NUMBER ?? "",
      "-R",
      process.env.GITHUB_REPOSITORY ?? "",
      "--body-file",
      "-",
    ],
    { input: body, stdio: ["pipe", "inherit", "inherit"] }
  )
  console.log("Review summary posted")
}

if (require.main === module) {
  main()
}
