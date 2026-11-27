import { FOOTER_SENTINEL, reviewMarker } from "./post-review-summary"
import {
  buildSideBySide,
  earlierSideBySide,
  type Finding,
  formatExtraComments,
  formatInlineComments,
  latestClaudeSummary,
  MAX_COLUMN_CHARS,
  parseReviewOutput,
  type ReviewComment,
  ranReviewers,
  SIDE_BY_SIDE_MARKER,
  stripTitle,
} from "./post-side-by-side"
import {
  GEMINI_REVIEW_END,
  GEMINI_REVIEW_START,
  geminiReviewMarker,
} from "./review-mode"

const HEAD = "a".repeat(40)
const OLD = "b".repeat(40)

const bot = (login: string) => ({ login, type: "Bot" })

describe("latestClaudeSummary", () => {
  it("takes the newest summary and drops the footer", () => {
    const comments = [
      { id: 1, user: bot("claude[bot]"), body: "## Code Review\nold" },
      {
        id: 2,
        user: bot("github-actions[bot]"),
        body: `## Code Review\nnew\n\n${FOOTER_SENTINEL}\nstats\n\n${reviewMarker(HEAD)}`,
      },
      { id: 3, user: bot("github-actions[bot]"), body: "version label" },
    ]
    expect(latestClaudeSummary(comments, HEAD)).toBe("## Code Review\nnew")
  })

  it("reads a summary Claude posted itself", () => {
    const comments = [
      { id: 1, user: bot("claude[bot]"), body: "## Code Review\nfine" },
    ]
    expect(latestClaudeSummary(comments, HEAD)).toBe("## Code Review\nfine")
  })

  it("ignores a summary of an earlier commit", () => {
    const comments = [
      {
        id: 1,
        user: bot("github-actions[bot]"),
        body: `## Code Review\nold\n\n${FOOTER_SENTINEL}\n${reviewMarker(OLD)}`,
      },
    ]
    expect(latestClaudeSummary(comments, HEAD)).toBeNull()
  })

  it("is null with no summary", () => {
    expect(latestClaudeSummary([], HEAD)).toBeNull()
  })
})

describe("formatInlineComments", () => {
  const comment = (over: Partial<ReviewComment>): ReviewComment => ({
    user: { login: "claude[bot]" },
    body: "🔴 **blocking:** `artist` can be null. Guard it.",
    path: "src/Rail.tsx",
    line: 41,
    original_line: 41,
    original_commit_id: HEAD,
    ...over,
  })

  it("lists Claude's comments on this commit, one line each", () => {
    const out = formatInlineComments(
      [
        comment({}),
        comment({ body: "🟠 **required:** no rollback.\n\nLonger reason." }),
        comment({ original_commit_id: OLD }),
        comment({ user: { login: "someone" } }),
        comment({ in_reply_to_id: 7 }),
      ],
      HEAD
    )
    expect(out).toBe(
      [
        "---",
        "",
        "**Inline comments (2)**",
        "- `src/Rail.tsx:41` 🔴 **blocking:** `artist` can be null. Guard it.",
        "- `src/Rail.tsx:41` 🟠 **required:** no rollback.",
      ].join("\n")
    )
  })

  it("falls back to the original line when the line moved", () => {
    expect(formatInlineComments([comment({ line: null })], HEAD)).toContain(
      "`src/Rail.tsx:41`"
    )
  })

  it("cuts long first lines", () => {
    const out = formatInlineComments([comment({ body: "x".repeat(300) })], HEAD)
    expect(out).toContain(`${"x".repeat(200)}…`)
  })

  it("is empty when there are none", () => {
    expect(formatInlineComments([], HEAD)).toBe("")
  })
})

