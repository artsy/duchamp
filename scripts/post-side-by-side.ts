import { execFileSync } from "child_process"
import * as fs from "fs"
import { isReviewSummary } from "./post-review-summary"
import { stripReviewFooter } from "./review-mode"

/**
 * For Codex experiment PRs: posts Codex's inline comments, then one comment with
 * Claude's review and Codex's side by side. Claude's own summary comment stays,
 * because re-reviews find the previous review through its marker.
 */

/** Marks the side-by-side comment, so the next run can replace it. */
export const SIDE_BY_SIDE_MARKER = "<!-- ai-review-side-by-side -->"

/** GitHub rejects comments over 65,536 characters; this leaves room for the table. */
export const MAX_COLUMN_CHARS = 30_000

const MAX_INLINE_LINE_CHARS = 200

/** Starts each inline comment Codex posts, so cleanup-ai-reviews.js can find them. */
export const CODEX_COMMENT_PREFIX = "**Codex:**"

export interface CodexFinding {
  path: string
  line: number
  body: string
}

interface IssueComment {
  id: number
  user: { login: string; type: string } | null
  body: string | null
}

export interface ReviewComment {
  user: { login: string } | null
  body: string | null
  path: string
  line: number | null
  original_line: number | null
  original_commit_id: string
  in_reply_to_id?: number
}

/**
 * The newest review summary, without the workflow's footer. Null when its marker names
 * another commit: the run returned no summary and an earlier one is still up. Comments
 * arrive oldest first.
 */
export const latestClaudeSummary = (
  comments: IssueComment[],
  headSha: string
): string | null => {
  const summaries = comments.filter(isReviewSummary)
  const body = summaries[summaries.length - 1]?.body
  if (!body) {
    return null
  }
  const marked = body.match(/<!-- ai-review-sha: ([0-9a-f]{40}) -->/)
  return marked && marked[1] !== headSha ? null : stripReviewFooter(body)
}

const oneLine = (path: string, line: number | string, body: string): string => {
  const first = body.trim().split("\n")[0]
  const text =
    first.length > MAX_INLINE_LINE_CHARS
      ? `${first.slice(0, MAX_INLINE_LINE_CHARS)}…`
      : first
  return `- \`${path}:${line}\` ${text}`
}

/** Claude's inline comments on the reviewed commit, one line each. */
export const formatInlineComments = (
  comments: ReviewComment[],
  headSha: string
): string => {
  const lines = comments
    .filter(
      c =>
        c.user?.login === "claude[bot]" &&
        c.original_commit_id === headSha &&
        !c.in_reply_to_id
    )
    .map(c => oneLine(c.path, c.line ?? c.original_line ?? "?", c.body ?? ""))

  return lines.length > 0
    ? `---\n\n**Inline comments (${lines.length})**\n${lines.join("\n")}`
    : ""
}

/**
 * Codex's final message, in codex-experiment/output-schema.json. Text that isn't
 * that JSON is kept as the summary, so a review still shows when Codex ignores the
 * schema. Null when there is no message.
 */
export const parseCodexOutput = (
  text: string
): { summary: string; comments: CodexFinding[] } | null => {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed?.summary === "string") {
      const comments = Array.isArray(parsed.comments)
        ? parsed.comments.filter(
            (c: Partial<CodexFinding>): c is CodexFinding =>
              typeof c?.path === "string" &&
              Number.isInteger(c?.line) &&
              typeof c?.body === "string" &&
              c.body.trim().length > 0
          )
        : []
      return { summary: parsed.summary, comments }
    }
  } catch {
    // Not JSON: fall through and keep the text
  }
  return { summary: trimmed, comments: [] }
}

/** Codex's inline comments for its column: posted ones, then ones off the diff. */
export const formatCodexComments = (
  posted: CodexFinding[],
  unposted: CodexFinding[]
): string => {
  const list = (findings: CodexFinding[]): string =>
    findings.map(c => oneLine(c.path, c.line, c.body)).join("\n")
  const parts = [
    posted.length > 0 &&
      `**Inline comments (${posted.length})**\n${list(posted)}`,
    unposted.length > 0 &&
      `**Not on a changed line, so not posted inline (${unposted.length})**\n${list(unposted)}`,
  ].filter(Boolean)
  return parts.length > 0 ? `---\n\n${parts.join("\n\n")}` : ""
}

