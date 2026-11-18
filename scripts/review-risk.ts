import { diffPathspec, git } from "./review-diff"

/**
 * How much review a diff needs. Light diffs (docs only, or small and away from
 * sensitive code) get a cheaper model; see review/README.md, "Model routing".
 */

export type ReviewTier = "light" | "standard"

/** At or under this many changed lines, a diff with no sensitive file is light. */
export const MAX_LIGHT_LINES = 40

/**
 * Paths where a small change can still do real damage. Matched against the lowercased
 * path. A false match only keeps a PR on the standard model, so these lean broad.
 */
export const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.github\/(workflows|actions)\//,
  /auth|password|secret|credential|token|session|permission|polic(y|ies)/,
  /payment|checkout|billing|(^|[/_.-])orders?([/_.-]|$)/,
  /migrat/,
  /(^|\/)dockerfile/,
  /\.(tf|sql)$/,
]

const DOCS_PATTERN =
  /(^|\/)docs\/|\.(md|mdx|txt|png|jpe?g|gif|svg|webp)$|(^|\/)license$/

export const isSensitivePath = (file: string): boolean =>
  SENSITIVE_PATTERNS.some(pattern => pattern.test(file.toLowerCase()))

export const isDocsPath = (file: string): boolean =>
  DOCS_PATTERN.test(file.toLowerCase())

export interface ChangedFile {
  path: string
  lines: number
}

/** `git diff --numstat --no-renames` output. Binary files show `-` and count as 0. */
export const parseNumstat = (output: string): ChangedFile[] =>
  output
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => {
      const [added, removed, ...rest] = line.split("\t")
      return {
        path: rest.join("\t"),
        lines: (Number(added) || 0) + (Number(removed) || 0),
      }
    })

export interface DiffRisk {
  tier: ReviewTier
  reason: string
  sensitive: string[]
}

export const classifyFiles = (files: ChangedFile[]): DiffRisk => {
  const sensitive = files.map(f => f.path).filter(isSensitivePath)
  const lines = files.reduce((sum, f) => sum + f.lines, 0)

  if (sensitive.length > 0) {
    return {
      tier: "standard",
      reason: `${sensitive.length} sensitive file(s), such as ${sensitive[0]}`,
      sensitive,
    }
  }
  if (files.every(f => isDocsPath(f.path))) {
    return { tier: "light", reason: "docs only", sensitive }
  }
  if (lines <= MAX_LIGHT_LINES) {
    return {
      tier: "light",
      reason: `${lines} changed lines, at most ${MAX_LIGHT_LINES}`,
      sensitive,
    }
  }
  return {
    tier: "standard",
    reason: `${lines} changed lines, over ${MAX_LIGHT_LINES}`,
    sensitive,
  }
}

/** Classify a range's changes, leaving out lockfiles and ignore_paths. */
export const classifyDiff = (range: string, ignorePaths: string[]): DiffRisk =>
  classifyFiles(
    parseNumstat(
      git([
        "diff",
        "--numstat",
        "--no-renames",
        range,
        "--",
        ...diffPathspec(ignorePaths),
      ])
    )
  )
