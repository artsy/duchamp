import type { Meta } from "./select"
import { clip, oneLine, stripHidden } from "./text"

/**
 * The draft PR's title, body and the triage issue comment. Everything the fix agent
 * wrote is cut to length and made inert: no mentions, no closing keywords, no issue
 * refs, and no links or images outside the allowlist.
 */

export const BODY_MAX = 12000
export const SUMMARY_MAX = 1000
export const HYPOTHESIS_MAX = 300
export const MAX_HYPOTHESES = 5

export interface FixResult {
  decision: "fix" | "skip"
  confidence: string
  root_cause: string
  hypotheses: string[]
  summary: string
}

/** result.json as the agent wrote it, or null if it isn't the agreed shape. */
export const parseResult = (raw: string): FixResult | null => {
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || (parsed.decision !== "fix" && parsed.decision !== "skip")) {
    return null
  }
  const text = (value: unknown): string =>
    typeof value === "string" ? value : ""
  const hypotheses = Array.isArray(parsed.hypotheses)
    ? parsed.hypotheses
        .map((h: unknown) =>
          typeof h === "string"
            ? h
            : h && typeof h === "object"
              ? Object.values(h)
                  .filter(v => typeof v === "string")
                  .join(": ")
              : ""
        )
        .filter((h: string) => h.trim())
    : []
  return {
    decision: parsed.decision,
    confidence: text(parsed.confidence),
    root_cause: text(parsed.root_cause),
    hypotheses,
    summary: text(parsed.summary),
  }
}

const ALLOWED_HOSTS: ((url: URL) => boolean)[] = [
  url => url.hostname === "app.datadoghq.com",
  url => url.hostname === "github.com" && url.pathname.startsWith("/artsy/"),
]

export const isAllowedUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && ALLOWED_HOSTS.some(allow => allow(url))
  } catch {
    return false
  }
}

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>()"'`\]]+/gi

/** Links and images: allowed URLs stay, others go. Applies inside code too. */
const sanitizeUrls = (text: string): string =>
  text
    // Images: kept only from an allowed URL.
    .replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (match, _alt, url) =>
      isAllowedUrl(url) ? match : ""
    )
    // Inline links: the text stays, the link goes unless allowed.
    .replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (match, label, url) =>
      isAllowedUrl(url) ? match : label
    )
    // Reference definitions.
    .replace(/^ {0,3}\[[^\]]+\]:\s*\S+.*$/gm, line => {
      const url = /\]:\s*<?([^\s>]+)/.exec(line)?.[1] ?? ""
      return isAllowedUrl(url) ? line : ""
    })
    .replace(/<((?:https?|mailto):[^>\s]*)>/gi, (match, url) =>
      isAllowedUrl(url) ? match : "[link removed]"
    )
    .replace(URL_IN_TEXT, match => {
      const url = match.replace(/[.,;:!?]+$/, "")
      return isAllowedUrl(url)
        ? match
        : `[link removed]${match.slice(url.length)}`
    })

