import {
  buildCommentBody,
  earlierSummaries,
  FOOTER_SENTINEL,
  isReviewSummary,
  parseSummary,
} from "./post-review-summary"
import { findPreviousReview, stripReviewFooter } from "./review-mode"
import type { ReviewUsage } from "./review-usage"

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
  inlineComments: 0,
}

const input = {
  summary: "## Code Review\n\n### Verdict\nRequest Changes\n",
  usage: USAGE,
  modelArgs: "--model claude-opus-5-5 --effort high",
  headSha: "",
  reviewedSince: "",
}

const SHA = "c".repeat(40)

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
  it("is the summary, the sentinel, and a collapsed stats block for this run", () => {
    const stats = [
      "<details>",
      "<summary>Review stats · $0.84 · 9 turns · 2m 40s</summary>",
      "",
      "| | |",
      "| --- | --- |",
      "| Model | claude-opus-5-5, high effort |",
      "| Cost | $0.84 |",
      "| Turns | 9 |",
      "| Duration | 2m 40s |",
      "| Tokens | 1.2M in (91% cached), 6.1k out |",
      "| Denied tool calls | 0 |",
      "",
      "</details>",
    ].join("\n")

    expect(buildCommentBody(input)).toBe(
      `## Code Review\n\n### Verdict\nRequest Changes\n\n<!-- ai-review-footer -->\n${stats}`
    )
  })

  it("adds the marker and the re-review row for experiment reviews", () => {
    const body = buildCommentBody({
      ...input,
      headSha: SHA,
      reviewedSince: "a1b2c3d",
    })

    expect(body).toContain("| Mode | rereview since `a1b2c3d` |")
    expect(body.endsWith(`</details>\n\n<!-- ai-review-sha: ${SHA} -->`)).toBe(
      true
    )
  })

  it("round-trips through the next run's marker lookup, even when the summary quotes one", () => {
    const summary = `## Code Review\n\nThe marker looks like \`<!-- ai-review-sha: ${"d".repeat(40)} -->\`, after \`${FOOTER_SENTINEL}\`.`
    const body = buildCommentBody({ ...input, summary, headSha: SHA })

    expect(findPreviousReview([body])).toMatchObject({ sha: SHA })
    expect(stripReviewFooter(body)).toBe(summary)
  })

  it("posts the summary with the sentinel but no stats without usage", () => {
    const body = buildCommentBody({ ...input, usage: null })

    expect(body).not.toContain("<details>")
    expect(body.endsWith(FOOTER_SENTINEL)).toBe(true)
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
        comment("github-actions[bot]", "Bot", buildCommentBody(input))
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
      isReviewSummary(comment("dependabot[bot]", "Bot", FOOTER_SENTINEL))
    ).toBe(false)
    expect(
      isReviewSummary(comment("claude[bot]", "User", FOOTER_SENTINEL))
    ).toBe(false)
    expect(isReviewSummary({ id: 2, user: null, body: null })).toBe(false)
  })
})

describe("earlierSummaries", () => {
  const actions = (id: number) => ({
    id,
    user: { login: "github-actions[bot]", type: "Bot" },
    body: `Summary\n\n${FOOTER_SENTINEL}`,
  })
  const claude = (id: number) => ({
    id,
    user: { login: "claude[bot]", type: "Bot" },
    body: "## Code Review",
  })
  const person = (id: number) => ({
    id,
    user: { login: "octocat", type: "User" },
    body: "Thanks",
  })

  it("keeps the summary just posted", () => {
    const comments = [actions(1), person(2), actions(3), claude(4)]

    expect(earlierSummaries(comments, 3).map(c => c.id)).toEqual([1, 4])
  })

  it("keeps the newest summary when the model posted it itself", () => {
    const comments = [actions(1), claude(2), person(3), claude(4), person(5)]

    expect(earlierSummaries(comments).map(c => c.id)).toEqual([1, 2])
  })

  it("deletes nothing when there is only one summary", () => {
    expect(earlierSummaries([person(1), claude(2)])).toEqual([])
  })
})
