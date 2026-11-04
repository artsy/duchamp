import { FOOTER_SENTINEL, reviewMarker } from "./post-review-summary"
import {
  buildSideBySide,
  earlierSideBySide,
  formatInlineComments,
  latestClaudeSummary,
  MAX_COLUMN_CHARS,
  type ReviewComment,
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

describe("stripTitle", () => {
  it("drops either reviewer's title", () => {
    expect(stripTitle("## Code Review\n\n### Summary\nok")).toBe(
      "### Summary\nok"
    )
    expect(stripTitle("## Codex Review\n### Summary\nok")).toBe(
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
      codex: "## Codex Review\n### Verdict\nApprove",
      headSha: HEAD,
    })

    expect(body).toContain("## AI reviews: Claude | Codex")
    expect(body).toContain("`aaaaaaa`")
    const claudeAt = body.indexOf("Request Changes")
    const codexAt = body.indexOf("Approve")
    expect(claudeAt).toBeGreaterThan(-1)
    expect(codexAt).toBeGreaterThan(claudeAt)
    expect(body).toContain('<td valign="top">\n\n### Verdict')
    expect(body).toContain("**Inline comments (1)**")
    expect(body).not.toContain("## Code Review")
    expect(body.endsWith(SIDE_BY_SIDE_MARKER)).toBe(true)
  })

  it("says which review is missing", () => {
    expect(
      buildSideBySide({
        claude: null,
        claudeInline: "",
        codex: "ok",
        headSha: HEAD,
      })
    ).toContain("Claude's review didn't finish")
    expect(
      buildSideBySide({
        claude: "ok",
        claudeInline: "",
        codex: null,
        headSha: HEAD,
      })
    ).toContain("Codex didn't return a review")
  })

  it("cuts a column that would overflow the comment", () => {
    const body = buildSideBySide({
      claude: "y".repeat(MAX_COLUMN_CHARS + 10),
      claudeInline: "",
      codex: "ok",
      headSha: HEAD,
    })
    expect(body).toContain("…cut to fit the comment.")
    expect(body.length).toBeLessThan(65_536)
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
    ]
    expect(earlierSideBySide(comments, 4).map(c => c.id)).toEqual([1])
  })
})
