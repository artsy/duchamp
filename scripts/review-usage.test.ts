import {
  cacheHitRate,
  formatUsageLogLine,
  formatUsageSummary,
  formatVolleyPayload,
  type MetricsContext,
  parseReviewUsage,
  type ReviewUsage,
  sendToVolley,
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

const toolCall = (
  id: string,
  name: string,
  input: Record<string, unknown> = { path: "a.ts", line: 1, body: id }
) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
})

const toolResult = (id: string, isError = false) => ({
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: id, is_error: isError }],
  },
})

const INLINE = "mcp__github_inline_comment__create_inline_comment"

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
      inlineComments: 0,
      skillCalls: {},
      skillReferenceReads: {},
    })
  })

  it("counts skill calls and reference reads that went through", () => {
    const ref = (file: string) => ({
      file_path: `/home/runner/.claude/skills/react-native-best-practices/references/${file}`,
    })
    const usage = parseReviewUsage(
      executionFile(
        toolCall("s1", "Skill", { skill: "react-native-best-practices" }),
        toolCall("s2", "Skill", { skill: "plain-english" }),
        toolCall("s3", "Skill", { skill: "missing" }),
        toolResult("s3", true),
        toolCall("r1", "Read", ref("js-lists-flatlist-flashlist.md")),
        toolCall("r2", "Read", ref("js-lists-flatlist-flashlist.md")),
        toolCall("r3", "Read", ref("js-memory-leaks.md")),
        toolCall("r4", "Read", {
          file_path:
            "/home/runner/.claude/skills/react-native-best-practices/SKILL.md",
        }),
        toolCall("r5", "Read", { file_path: "src/references/notes.md" }),
        RESULT
      )
    )

    expect(usage?.skillCalls).toEqual({
      "react-native-best-practices": 1,
      "plain-english": 1,
    })
    expect(usage?.skillReferenceReads).toEqual({
      "react-native-best-practices/js-lists-flatlist-flashlist": 2,
      "react-native-best-practices/js-memory-leaks": 1,
    })
  })

  it("counts inline comments that went through", () => {
    const usage = parseReviewUsage(
      executionFile(
        toolCall("a", INLINE),
        toolResult("a"),
        toolCall("b", INLINE),
        toolResult("b", true),
        toolCall("c", "Read"),
        toolResult("c"),
        toolCall("d", INLINE),
        toolResult("d"),
        RESULT
      )
    )

    expect(usage?.inlineComments).toBe(2)
  })

  it("leaves out inline comments sent with confirmed false", () => {
    const usage = parseReviewUsage(
      executionFile(
        toolCall("a", INLINE, { path: "a.ts", line: 1, confirmed: false }),
        toolResult("a"),
        toolCall("b", INLINE, { path: "a.ts", line: 2, confirmed: true }),
        toolResult("b"),
        RESULT
      )
    )

    expect(usage?.inlineComments).toBe(1)
  })

  it("counts a buffered comment sent again confirmed once", () => {
    const comment = { path: "a.ts", line: 3, body: "Bug." }
    const usage = parseReviewUsage(
      executionFile(
        toolCall("a", INLINE, comment),
        toolResult("a"),
        toolCall("b", INLINE, { ...comment, confirmed: true }),
        toolResult("b"),
        RESULT
      )
    )

    expect(usage?.inlineComments).toBe(1)
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
    expect(summary).toContain("| Inline comments | 0 |")
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

describe("formatVolleyPayload", () => {
  const usage = parseReviewUsage(executionFile(RESULT)) as ReviewUsage
  const context = {
    repo: "artsy/eigen",
    prNumber: "42",
    modelArgs: "--model claude-opus-5-5 --effort high",
    reviewMode: "rereview",
    experiment: "true",
  }
  const TAGS = [
    "repo:artsy/eigen",
    "pr:42",
    "group:experiment",
    "mode:rereview",
    "outcome:success",
    "model:claude-opus-5-5",
    "effort:high",
  ]

  it("sends counters and histograms under ai_pr_review, all with the same tags", () => {
    expect(formatVolleyPayload(usage, context)).toEqual({
      serviceName: "ai_pr_review",
      metrics: [
        { type: "increment", name: "reviews", tags: TAGS },
        { type: "incrementBy", name: "cost_cents", value: 77, tags: TAGS },
        {
          type: "incrementBy",
          name: "denied_tool_calls",
          value: 2,
          tags: TAGS,
        },
        ...[
          ["input", 1_000],
          ["cache_write", 20_000],
          ["cache_read", 179_000],
          ["output", 4_321],
        ].map(([kind, value]) => ({
          type: "incrementBy",
          name: "tokens",
          value,
          tags: [...TAGS, `kind:${kind}`],
        })),
        { type: "histogram", name: "cost_usd", value: 0.7712, tags: TAGS },
        { type: "histogram", name: "turns", value: 9, tags: TAGS },
        { type: "histogram", name: "duration_ms", value: 92_400, tags: TAGS },
        { type: "histogram", name: "inline_comments", value: 0, tags: TAGS },
        { type: "histogram", name: "cache_hit_rate", value: 0.895, tags: TAGS },
      ],
    })
  })

  it("tags only the requested model, not background ones", () => {
    const withHaiku = {
      ...usage,
      models: ["claude-haiku-5-5", "claude-opus-5-5"],
    }

    expect(
      formatVolleyPayload(withHaiku, context).metrics[0].tags.filter(tag =>
        tag.startsWith("model:")
      )
    ).toEqual(["model:claude-opus-5-5"])
    expect(
      formatVolleyPayload(withHaiku, { ...context, modelArgs: "" }).metrics[0]
        .tags
    ).toContain("model:claude-haiku-5-5")
  })

  it("leaves out the cache hit rate when the run read no input", () => {
    const noInput = {
      ...usage,
      inputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    }

    expect(
      formatVolleyPayload(noInput, context).metrics.map(metric => metric.name)
    ).not.toContain("cache_hit_rate")
  })

  it("marks standard and unrecorded reviews", () => {
    const tagsFor = (overrides: Partial<typeof context>) =>
      formatVolleyPayload(usage, { ...context, ...overrides }).metrics[0].tags

    expect(tagsFor({ experiment: "false" })).toContain("group:standard")
    expect(tagsFor({ prNumber: "" }).some(tag => tag.startsWith("pr:"))).toBe(
      false
    )
    expect(tagsFor({ experiment: "", reviewMode: "" })).toEqual(
      expect.arrayContaining(["group:unknown", "mode:unknown"])
    )
  })

  it("counts skill calls and reference reads with their names as tags", () => {
    const metrics = formatVolleyPayload(
      {
        ...usage,
        skillCalls: { "react-native-best-practices": 1 },
        skillReferenceReads: {
          "react-native-best-practices/js-memory-leaks": 2,
        },
      },
      context
    ).metrics

    const calls = metrics.find(m => m.name === "skill_calls")
    expect(calls).toMatchObject({ type: "incrementBy", value: 1 })
    expect(calls?.tags).toContain("skill:react-native-best-practices")
    const reads = metrics.find(m => m.name === "skill_reference_reads")
    expect(reads).toMatchObject({ type: "incrementBy", value: 2 })
    expect(reads?.tags).toEqual(
      expect.arrayContaining([
        "skill:react-native-best-practices",
        "reference:js-memory-leaks",
      ])
    )
  })

  it("sends no skill metrics for an older usage record", () => {
    const { skillCalls, skillReferenceReads, ...older } = usage
    expect(
      formatVolleyPayload(older, context).metrics.map(m => m.name)
    ).not.toContain("skill_calls")
  })

  it("tags whether the review was in the best-practices experiment", () => {
    const tags = formatVolleyPayload(usage, {
      ...context,
      bestPractices: "true",
    }).metrics[0].tags
    expect(tags).toContain("best_practices:true")
  })

  it("tags whether the review read related repos", () => {
    const tags = formatVolleyPayload(usage, {
      ...context,
      relatedRepos: "false",
    }).metrics[0].tags
    expect(tags).toContain("related_repos:false")
  })

  it("tags whether the security pass ran, when recorded", () => {
    const tagsFor = (overrides: Partial<MetricsContext>) =>
      formatVolleyPayload(usage, { ...context, ...overrides }).metrics[0].tags

    expect(tagsFor({ securityPass: "true" })).toContain("security:true")
    expect(tagsFor({ securityPass: "false" })).toContain("security:false")
    expect(tagsFor({}).some(tag => tag.startsWith("security:"))).toBe(false)
  })

  it("leaves out the conversation", () => {
    expect(JSON.stringify(formatVolleyPayload(usage, context))).not.toContain(
      "Secret PR text"
    )
  })
})

describe("sendToVolley", () => {
  const fetchMock = jest.fn()
  const log = jest.spyOn(console, "log").mockImplementation(() => {})
  const payload = { serviceName: "ai_pr_review", metrics: [] }

  beforeEach(() => {
    fetchMock.mockReset()
    log.mockClear()
    global.fetch = fetchMock
  })

  it("does nothing without a URL", async () => {
    await sendToVolley(payload, undefined)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts the payload as JSON", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202 })

    await sendToVolley(payload, "https://volley.artsy.net/report")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://volley.artsy.net/report",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("warns instead of failing when the send fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    await expect(
      sendToVolley(payload, "https://volley.artsy.net/report")
    ).resolves.toBeUndefined()

    fetchMock.mockResolvedValue({ ok: false, status: 502 })
    await sendToVolley(payload, "https://volley.artsy.net/report")

    expect(log).toHaveBeenCalledWith(
      "::warning::Could not send review metrics to volley: network down"
    )
    expect(log).toHaveBeenCalledWith(
      "::warning::Volley rejected the review metrics: HTTP 502"
    )
  })
})