/** The table's headers name the reviewer, so each summary's own title goes. */
export const stripTitle = (summary: string): string =>
  summary.replace(/^\s*## Code(x)? Review[^\S\n]*\n/, "").trim()

const fitColumn = (text: string): string =>
  text.length > MAX_COLUMN_CHARS
    ? `${text.slice(0, MAX_COLUMN_CHARS)}\n\n…cut to fit the comment.`
    : text

export const buildSideBySide = (input: {
  claude: string | null
  claudeInline: string
  codex: string | null
  codexInline: string
  headSha: string
}): string => {
  const claude = input.claude
    ? [stripTitle(input.claude), input.claudeInline]
        .filter(Boolean)
        .join("\n\n")
    : "Claude's review didn't finish on this push."
  const codex = input.codex
    ? [stripTitle(input.codex), input.codexInline].filter(Boolean).join("\n\n")
    : "Codex didn't return a review on this push."

  // Blank lines around each cell's content let GitHub render the Markdown inside it.
  return [
    "## AI reviews: Claude | Codex",
    "",
    `Both reviewed \`${input.headSha.slice(0, 7)}\` from the same prompt. Codex didn't see Claude's review.`,
    "",
    "<table>",
    '<tr><th width="50%">Claude</th><th width="50%">Codex</th></tr>',
    "<tr>",
    '<td valign="top">',
    "",
    fitColumn(claude),
    "",
    "</td>",
    '<td valign="top">',
    "",
    fitColumn(codex),
    "",
    "</td>",
    "</tr>",
    "</table>",
    "",
    SIDE_BY_SIDE_MARKER,
  ].join("\n")
}

/** Earlier side-by-side comments, to delete once the new one posts. */
export const earlierSideBySide = (
  comments: IssueComment[],
  keepId: number
): IssueComment[] =>
  comments.filter(
    c =>
      c.id !== keepId &&
      c.user?.login === "github-actions[bot]" &&
      // At the end only, so a summary that quotes the marker is never deleted.
      (c.body ?? "")
        .trimEnd()
        .endsWith(SIDE_BY_SIDE_MARKER)
  )

const gh = (args: string[], input?: string): string =>
  execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  })

const ghList = <T>(endpoint: string): T[] =>
  gh(["api", "--paginate", endpoint, "--jq", ".[] | @json"])
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as T)

/** Posts each finding on its line. GitHub rejects lines outside the diff. */
const postCodexComments = (
  repo: string,
  prNumber: string,
  headSha: string,
  findings: CodexFinding[]
): { posted: CodexFinding[]; unposted: CodexFinding[] } => {
  const posted: CodexFinding[] = []
  const unposted: CodexFinding[] = []
  for (const finding of findings) {
    try {
      gh([
        "api",
        `repos/${repo}/pulls/${prNumber}/comments`,
        "-f",
        `body=${CODEX_COMMENT_PREFIX} ${finding.body.trim()}`,
        "-f",
        `commit_id=${headSha}`,
        "-f",
        `path=${finding.path}`,
        "-F",
        `line=${finding.line}`,
        "-f",
        "side=RIGHT",
      ])
      posted.push(finding)
    } catch {
      unposted.push(finding)
    }
  }
  console.log(
    `Codex inline comments: ${posted.length} posted, ${unposted.length} not on the diff`
  )
  return { posted, unposted }
}

const main = (): void => {
  const repo = process.env.GITHUB_REPOSITORY ?? ""
  const prNumber = process.env.PR_NUMBER ?? ""
  const headSha = process.env.HEAD_SHA ?? ""
  const reviewFile = process.env.CODEX_REVIEW_FILE ?? ""

  const issueComments = ghList<IssueComment>(
    `repos/${repo}/issues/${prNumber}/comments`
  )
  const claudeRan = process.env.CLAUDE_OUTCOME === "success"
  const claude = claudeRan ? latestClaudeSummary(issueComments, headSha) : null
  const claudeInline = claude
    ? formatInlineComments(
        ghList<ReviewComment>(`repos/${repo}/pulls/${prNumber}/comments`),
        headSha
      )
    : ""
  const codexOutput = parseCodexOutput(
    reviewFile && fs.existsSync(reviewFile)
      ? fs.readFileSync(reviewFile, "utf8")
      : ""
  )
  const codex = codexOutput?.summary.trim() || null
  let codexInline = ""
  if (codexOutput) {
    const { posted, unposted } = postCodexComments(
      repo,
      prNumber,
      headSha,
      codexOutput.comments
    )
    codexInline = formatCodexComments(posted, unposted)
  }

  if (!claude && !codex) {
    console.log("::warning::Neither review finished, so nothing was posted")
    return
  }

  const posted = JSON.parse(
    gh(
      ["api", `repos/${repo}/issues/${prNumber}/comments`, "-F", "body=@-"],
      buildSideBySide({ claude, claudeInline, codex, codexInline, headSha })
    )
  ) as IssueComment
  console.log(`Side-by-side review posted: comment ${posted.id}`)

  for (const comment of earlierSideBySide(issueComments, posted.id)) {
    try {
      gh(["api", "-X", "DELETE", `repos/${repo}/issues/comments/${comment.id}`])
    } catch {
      console.log(`::warning::Could not delete earlier comment ${comment.id}`)
    }
  }
}

if (require.main === module) {
  main()
}
