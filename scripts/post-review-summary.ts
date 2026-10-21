import { execFileSync } from "child_process"
import * as fs from "fs"
import { FOOTER_SENTINEL, reviewMarker } from "./review-mode"
import {
  formatStatsDetails,
  parseReviewUsage,
  type ReviewUsage,
} from "./review-usage"

/**
 * Post the review summary. The model returns it as structured output instead of
 * posting it, because only after the run do we know what the run cost. The action
 * revokes the Claude app token when it ends, so this posts as github-actions[bot].
 *
 * Earlier summaries are deleted only after the new one posts. A run that is cancelled
 * or fails leaves the earlier summary, and the marker the next run reads, in place.
 */

interface IssueComment {
  id: number
  user: { login: string; type: string } | null
  body: string | null
}

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

/** Summary, then the footer: stats block and the marker the next review reads. */
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

  const footer = [stats, reviewMarker(input.headSha, totalUsd, runs)]
    .filter(Boolean)
    .join("\n\n")
  return `${input.summary.trimEnd()}\n\n${FOOTER_SENTINEL}\n${footer}`
}

/**
 * A review summary: posted by claude[bot] before the workflow posted them, or by
 * github-actions[bot] with the marker. That bot posts other comments too.
 */
export const isReviewSummary = (comment: IssueComment): boolean => {
  if (comment.user?.type !== "Bot") {
    return false
  }
  if (comment.user.login === "claude[bot]") {
    return true
  }
  return (
    comment.user.login === "github-actions[bot]" &&
    (comment.body ?? "").includes("<!-- ai-review-sha: ")
  )
}

const gh = (args: string[], input?: string): string =>
  execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  })

const deleteEarlierSummaries = (
  repo: string,
  prNumber: string,
  keepId: number
): void => {
  const comments = gh([
    "api",
    "--paginate",
    `repos/${repo}/issues/${prNumber}/comments`,
    "--jq",
    ".[] | {id, user, body} | @json",
  ])
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as IssueComment)

  for (const comment of comments) {
    if (comment.id === keepId || !isReviewSummary(comment)) {
      continue
    }
    try {
      gh(["api", "-X", "DELETE", `repos/${repo}/issues/comments/${comment.id}`])
    } catch {
      console.log(`::warning::Could not delete earlier summary ${comment.id}`)
    }
  }
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

  const repo = process.env.GITHUB_REPOSITORY ?? ""
  const prNumber = process.env.PR_NUMBER ?? ""
  const posted = JSON.parse(
    gh(
      ["api", `repos/${repo}/issues/${prNumber}/comments`, "-F", "body=@-"],
      body
    )
  ) as IssueComment
  console.log(`Review summary posted: comment ${posted.id}`)

  deleteEarlierSummaries(repo, prNumber, posted.id)
}

if (require.main === module) {
  main()
}