describe("parseReviewOutput", () => {
  it("treats an Antigravity envelope that didn't succeed as no review", () => {
    for (const status of ["ERROR", "CANCELED", "INTERRUPTED"]) {
      const out = parseReviewOutput(
        JSON.stringify({
          status,
          response: "I started reviewing the workflow and then",
          error: "deadline exceeded",
        })
      )
      expect(out).toBeNull()
    }
  })

  it("reads the summary and the well-formed comments", () => {
    const out = parseReviewOutput(
      JSON.stringify({
        summary: "## Code Review\nok",
        comments: [
          { path: "a.ts", line: 3, body: "🔴 **blocking:** x." },
          { path: "b.ts", line: 1.5, body: "bad line" },
          { path: "c.ts", line: 2, body: "  " },
          { line: 4, body: "no path" },
        ],
      })
    )
    expect(out).toEqual({
      summary: "## Code Review\nok",
      comments: [{ path: "a.ts", line: 3, body: "🔴 **blocking:** x." }],
    })
  })

  it("keeps text that isn't the schema as the summary", () => {
    expect(parseReviewOutput("## Code Review\nplain")).toEqual({
      summary: "## Code Review\nplain",
      comments: [],
    })
    expect(parseReviewOutput('{"verdict":"ok"}')).toEqual({
      summary: '{"verdict":"ok"}',
      comments: [],
    })
  })

  it("unwraps Antigravity's JSON envelope", () => {
    const envelope = JSON.stringify({
      status: "success",
      response: JSON.stringify({
        summary: "S",
        comments: [{ path: "a.ts", line: 3, body: "🔵 x" }],
      }),
      usage: {},
    })
    expect(parseReviewOutput(envelope)).toEqual({
      summary: "S",
      comments: [{ path: "a.ts", line: 3, body: "🔵 x" }],
    })
  })

  it("prefers the envelope's structured_output", () => {
    const envelope = JSON.stringify({
      status: "SUCCESS",
      response: "free text",
      structured_output: { summary: "S", comments: [] },
    })
    expect(parseReviewOutput(envelope)).toEqual({ summary: "S", comments: [] })
  })

  it("keeps an envelope's plain-text response as the summary", () => {
    expect(
      parseReviewOutput(JSON.stringify({ response: "plain words" }))
    ).toEqual({ summary: "plain words", comments: [] })
  })

  it("reads JSON inside a code fence", () => {
    expect(
      parseReviewOutput('```json\n{"summary":"S","comments":[]}\n```')
    ).toEqual({ summary: "S", comments: [] })
  })

  it("is null with no message", () => {
    expect(parseReviewOutput(" \n")).toBeNull()
  })
})

describe("formatExtraComments", () => {
  const finding = (path: string, line: number): Finding => ({
    path,
    line,
    body: "🟠 **required:** y.\n\nWhy.",
  })

  it("lists posted comments, then the ones off the diff", () => {
    expect(
      formatExtraComments([finding("a.ts", 1)], [finding("b.ts", 9)])
    ).toBe(
      [
        "---",
        "",
        "**Inline comments (1)**",
        "- `a.ts:1` 🟠 **required:** y.",
        "",
        "**Not on a changed line, so not posted inline (1)**",
        "- `b.ts:9` 🟠 **required:** y.",
      ].join("\n")
    )
  })

  it("is empty with no comments", () => {
    expect(formatExtraComments([], [])).toBe("")
  })
})

describe("stripTitle", () => {
  it("drops either reviewer's title", () => {
    expect(stripTitle("## Code Review\n\n### Summary\nok")).toBe(
      "### Summary\nok"
    )
    expect(stripTitle("## Gemini Review\n### Summary\nok")).toBe(
      "### Summary\nok"
    )
  })

  it("leaves other text alone", () => {
    expect(stripTitle("### Summary\nok")).toBe("### Summary\nok")
  })
})

