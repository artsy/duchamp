import {
  median,
  parseArgs,
  parseUsageLines,
  type RunUsage,
  summarize,
  type UsageRecord,
  windowFor,
} from "./collect-review-usage"

const usage = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  outcome: "success",
  models: ["claude-opus-5-5"],
  costUsd: 1,
  turns: 10,
  durationMs: 120_000,
  inputTokens: 0,
  cacheWriteTokens: 10_000,
  cacheReadTokens: 90_000,
  outputTokens: 1_000,
  permissionDenials: 0,
  modelArgs: "--effort high",
  reviewMode: null,
  ...overrides,
})

const run = (createdAt: string, overrides: Partial<UsageRecord>): RunUsage => ({
  repo: "eigen",
  runId: 1,
  createdAt,
  usage: usage(overrides),
})

describe("parseArgs", () => {
  it("reads repos, since, splits and workflow", () => {
    expect(
      parseArgs([
        "--repos",
        "eigen, force",
        "--since",
        "2026-10-14",
        "--split",
        "2026-10-29",
        "--split",
        "2026-10-22",
        "--workflow",
        "review.yml",
      ])
    ).toEqual({
      repos: ["eigen", "force"],
      since: "2026-10-14",
      splits: ["2026-10-22", "2026-10-29"],
      workflow: "review.yml",
    })
  })

  it("defaults the workflow file", () => {
    expect(
      parseArgs(["--repos", "eigen", "--since", "2026-10-14"]).workflow
    ).toBe("run-claude-review.yml")
  })

  it("requires repos and since", () => {
    expect(() => parseArgs(["--repos", "eigen"])).toThrow("Usage")
  })
})

describe("parseUsageLines", () => {
  it("reads the JSON after the prefix, past the log columns", () => {
    const log = [
      "claude-review / review\tReport review usage\t2026-10-21T09:00:00.0Z ## AI review usage",
      `claude-review / review\tReport review usage\t2026-10-21T09:00:00.1Z REVIEW_USAGE ${JSON.stringify(usage({ turns: 7 }))}`,
      "claude-review / review\tComplete job\t2026-10-21T09:00:01.0Z Cleaning up",
    ].join("\n")

    const records = parseUsageLines(log)

    expect(records).toHaveLength(1)
    expect(records[0].turns).toBe(7)
  })

  it("skips a line whose JSON is cut off", () => {
    expect(parseUsageLines('REVIEW_USAGE {"costUsd": 1')).toEqual([])
  })

  it("returns nothing for a log without the line", () => {
    expect(parseUsageLines("Review mode: skip")).toEqual([])
  })
})

describe("windowFor", () => {
  const splits = ["2026-10-22", "2026-10-29"]

  it("is null before since", () => {
    expect(windowFor("2026-10-13T23:00:00Z", "2026-10-14", splits)).toBeNull()
  })

  it("puts a run in the window its day falls in", () => {
    expect(windowFor("2026-10-14T00:00:00Z", "2026-10-14", splits)).toBe(
      "2026-10-14 to 2026-10-22"
    )
    expect(windowFor("2026-10-22T08:00:00Z", "2026-10-14", splits)).toBe(
      "2026-10-22 to 2026-10-29"
    )
    expect(windowFor("2026-11-02T08:00:00Z", "2026-10-14", splits)).toBe(
      "2026-10-29 on"
    )
  })

  it("has one open window without splits", () => {
    expect(windowFor("2026-10-20T00:00:00Z", "2026-10-14", [])).toBe(
      "2026-10-14 on"
    )
  })
})

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe("summarize", () => {
  it("has one row per window and mode", () => {
    const table = summarize(
      [
        run("2026-10-15T00:00:00Z", { costUsd: 1, turns: 14 }),
        run("2026-10-16T00:00:00Z", { costUsd: 2, turns: 16 }),
        run("2026-10-23T00:00:00Z", { costUsd: 0.5, reviewMode: "full" }),
        run("2026-10-24T00:00:00Z", { costUsd: 0.2, reviewMode: "rereview" }),
        run("2026-10-01T00:00:00Z", { costUsd: 99 }),
      ],
      "2026-10-14",
      ["2026-10-22"]
    )

    const rows = table.split("\n").slice(2)
    expect(rows).toEqual([
      "| 2026-10-14 to 2026-10-22 | all | 2 | $1.50 | 15 | 2m 00s | 90.0% | $3.00 |",
      "| 2026-10-22 on | full | 1 | $0.50 | 10 | 2m 00s | 90.0% | $0.50 |",
      "| 2026-10-22 on | rereview | 1 | $0.20 | 10 | 2m 00s | 90.0% | $0.20 |",
    ])
  })
})
