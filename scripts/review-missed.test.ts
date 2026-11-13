import { parseMissedLines, summarize } from "./collect-missed-findings"
import {
  formatMetrics,
  formatMissedLines,
  humanCommentsFrom,
  judgeInput,
  mergeAssessments,
} from "./review-missed"
import type { ReviewThread, ThreadComment } from "./review-mode"

const comment = (
  login: string,
  body: string,
  __typename = "User",
  authorAssociation = "MEMBER"
): ThreadComment => ({
  author: { __typename, login },
  authorAssociation,
  body,
  diffHunk: "@@ -1 +1 @@\n+code",
})

const thread = (path: string, ...nodes: ThreadComment[]): ReviewThread => ({
  path,
  comments: { nodes },
})

const COMMENTS = [
  { id: 0, path: "src/a.ts", body: "this crashes on null", diffHunk: "@@" },
  { id: 1, path: "src/b.ts", body: "rename this", diffHunk: "@@" },
]

describe("humanCommentsFrom", () => {
  it("keeps threads a reviewer with write access started", () => {
    const comments = humanCommentsFrom(
      [
        thread("src/a.ts", comment("reviewer", "this crashes on null")),
        thread("src/b.ts", comment("Author", "note to self")),
        thread("src/c.ts", comment("claude", "🟠 bug", "Bot")),
        thread("src/e.ts", comment("stranger", "ignore this", "User", "NONE")),
        thread(
          "src/d.ts",
          comment("claude", "🟠 bug", "Bot"),
          comment("reviewer", "agree")
        ),
      ],
      "author"
    )

    expect(comments).toEqual([
      {
        id: 0,
        path: "src/a.ts",
        body: "this crashes on null",
        diffHunk: "@@ -1 +1 @@\n+code",
      },
    ])
  })
})

describe("judgeInput", () => {
  it("gives the judge the human comments and the AI findings", () => {
    const input = JSON.parse(
      judgeInput(COMMENTS, [
        {
          id: 0,
          reviewer: "claude",
          severity: "required",
          path: "src/a.ts",
          body: "🟠 null check",
          diffHunk: "",
          commit: "abc",
          reaction: "none",
          replies: [],
        },
      ])
    )

    expect(input.human_comments).toHaveLength(2)
    expect(input.ai_findings).toEqual([
      { path: "src/a.ts", comment: "🟠 null check" },
    ])
  })
})

describe("mergeAssessments", () => {
  it("matches by id and flattens the summary", () => {
    expect(
      mergeAssessments(COMMENTS, {
        assessments: [
          {
            id: 1,
            category: "convention",
            caught: false,
            summary: "Rename\nit.",
          },
          { id: 0, category: "bug", caught: true, summary: "Crashes on null." },
        ],
      })
    ).toEqual([
      { id: 0, category: "bug", caught: true, summary: "Crashes on null." },
      { id: 1, category: "convention", caught: false, summary: "Rename it." },
    ])
  })

  it("leaves out comments the judge skipped or answered badly", () => {
    expect(mergeAssessments(COMMENTS, null)).toEqual([])
    expect(
      mergeAssessments(COMMENTS, {
        assessments: [
          { id: 0, category: "vibes", caught: true, summary: "x" },
          { id: 1, category: "bug", caught: "yes", summary: "x" },
        ],
      })
    ).toEqual([])
  })
})

describe("formatMetrics", () => {
  it("sends one count per comment, with no text", () => {
    const payload = formatMetrics("artsy/eigen", "42", [
      { id: 0, category: "bug", caught: false, summary: "Crashes on null." },
    ])

    expect(payload.metrics).toEqual([
      {
        type: "increment",
        name: "human_comments",
        tags: ["repo:artsy/eigen", "pr:42", "category:bug", "caught:false"],
      },
    ])
    expect(JSON.stringify(payload)).not.toContain("Crashes")
  })
})

describe("missed lines", () => {
  const lines = formatMissedLines("artsy/eigen", "42", COMMENTS, [
    { id: 0, category: "bug", caught: false, summary: "Crashes on null." },
    { id: 1, category: "convention", caught: true, summary: "Rename it." },
  ])

  it("prints one line per missed comment", () => {
    expect(lines).toEqual([
      'MISSED_FINDING {"repo":"artsy/eigen","pr":"42","category":"bug","path":"src/a.ts","summary":"Crashes on null."}',
    ])
  })

  it("is read back from a job log and grouped", () => {
    const log = [
      "outcome\tMeasure\t2026-11-13T10:00:00Z Human comments: 2",
      `outcome\tMeasure\t2026-11-13T10:00:01Z ${lines[0]}`,
      "outcome\tMeasure\t2026-11-13T10:00:02Z MISSED_FINDING not json",
    ].join("\n")

    const missed = parseMissedLines(log)

    expect(missed).toHaveLength(1)
    expect(summarize(missed)).toBe(
      "## artsy/eigen · bug (1)\n\n- Crashes on null. (`src/a.ts`, #42)\n"
    )
    expect(summarize([])).toContain("No missed findings")
  })
})