describe("buildSideBySide", () => {
  it("marks Gemini's review and commit, so its next run can re-review from it", () => {
    const body = buildSideBySide({
      claude: "## Code Review\nok",
      claudeInline: "",
      others: [
        {
          name: "Gemini",
          summary: "## Code Review\n### Summary\nGemini's notes",
          inline: "",
        },
      ],
      headSha: HEAD,
    })

    expect(body).toContain(geminiReviewMarker(HEAD))
    const start = body.indexOf(GEMINI_REVIEW_START)
    const end = body.indexOf(GEMINI_REVIEW_END)
    expect(body.slice(start, end)).toContain("Gemini's notes")
    expect(body.slice(start, end)).not.toContain("ok")
    expect(body.endsWith(SIDE_BY_SIDE_MARKER)).toBe(true)
  })

  it("leaves Gemini's markers out when it didn't return a review", () => {
    const body = buildSideBySide({
      claude: "## Code Review\nok",
      claudeInline: "",
      others: [{ name: "Gemini", summary: null, inline: "" }],
      headSha: HEAD,
    })

    expect(body).not.toContain("ai-review-gemini-sha")
    expect(body).not.toContain(GEMINI_REVIEW_START)
  })

  it("puts Claude left and Gemini right, with Markdown-friendly cells", () => {
    const body = buildSideBySide({
      claude: "## Code Review\n### Verdict\nRequest Changes",
      claudeInline: "---\n\n**Inline comments (1)**\n- `a.ts:1` 🔴 x",
      others: [
        {
          name: "Gemini",
          summary: "## Gemini Review\n### Verdict\nApprove",
          inline: "---\n\n**Inline comments (1)**\n- `b.ts:2` 🟠 y",
        },
      ],
      headSha: HEAD,
    })

    expect(body).toContain("## AI reviews: Claude | Gemini")
    expect(body).toContain("`aaaaaaa`")
    const claudeAt = body.indexOf("Request Changes")
    const geminiAt = body.indexOf("Approve")
    expect(claudeAt).toBeGreaterThan(-1)
    expect(geminiAt).toBeGreaterThan(claudeAt)
    expect(body).toContain('<td valign="top">\n\n### Verdict')
    expect(body).toContain("- `a.ts:1` 🔴 x")
    expect(body.indexOf("- `b.ts:2` 🟠 y")).toBeGreaterThan(geminiAt)
    expect(body).not.toContain("## Code Review")
    expect(body.endsWith(SIDE_BY_SIDE_MARKER)).toBe(true)
  })

  it("says which review is missing", () => {
    expect(
      buildSideBySide({
        claude: null,
        claudeInline: "",
        others: [{ name: "Gemini", summary: "ok", inline: "" }],
        headSha: HEAD,
      })
    ).toContain("Claude's review didn't finish")
    expect(
      buildSideBySide({
        claude: "ok",
        claudeInline: "",
        others: [{ name: "Gemini", summary: null, inline: "" }],
        headSha: HEAD,
      })
    ).toContain("Gemini didn't return a review")
  })

  it("cuts a column that would overflow the comment", () => {
    const body = buildSideBySide({
      claude: "y".repeat(MAX_COLUMN_CHARS + 10),
      claudeInline: "",
      others: [{ name: "Gemini", summary: "ok", inline: "" }],
      headSha: HEAD,
    })
    expect(body).toContain("…cut to fit the comment.")
    expect(body.length).toBeLessThan(65_536)
  })

  it("says when Gemini returned nothing", () => {
    const body = buildSideBySide({
      claude: "ok",
      claudeInline: "",
      others: [{ name: "Gemini", summary: null, inline: "" }],
      headSha: HEAD,
    })
    expect(body).toContain("## AI reviews: Claude | Gemini")
    expect(body).toContain("Gemini didn't return a review on this push.")
    expect(body).toContain('width="50%"')
    expect(body).toContain("Gemini didn't see Claude's review.")
  })
})

describe("ranReviewers", () => {
  it("lists Gemini when its job ran", () => {
    expect(
      ranReviewers({
        GEMINI_RAN: "true",
        GEMINI_REVIEW_FILE: "/t/gemini.json",
      }).map(r => [r.name, r.prefix, r.file])
    ).toEqual([["Gemini", "**Gemini:**", "/t/gemini.json"]])
  })

  it("leaves Gemini out when its job didn't run", () => {
    expect(ranReviewers({ GEMINI_RAN: "false" })).toEqual([])
    expect(ranReviewers({})).toEqual([])
  })
})

describe("earlierSideBySide", () => {
  it("finds the workflow's earlier side-by-side comments only", () => {
    const comments = [
      {
        id: 1,
        user: bot("github-actions[bot]"),
        body: `a\n${SIDE_BY_SIDE_MARKER}`,
      },
      { id: 2, user: bot("github-actions[bot]"), body: "version label" },
      {
        id: 3,
        user: { login: "someone", type: "User" },
        body: SIDE_BY_SIDE_MARKER,
      },
      {
        id: 4,
        user: bot("github-actions[bot]"),
        body: `b\n${SIDE_BY_SIDE_MARKER}`,
      },
      {
        id: 5,
        user: bot("github-actions[bot]"),
        body: `quotes ${SIDE_BY_SIDE_MARKER} mid-text\n${FOOTER_SENTINEL}`,
      },
    ]
    expect(earlierSideBySide(comments, 4).map(c => c.id)).toEqual([1])
  })
})
