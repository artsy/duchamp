import { geminiMetrics, parseAgyUsage } from "./gemini-usage"

describe("parseAgyUsage", () => {
  it("reads the documented envelope: uppercase status, seconds, cache_read_tokens", () => {
    expect(
      parseAgyUsage({
        status: "SUCCESS",
        usage: { input_tokens: 50, output_tokens: 5, cache_read_tokens: 20 },
        num_turns: 3,
        duration_seconds: 12.5,
      })
    ).toEqual({
      status: "success",
      inputTokens: 50,
      outputTokens: 5,
      cachedTokens: 20,
      turns: 3,
      durationMs: 12_500,
    })
  })

  it("reads tokens, turns, duration and status from the envelope", () => {
    expect(
      parseAgyUsage({
        status: "success",
        usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 600 },
        num_turns: 7,
        duration_ms: 90_000,
      })
    ).toEqual({
      status: "success",
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 600,
      turns: 7,
      durationMs: 90_000,
    })
  })

  it("reads the alternate field names, and cost when present", () => {
    expect(
      parseAgyUsage({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          cache_read_input_tokens: 4,
          total_cost_usd: 0.42,
        },
      })
    ).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cachedTokens: 4,
      costUsd: 0.42,
    })
  })

  it("is null for anything that isn't an object", () => {
    expect(parseAgyUsage(null)).toBeNull()
    expect(parseAgyUsage("text")).toBeNull()
  })
})

describe("geminiMetrics", () => {
  const context = {
    repo: "artsy/eigen",
    prNumber: "42",
    reviewMode: "full",
    inlineComments: 3,
    durationMs: 60_000,
  }

  it("tags every metric with the reviewer and model, and skips cost when unknown", () => {
    const metrics = geminiMetrics(
      { status: "success", inputTokens: 1000, outputTokens: 200, turns: 7 },
      context
    )
    for (const metric of metrics) {
      expect(metric.tags).toEqual(
        expect.arrayContaining([
          "repo:artsy/eigen",
          "pr:42",
          "mode:full",
          "outcome:success",
          "model:gemini-neon-4",
          "reviewer:gemini",
        ])
      )
    }
    const names = metrics.map(m => m.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "reviews",
        "tokens",
        "turns",
        "duration_ms",
        "inline_comments",
      ])
    )
    expect(names).not.toContain("cost_cents")
    expect(metrics).toContainEqual({
      type: "histogram",
      name: "duration_ms",
      value: 60_000,
      tags: expect.any(Array),
    })
  })

  it("sends cost in cents and dollars when the envelope has it", () => {
    const metrics = geminiMetrics({ status: "success", costUsd: 0.42 }, context)
    expect(metrics).toContainEqual(
      expect.objectContaining({ name: "cost_cents", value: 42 })
    )
    expect(metrics).toContainEqual(
      expect.objectContaining({ name: "cost_usd", value: 0.42 })
    )
  })

  it("still counts a review that returned nothing, as an error", () => {
    const metrics = geminiMetrics(null, { ...context, inlineComments: 0 })
    expect(metrics).toContainEqual({
      type: "increment",
      name: "reviews",
      tags: expect.arrayContaining(["outcome:error", "reviewer:gemini"]),
    })
    expect(metrics.map(m => m.name)).not.toContain("tokens")
  })
})
