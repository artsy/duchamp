import {
  buildCommentBody,
  isReviewSummary,
  parseSummary,
} from "./post-review-summary"
import { findPreviousReview, stripReviewFooter } from "./review-mode"
import type { ReviewUsage } from "./review-usage"

const SHA = "c".repeat(40)

const USAGE: ReviewUsage = {
  outcome: "success",
  models: ["claude-opus-5-5"],
  costUsd: 0.84,
  turns: 9,
  durationMs: 160_000,
  inputTokens: 8_000,
  cacheWriteTokens: 100_000,
  cacheReadTokens: 1_092_000,
  outputTokens: 6_100,
  permissionDenials: 0,
}

const input = {
  summary: "## Code Review\n\n### Verdict\nRequest Changes\n",
  usage: USAGE,
  headSha: SHA,
  modelArgs: "--model claude-opus-5-5 --effort high",
  reviewMode: "full",
  reviewedSince: "",
  previousTotalUsd: 0,
  previousRuns: 0,
}

describe("parseSummary", () => {
  it("reads the summary field", () => {
    expect(parseSummary('{"summary":"## Code Review"}')).toBe("## Code Review")
  })

  it("is null when missing, blank or not JSON", () => {
    expect(parseSummary(undefined)).toBeNull()
    expect(parseSummary('{"summary":"  "}')).toBeNull()
    expect(parseSummary('{"other":"x"}')).toBeNull()
    expect(parseSummary("not json")).toBeNull()
  })
})

describe("buildCommentBody", () => {
  it("is the summary, a collapsed stats block, and the marker", () => {
    const stats = [
      "<details>",
      "<summary>Review stats · $0.84 · 9 turns · 2m 40s</summary>",
      "",
      "| | |",
      "| --- | --- |",
      "| Model | claude-opus-5-5, high effort |",
      "| Mode | full |",
      "| Cost | $0.84 |",
      "| Turns | 9 |",
      "| Duration | 2m 40s |",
      "| Tokens | 1.2M in (91% cached), 6.1k out |",
      "| Denied tool calls | 0 |",
      "",
      "</details>",
    ].join("\n")

    expect(buildCommentBody(input)).toBe(
      [
        "## Code Review\n\n### Verdict\nRequest Changes",
        `<!-- ai-review-footer -->\n${stats}`,
        `<!-- ai-review-sha: ${SHA} total-usd: 0.8400 runs: 1 -->`,
      ].join("\n\n")
    )
  })

  it("adds this run to the PR total on a re-review", () => {
    const body = buildCommentBody({
      ...input,
      reviewMode: "rereview",
      reviewedSince: "a1b2c3d",
      previousTotalUsd: 1.47,
      previousRuns: 2,
    })

    expect(body).toContain(
      "<summary>Review stats · $0.84 this run · $2.31 across 3 reviews · 9 turns · 2m 40s</summary>"
    )
    expect(body).toContain("| Mode | rereview since `a1b2c3d` |")
    expect(body).toContain("| PR total | $2.31 across 3 finished reviews |")
    expect(body).toContain("total-usd: 2.3100 runs: 3 -->")
  })

  it("posts the summary and carries the total forward without usage", () => {
    const body = buildCommentBody({
      ...input,
      usage: null,
      previousTotalUsd: 1.5,
      previousRuns: 2,
    })

    expect(body).not.toContain("<details>")
    expect(body).toContain("total-usd: 1.5000 runs: 2 -->")
  })

  it("survives a summary that quotes the footer and marker", () => {
    const quoting = [
      "## Code Review",
      `The marker looks like \`<!-- ai-review-sha: ${"d".repeat(40)} -->\`.`,
      "And the footer starts with `<!-- ai-review-footer -->`.",
      "### Verdict\nApprove",
    ].join("\n\n")
    const body = buildCommentBody({ ...input, summary: quoting })

    expect(findPreviousReview([body])).toMatchObject({ sha: SHA, runs: 1 })
    expect(stripReviewFooter(body)).toBe(quoting)
  })

  it("round-trips through the next run's marker lookup", () => {
    const body = buildCommentBody({
      ...input,
      previousTotalUsd: 1.47,
      previousRuns: 2,
    })

    const previous = findPreviousReview([body])
    expect(previous).toMatchObject({ sha: SHA, totalUsd: 2.31, runs: 3 })
    expect(stripReviewFooter(body)).toBe(
      "## Code Review\n\n### Verdict\nRequest Changes"
    )
  })
})

describe("isReviewSummary", () => {
  const comment = (login: string, type: string, body: string) => ({
    id: 1,
    user: { login, type },
    body,
  })

  it("matches the workflow's summaries and Claude's older ones", () => {
    expect(
      isReviewSummary(
        comment(
          "github-actions[bot]",
          "Bot",
          `x\n<!-- ai-review-sha: ${SHA} -->`
        )
      )
    ).toBe(true)
    expect(
      isReviewSummary(comment("claude[bot]", "Bot", "## Code Review"))
    ).toBe(true)
  })

  it("leaves other github-actions comments, other bots and people alone", () => {
    expect(
      isReviewSummary(
        comment("github-actions[bot]", "Bot", "AI Review skipped")
      )
    ).toBe(false)
    expect(
      isReviewSummary(
        comment("dependabot[bot]", "Bot", `<!-- ai-review-sha: ${SHA} -->`)
      )
    ).toBe(false)
    expect(
      isReviewSummary(
        comment("claude[bot]", "User", `<!-- ai-review-sha: ${SHA} -->`)
      )
    ).toBe(false)
    expect(isReviewSummary({ id: 2, user: null, body: null })).toBe(false)
  })
})
