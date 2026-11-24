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
    expect(stripTitle("## Codex Review\n### Summary\nok")).toBe(
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
  it("puts Claude left and Codex right, with Markdown-friendly cells", () => {
    const body = buildSideBySide({
      claude: "## Code Review\n### Verdict\nRequest Changes",
      claudeInline: "---\n\n**Inline comments (1)**\n- `a.ts:1` 🔴 x",
      others: [
        {
          name: "Codex",
          summary: "## Codex Review\n### Verdict\nApprove",
          inline: "---\n\n**Inline comments (1)**\n- `b.ts:2` 🟠 y",
        },
      ],
      headSha: HEAD,
    })

    expect(body).toContain("## AI reviews: Claude | Codex")
    expect(body).toContain("`aaaaaaa`")
    const claudeAt = body.indexOf("Request Changes")
    const codexAt = body.indexOf("Approve")
    expect(claudeAt).toBeGreaterThan(-1)
    expect(codexAt).toBeGreaterThan(claudeAt)
    expect(body).toContain('<td valign="top">\n\n### Verdict')
    expect(body).toContain("- `a.ts:1` 🔴 x")
    expect(body.indexOf("- `b.ts:2` 🟠 y")).toBeGreaterThan(codexAt)
    expect(body).not.toContain("## Code Review")
    expect(body.endsWith(SIDE_BY_SIDE_MARKER)).toBe(true)
  })

  it("says which review is missing", () => {
    expect(
      buildSideBySide({
        claude: null,
        claudeInline: "",
        others: [{ name: "Codex", summary: "ok", inline: "" }],
        headSha: HEAD,
      })
    ).toContain("Claude's review didn't finish")
    expect(
      buildSideBySide({
        claude: "ok",
        claudeInline: "",
        others: [{ name: "Codex", summary: null, inline: "" }],
        headSha: HEAD,
      })
    ).toContain("Codex didn't return a review")
  })

  it("cuts a column that would overflow the comment", () => {
    const body = buildSideBySide({
      claude: "y".repeat(MAX_COLUMN_CHARS + 10),
      claudeInline: "",
      others: [{ name: "Codex", summary: "ok", inline: "" }],
      headSha: HEAD,
    })
    expect(body).toContain("…cut to fit the comment.")
    expect(body.length).toBeLessThan(65_536)
  })

  it("keeps three overflowing columns under GitHub's limit", () => {
    const long = "y".repeat(MAX_COLUMN_CHARS + 10)
    const body = buildSideBySide({
      claude: long,
      claudeInline: "",
      others: [
        { name: "Codex", summary: long, inline: "" },
        { name: "Gemini", summary: long, inline: "" },
      ],
      headSha: HEAD,
    })
    expect(body.length).toBeLessThan(65_536)
  })

  it("shows Claude, Codex and Gemini in three columns", () => {
    const body = buildSideBySide({
      claude: "## Code Review\nC",
      claudeInline: "",
      others: [
        { name: "Codex", summary: "X", inline: "" },
        { name: "Gemini", summary: "## Gemini Review\nG", inline: "" },
      ],
      headSha: HEAD,
    })
    expect(body).toContain("## AI reviews: Claude | Codex | Gemini")
    expect(body).toContain('width="33%"')
    expect(body).toContain("All reviewed `aaaaaaa` from the same prompt.")
    expect(body).not.toContain("## Gemini Review")
    expect(body.indexOf("G\n")).toBeGreaterThan(body.indexOf("X\n"))
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
  it("lists every reviewer whose job ran, Codex first", () => {
    expect(
      ranReviewers({
        CODEX_RAN: "true",
        CODEX_REVIEW_FILE: "/t/codex.json",
        GEMINI_RAN: "true",
        GEMINI_REVIEW_FILE: "/t/gemini.json",
      }).map(r => [r.name, r.prefix, r.file])
    ).toEqual([
      ["Codex", "**Codex:**", "/t/codex.json"],
      ["Gemini", "**Gemini:**", "/t/gemini.json"],
    ])
  })

  it("leaves out a reviewer whose job didn't run", () => {
    expect(
      ranReviewers({ CODEX_RAN: "false", GEMINI_RAN: "true" }).map(r => r.name)
    ).toEqual(["Gemini"])
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
