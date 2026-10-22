import {
  cacheHitRate,
  formatDatadogLog,
  formatUsageLogLine,
  formatUsageSummary,
  parseReviewUsage,
  type ReviewUsage,
  sendToDatadog,
} from "./review-usage"

const RESULT = {
  type: "result",
  subtype: "success",
  duration_ms: 92_400,
  num_turns: 9,
  total_cost_usd: 0.7712,
  result: "Posted the review. Secret PR text that must not leak.",
  usage: {
    input_tokens: 1_000,
    cache_creation_input_tokens: 20_000,
    cache_read_input_tokens: 179_000,
    output_tokens: 4_321,
  },
  modelUsage: { "claude-opus-5-5": { costUSD: 0.7712 } },
  permission_denials: [{ tool_name: "Write" }, { tool_name: "Edit" }],
}

const executionFile = (...messages: unknown[]): string =>
  JSON.stringify(messages)

describe("parseReviewUsage", () => {
  it("reads the result entry", () => {
    const usage = parseReviewUsage(
      executionFile({ type: "system", subtype: "init" }, RESULT)
    )

    expect(usage).toEqual({
      outcome: "success",
      models: ["claude-opus-5-5"],
      costUsd: 0.7712,
      turns: 9,
      durationMs: 92_400,
      inputTokens: 1_000,
      cacheWriteTokens: 20_000,
      cacheReadTokens: 179_000,
      outputTokens: 4_321,
      permissionDenials: 2,
    })
  })

  it("uses the last result entry when there are several", () => {
    const usage = parseReviewUsage(
      executionFile({ ...RESULT, num_turns: 3 }, RESULT)
    )

    expect(usage?.turns).toBe(9)
  })

  it("defaults missing fields to zero", () => {
    const usage = parseReviewUsage(executionFile({ type: "result" }))

    expect(usage).toMatchObject({
      outcome: "unknown",
      models: [],
      costUsd: 0,
      turns: 0,
      cacheReadTokens: 0,
      permissionDenials: 0,
    })
  })

  it("returns null without a result entry", () => {
    expect(
      parseReviewUsage(executionFile({ type: "system", subtype: "init" }))
    ).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(parseReviewUsage("{not json")).toBeNull()
  })

  it("returns null when the file is not an array", () => {
    expect(parseReviewUsage(JSON.stringify(RESULT))).toBeNull()
  })
})

describe("cacheHitRate", () => {
  it("is cache reads over all input tokens", () => {
    const usage = parseReviewUsage(executionFile(RESULT)) as ReviewUsage

    expect(cacheHitRate(usage)).toBeCloseTo(0.895)
  })

  it("is zero when there is no input", () => {
    const usage = parseReviewUsage(
      executionFile({ type: "result" })
    ) as ReviewUsage

    expect(cacheHitRate(usage)).toBe(0)
  })
})

describe("formatUsageSummary", () => {
  const usage = parseReviewUsage(executionFile(RESULT)) as ReviewUsage
  const summary = formatUsageSummary(
    usage,
    "--model claude-opus-5-5 --effort high"
  )

  it("lists the numbers", () => {
    expect(summary).toContain("| Cost | $0.77 |")
    expect(summary).toContain("| Turns | 9 |")
    expect(summary).toContain("| Duration | 1m 32s |")
    expect(summary).toContain("| Cache read tokens | 179,000 |")
    expect(summary).toContain("| Cache hit rate | 89.5% |")
    expect(summary).toContain("| Denied tool calls | 2 |")
    expect(summary).toContain("`--model claude-opus-5-5 --effort high`")
  })

  it("leaves out the conversation", () => {
    expect(summary).not.toContain("Secret PR text")
  })
})

describe("formatUsageLogLine", () => {
  const usage = parseReviewUsage(executionFile(RESULT)) as ReviewUsage

  it("is the prefix and one line of JSON", () => {
    const line = formatUsageLogLine(usage, "--effort high", "full", "true")

    expect(line).not.toContain("\n")
    expect(line.startsWith("REVIEW_USAGE {")).toBe(true)
    expect(JSON.parse(line.slice("REVIEW_USAGE ".length))).toMatchObject({
      costUsd: 0.7712,
      turns: 9,
      modelArgs: "--effort high",
      reviewMode: "full",
      experiment: true,
    })
  })

  it("records a missing review mode and group as null", () => {
    const line = formatUsageLogLine(usage, "", "", "")

    expect(line).toContain('"reviewMode":null')
    expect(line).toContain('"experiment":null')
  })

  it("records a review outside the experiment as false", () => {
    expect(formatUsageLogLine(usage, "", "", "false")).toContain(
      '"experiment":false'
    )
  })

  it("leaves out the conversation", () => {
    expect(formatUsageLogLine(usage, "", "", "")).not.toContain(
      "Secret PR text"
    )
  })
})

describe("formatDatadogLog", () => {
  const usage = parseReviewUsage(executionFile(RESULT)) as ReviewUsage
  const context = {
    repo: "artsy/eigen",
    prNumber: "42",
    runUrl: "https://github.com/artsy/eigen/actions/runs/7",
    modelArgs: "--model claude-opus-5-5 --effort high",
    reviewMode: "rereview",
    experiment: "true",
  }

  it("tags the event with what the dashboard splits by", () => {
    expect(formatDatadogLog(usage, context)).toMatchObject({
      service: "ai-pr-review",
      ddsource: "github-actions",
      message: "REVIEW_USAGE",
      ddtags:
        "repo:artsy/eigen,group:experiment,mode:rereview,outcome:success,model:claude-opus-5-5,effort:high",
    })
  })

  it("puts the numbers under review", () => {
    expect(formatDatadogLog(usage, context).review).toMatchObject({
      costUsd: 0.7712,
      turns: 9,
      totalInputTokens: 200_000,
      cacheHitRate: 0.895,
      pr: 42,
      runUrl: "https://github.com/artsy/eigen/actions/runs/7",
    })
  })

  it("marks standard and unrecorded reviews", () => {
    expect(
      formatDatadogLog(usage, { ...context, experiment: "false" }).ddtags
    ).toContain("group:standard")
    expect(
      formatDatadogLog(usage, { ...context, experiment: "", reviewMode: "" })
        .ddtags
    ).toContain("group:unknown,mode:unknown")
  })

  it("leaves out the conversation", () => {
    expect(JSON.stringify(formatDatadogLog(usage, context))).not.toContain(
      "Secret PR text"
    )
  })
})

describe("sendToDatadog", () => {
  const fetchMock = jest.fn()
  const log = jest.spyOn(console, "log").mockImplementation(() => {})

  beforeEach(() => {
    fetchMock.mockReset()
    log.mockClear()
    global.fetch = fetchMock
  })

  it("does nothing without a key", async () => {
    await sendToDatadog({ message: "x" }, undefined)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts the event to the site's log intake", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202 })

    await sendToDatadog({ message: "x" }, "key", "datadoghq.eu")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://http-intake.logs.datadoghq.eu/api/v2/logs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "DD-API-KEY": "key" }),
        body: '[{"message":"x"}]',
      })
    )
  })

  it("warns instead of failing when the send fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    await expect(sendToDatadog({}, "key")).resolves.toBeUndefined()

    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    await sendToDatadog({}, "key")

    expect(log).toHaveBeenCalledWith(
      "::warning::Could not send review usage to Datadog: network down"
    )
    expect(log).toHaveBeenCalledWith(
      "::warning::Datadog rejected the review usage: HTTP 403"
    )
  })
})
