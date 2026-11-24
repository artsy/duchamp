import { execFileSync } from "child_process"
import * as fs from "fs"
import { isReviewSummary } from "./post-review-summary"
import { stripReviewFooter } from "./review-mode"

/**
 * For Codex and Gemini experiment PRs: posts each extra reviewer's inline comments, then
 * one comment with Claude's review and theirs side by side. Claude's own summary comment
 * stays, because re-reviews find the previous review through its marker.
 */

/** Marks the side-by-side comment, so the next run can replace it. */
export const SIDE_BY_SIDE_MARKER = "<!-- ai-review-side-by-side -->"

/** GitHub rejects comments over 65,536 characters; this leaves room for the table. */
export const MAX_COMMENT_CHARS = 60_000

/** One column's share when Claude and one other reviewer show. */
export const MAX_COLUMN_CHARS = MAX_COMMENT_CHARS / 2

const MAX_INLINE_LINE_CHARS = 200

/** Starts each inline comment Codex posts, so cleanup-ai-reviews.js can find them. */
export const CODEX_COMMENT_PREFIX = "**Codex:**"

/** Starts each inline comment Gemini posts, so cleanup-ai-reviews.js can find them. */
export const GEMINI_COMMENT_PREFIX = "**Gemini:**"

export interface ExtraReviewer {
  name: "Codex" | "Gemini"
  prefix: string
  /** The review JSON the reviewer's step wrote. */
  file: string
}

export interface Finding {
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
 * A reviewer's final message, in codex-experiment/output-schema.json. Antigravity wraps it
 * in an envelope whose `response` holds the message. Text that isn't that JSON is kept as
 * the summary, so a review still shows when the reviewer ignores the schema. Null when
 * there is no message.
 */
export const parseReviewOutput = (
  text: string
): { summary: string; comments: Finding[] } | null => {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1")
    .trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed?.response === "string" &&
      typeof parsed?.summary !== "string"
    ) {
      return parseReviewOutput(parsed.response)
    }
    if (typeof parsed?.summary === "string") {
      const comments = Array.isArray(parsed.comments)
        ? parsed.comments.filter(
            (c: Partial<Finding>): c is Finding =>
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

/** An extra reviewer's inline comments for its column: posted ones, then ones off the diff. */
export const formatExtraComments = (
  posted: Finding[],
  unposted: Finding[]
): string => {
  const list = (findings: Finding[]): string =>
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
  summary.replace(/^\s*## (Code|Codex|Gemini) Review[^\S\n]*\n/, "").trim()

const fitColumn = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}\n\n…cut to fit the comment.` : text

export const buildSideBySide = (input: {
  claude: string | null
  claudeInline: string
  others: { name: string; summary: string | null; inline: string }[]
  headSha: string
}): string => {
  const columns = [
    {
      name: "Claude",
      text: input.claude
        ? [stripTitle(input.claude), input.claudeInline]
            .filter(Boolean)
            .join("\n\n")
        : "Claude's review didn't finish on this push.",
    },
    ...input.others.map(other => ({
      name: other.name,
      text: other.summary
        ? [stripTitle(other.summary), other.inline].filter(Boolean).join("\n\n")
        : `${other.name} didn't return a review on this push.`,
    })),
  ]
  const width = Math.floor(100 / columns.length)
  const max = Math.floor(MAX_COMMENT_CHARS / columns.length)
  const sha = `\`${input.headSha.slice(0, 7)}\``
  const intro =
    input.others.length === 1
      ? `Both reviewed ${sha} from the same prompt. ${input.others[0].name} didn't see Claude's review.`
      : `All reviewed ${sha} from the same prompt. None saw Claude's review.`

  // Blank lines around each cell's content let GitHub render the Markdown inside it.
  return [
    `## AI reviews: ${columns.map(c => c.name).join(" | ")}`,
    "",
    intro,
    "",
    "<table>",
    `<tr>${columns.map(c => `<th width="${width}%">${c.name}</th>`).join("")}</tr>`,
    "<tr>",
    ...columns.flatMap(c => [
      '<td valign="top">',
      "",
      fitColumn(c.text, max),
      "",
      "</td>",
    ]),
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
const postComments = (
  repo: string,
  prNumber: string,
  headSha: string,
  findings: Finding[],
  reviewer: ExtraReviewer
): { posted: Finding[]; unposted: Finding[] } => {
  const posted: Finding[] = []
  const unposted: Finding[] = []
  for (const finding of findings) {
    try {
      gh([
        "api",
        `repos/${repo}/pulls/${prNumber}/comments`,
        "-f",
        `body=${reviewer.prefix} ${finding.body.trim()}`,
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
    `${reviewer.name} inline comments: ${posted.length} posted, ${unposted.length} not on the diff`
  )
  return { posted, unposted }
}

/** The extra reviewers whose job ran on this push; a missing review still gets a column. */
export const ranReviewers = (
  env: NodeJS.ProcessEnv
): ExtraReviewer[] =>
  [
    env.CODEX_RAN === "true" && {
      name: "Codex" as const,
      prefix: CODEX_COMMENT_PREFIX,
      file: env.CODEX_REVIEW_FILE ?? "",
    },
    env.GEMINI_RAN === "true" && {
      name: "Gemini" as const,
      prefix: GEMINI_COMMENT_PREFIX,
      file: env.GEMINI_REVIEW_FILE ?? "",
    },
  ].filter((r): r is ExtraReviewer => !!r)

const main = (): void => {
  const repo = process.env.GITHUB_REPOSITORY ?? ""
  const prNumber = process.env.PR_NUMBER ?? ""
  const headSha = process.env.HEAD_SHA ?? ""

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

  const others = ranReviewers(process.env).map(reviewer => {
    const output = parseReviewOutput(
      reviewer.file && fs.existsSync(reviewer.file)
        ? fs.readFileSync(reviewer.file, "utf8")
        : ""
    )
    if (!output) {
      return { name: reviewer.name, summary: null, inline: "" }
    }
    const { posted, unposted } = postComments(
      repo,
      prNumber,
      headSha,
      output.comments,
      reviewer
    )
    return {
      name: reviewer.name,
      summary: output.summary.trim() || null,
      inline: formatExtraComments(posted, unposted),
    }
  })

  if (!claude && others.every(o => !o.summary)) {
    console.log("::warning::No review finished, so nothing was posted")
    return
  }

  const posted = JSON.parse(
    gh(
      ["api", `repos/${repo}/issues/${prNumber}/comments`, "-F", "body=@-"],
      buildSideBySide({ claude, claudeInline, others, headSha })
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
