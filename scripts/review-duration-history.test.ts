import {
  evenSample,
  isReviewRun,
  monthRanges,
  parseArgs,
  type ReviewTiming,
  type Run,
  reviewTiming,
  sampleByWeek,
  summarize,
  weekOf,
} from "./review-duration-history"

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 1,
  created_at: "2026-10-21T10:00:00Z",
  run_started_at: "2026-10-21T10:00:00Z",
  updated_at: "2026-10-21T10:03:00Z",
  actor: "someone",
  ...overrides,
})

const step = (name: string, start: string, end: string | null) => ({
  name,
  conclusion: end ? "success" : null,
  started_at: start,
  completed_at: end,
})

describe("parseArgs", () => {
  it("defaults until to today and samples 10 a week", () => {
    expect(
      parseArgs(
        ["--repos", "eigen, force", "--since", "2026-01-29"],
        "2026-10-27"
      )
    ).toEqual({
      repos: ["eigen", "force"],
      since: "2026-01-29",
      until: "2026-10-27",
      perWeek: 10,
      excludeAuthors: [],
      workflow: "run-claude-review.yml",
    })
  })

  it("collects every excluded author", () => {
    expect(
      parseArgs(
        [
          "--repos",
          "eigen",
          "--since",
          "2026-01-29",
          "--exclude-author",
          "a",
          "--exclude-author",
          "b",
        ],
        "2026-10-27"
      ).excludeAuthors
    ).toEqual(["a", "b"])
  })

  it("needs repos and a start date", () => {
    expect(() => parseArgs(["--repos", "eigen"], "2026-10-27")).toThrow("Usage")
  })

  it("rejects a per-week that is not a positive number", () => {
    expect(() =>
      parseArgs(
        ["--repos", "eigen", "--since", "2026-01-29", "--per-week", "none"],
        "2026-10-27"
      )
    ).toThrow("--per-week")
  })
})

describe("monthRanges", () => {
  it("splits into calendar months and ends on the last day", () => {
    expect(monthRanges("2026-01-29", "2026-03-10")).toEqual([
      "2026-01-29..2026-01-31",
      "2026-02-01..2026-02-28",
      "2026-03-01..2026-03-10",
    ])
  })

  it("keeps a range inside one month", () => {
    expect(monthRanges("2026-10-02", "2026-10-27")).toEqual([
      "2026-10-02..2026-10-27",
    ])
  })
})

describe("weekOf", () => {
  it("is the Monday of the week", () => {
    expect(weekOf("2026-10-21T10:00:00Z")).toBe("2026-10-19")
    expect(weekOf("2026-10-25T23:59:00Z")).toBe("2026-10-19")
    expect(weekOf("2026-10-26T00:00:00Z")).toBe("2026-10-26")
  })
})

describe("isReviewRun", () => {
  it("keeps runs that reached the review", () => {
    expect(isReviewRun(run(), [])).toBe(true)
  })

  it("drops runs that stopped at the check job", () => {
    expect(isReviewRun(run({ updated_at: "2026-10-21T10:00:30Z" }), [])).toBe(
      false
    )
  })

  it("drops excluded authors", () => {
    expect(isReviewRun(run({ actor: "someone" }), ["someone"])).toBe(false)
  })
})

describe("evenSample", () => {
  it("keeps short lists whole", () => {
    expect(evenSample([1, 2, 3], 5)).toEqual([1, 2, 3])
  })

  it("spreads the picks across the list", () => {
    expect(evenSample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([0, 3, 6])
  })
})

describe("sampleByWeek", () => {
  it("caps each week separately", () => {
    const runs = [
      run({ id: 1, created_at: "2026-10-20T10:00:00Z" }),
      run({ id: 2, created_at: "2026-10-21T10:00:00Z" }),
      run({ id: 3, created_at: "2026-10-22T10:00:00Z" }),
      run({ id: 4, created_at: "2026-10-27T10:00:00Z" }),
    ]

    expect(sampleByWeek(runs, 2).map(r => r.id)).toEqual([1, 2, 4])
  })
})

describe("reviewTiming", () => {
  const job = {
    name: "claude-review / review",
    conclusion: "success",
    started_at: "2026-10-21T10:00:00Z",
    completed_at: "2026-10-21T10:04:00Z",
    steps: [
      step("Checkout", "2026-10-21T10:00:00Z", "2026-10-21T10:00:10Z"),
      step(
        "Run Claude Code Review",
        "2026-10-21T10:01:00Z",
        "2026-10-21T10:03:30Z"
      ),
    ],
  }

  it("reads the job and Claude step times", () => {
    expect(reviewTiming("eigen", run(), [job])).toEqual({
      repo: "eigen",
      created: "2026-10-21T10:00:00Z",
      jobSeconds: 240,
      claudeSeconds: 150,
    })
  })

  it("keeps the job time when GitHub dropped the steps", () => {
    expect(
      reviewTiming("eigen", run(), [{ ...job, steps: [] }])?.claudeSeconds
    ).toBeNull()
  })

  it("skips a review job that did not succeed", () => {
    expect(
      reviewTiming("eigen", run(), [{ ...job, conclusion: "skipped" }])
    ).toBeNull()
  })

  it("skips a run without a review job", () => {
    expect(
      reviewTiming("eigen", run(), [{ ...job, name: "claude-review / check" }])
    ).toBeNull()
  })
})

describe("summarize", () => {
  const timing = (
    created: string,
    jobSeconds: number,
    claudeSeconds: number | null,
    repo = "eigen"
  ): ReviewTiming => ({ repo, created, jobSeconds, claudeSeconds })

  it("prints a row per month and per week", () => {
    const table = summarize([
      timing("2026-09-30T10:00:00Z", 120, null),
      timing("2026-10-01T10:00:00Z", 180, 120, "force"),
      timing("2026-10-02T10:00:00Z", 240, 180),
    ])

    expect(table).toContain("| 2026-09 | 1 | 1 | 2m 00s | 2m 00s | - |")
    expect(table).toContain(
      "| 2026-10 | 2 | 2 | 3m 30s | 4m 00s | 2m 30s (2) |"
    )
    expect(table).toContain("| 2026-09-28 | 3 | 3m 00s |")
  })
})