// GitHub also closes an issue named by its URL, and github.com/artsy URLs are kept.
const CLOSING_KEYWORD =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b(?=\s*:?\s*(?:(?:[\w.-]+\/[\w.-]+)?#\d|https?:\/\/github\.com\/))/gi

/** Mentions, closing keywords, issue refs and raw HTML, outside code. */
const sanitizeProse = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>/g, "")
    .replace(CLOSING_KEYWORD, "see")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1")
    .replace(/(?:\b[\w.-]+\/[\w.-]+)?#(\d+)\b/g, "$1")
    .replace(/\bGH-(\d+)\b/gi, "$1")

/**
 * Split into code (fenced blocks and inline spans) and prose. An unclosed fence runs
 * to the end, as GitHub renders it.
 */
export const splitCode = (text: string): { code: boolean; text: string }[] => {
  const parts: { code: boolean; text: string }[] = []
  const pattern =
    /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[`~]*[ \t]*(?=\n|$)|$(?![\s\S]))|(`+)(?!`)[\s\S]*?[^`]\3(?!`)/gm
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) {
      parts.push({ code: false, text: text.slice(last, match.index) })
    }
    parts.push({ code: true, text: match[0] })
    last = match.index! + match[0].length
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) })
  return parts
}

export const sanitizeMarkdown = (text: string, max: number): string =>
  clip(
    splitCode(stripHidden(text))
      .map(part =>
        sanitizeUrls(part.code ? part.text : sanitizeProse(part.text))
      )
      .join("")
      .trim(),
    max
  )

// Commit messages don't render code, so code spans get no pass, and no URL is kept:
// "fix: <issue URL>" in a commit closes that issue on merge.
export const sanitizeLine = (text: string, max: number): string =>
  oneLine(
    sanitizeProse(stripHidden(text).replace(/\s+/g, " "))
      .replace(/(^|\W)@(?=[A-Za-z0-9])/g, "$1")
      .replace(URL_IN_TEXT, "[link removed]"),
    max
  )

const shortSha = (sha: string | null | undefined): string =>
  sha ? sha.slice(0, 12) : "?"

const subject = (meta: Meta): string => {
  const errorType = sanitizeLine(meta.error_type, 60) || "production error"
  const frame = meta.top_frame ? sanitizeLine(meta.top_frame.path, 80) : ""
  return frame ? `${errorType} in ${frame}` : errorType
}

export const prTitle = (meta: Meta): string => `fix: ${subject(meta)}`

/** [skip ci]: the repo's CI runs this code only after a human adds autofix/run-ci. */
export const commitMessages = (meta: Meta): { test: string; fix: string } => ({
  test: `test: reproduce ${subject(meta)} [skip ci]`,
  fix: `${prTitle(meta)} [skip ci]`,
})

export interface BodyInput {
  meta: Meta
  result: FixResult
  agentBody: string
  triageIssue: number | null
  sensitive: string[]
  weightedLines: number
}

export const prBody = ({
  meta,
  result,
  agentBody,
  triageIssue,
  sensitive,
  weightedLines,
}: BodyInput): string => {
  const range = meta.suspect_range
    ? `\`${shortSha(meta.suspect_range.from)}..${shortSha(meta.suspect_range.to)}\``
    : "not found"
  const hypotheses = result.hypotheses
    .slice(0, MAX_HYPOTHESES)
    .map(
      (h, i) =>
        `${i + 1}. ${oneLine(sanitizeMarkdown(h, HYPOTHESIS_MAX), HYPOTHESIS_MAX)}`
    )
  const lines = [
    "> [!IMPORTANT]",
    "> Opened by autofix from a production error. **CI has not run.** Read the diff, then add the `autofix/run-ci` label to run CI on it.",
    "> Check for symptom suppression: a `rescue`, `&.` or nil guard that hides the error instead of fixing its cause.",
    "> **Update branch**, or any push without `[skip ci]`, also runs CI on this code: read the diff first.",
    "",
    `- Datadog: [${sanitizeLine(meta.error_type, 80).replace(/[[\]]/g, "")}](${meta.permalink}), ${meta.total_count} events, ${meta.impacted_users} users, first seen ${meta.first_seen || "unknown"} in \`${shortSha(meta.first_seen_version) || "?"}\``,
    `- Suspect range: ${range}`,
    `- Agent confidence: ${oneLine(result.confidence, 20) || "not given"}; ${weightedLines} changed lines (spec lines count half)`,
  ]
  if (sensitive.length > 0) {
    lines.push(
      `- Sensitive paths: ${sensitive.map(file => `\`${file}\``).join(", ")}`
    )
  }
  if (hypotheses.length > 0) {
    lines.push(
      "",
      "<details><summary>Hypotheses the agent ranked</summary>",
      "",
      ...hypotheses,
      "",
      "</details>"
    )
  }
  lines.push(
    "",
    triageIssue
      ? `This PR resolves #${triageIssue}`
      : "No triage issue for this error.",
    "",
    "### Description",
    "",
    sanitizeMarkdown(agentBody, BODY_MAX) || "_The agent wrote no description._"
  )
  if (sensitive.length > 0) {
    lines.push(
      "",
      "#### Merge Danger (autofix)",
      "",
      `Touches paths this repo lists as sensitive: ${sensitive.map(file => `\`${file}\``).join(", ")}.`
    )
  }
  return `${lines.join("\n")}\n`
}

export type Outcome =
  | { kind: "rejected"; reasons: string[] }
  | { kind: "skipped"; summary: string }

/** The comment on the triage issue. Agent text only in the skip case, sanitised. */
export const issueComment = (outcome: Outcome, runUrl: string): string => {
  switch (outcome.kind) {
    case "rejected":
      return `Autofix did not open a PR (${runUrl}). The patch failed the publish checks:\n\n${outcome.reasons.map(reason => `- ${oneLine(sanitizeMarkdown(reason, 300), 300)}`).join("\n")}\n`
    case "skipped":
      return `Autofix skipped this error (${runUrl}). The agent's reason:\n\n> ${oneLine(sanitizeMarkdown(outcome.summary, SUMMARY_MAX), SUMMARY_MAX) || "none given"}\n`
  }
}
