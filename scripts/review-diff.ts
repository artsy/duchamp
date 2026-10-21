import { execFileSync } from "child_process"

const LOCKFILES = [
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "Gemfile.lock",
  "Podfile.lock",
]

export const git = (args: string[]): string =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  })

/** A code fence longer than any backtick run in the content, so it can't break out. */
export const fenced = (content: string, lang: string): string => {
  const longestRun = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map(run => run.length)
  )
  const fence = "`".repeat(Math.max(3, longestRun + 1))
  return `${fence}${lang}\n${content.trimEnd()}\n${fence}`
}

/** Whole lines up to maxBytes, with a note of how many were cut. */
export const truncateLines = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text) <= maxBytes) {
    return text
  }

  const lines = text.split("\n")
  const kept: string[] = []
  let bytes = 0
  for (const line of lines) {
    bytes += Buffer.byteLength(line) + 1
    if (bytes > maxBytes) {
      break
    }
    kept.push(line)
  }
  return `${kept.join("\n")}\n... ${lines.length - kept.length} more lines`
}

/** Everything except lockfiles and the given glob patterns. */
export const diffPathspec = (excludePatterns: string[]): string[] => [
  ".",
  ...LOCKFILES.map(file => `:(exclude,glob)**/${file}`),
  ...excludePatterns.map(pattern => `:(exclude,glob)${pattern}`),
]

/**
 * The diff for a range as a fenced block, minus lockfiles and ignored paths. Over
 * maxBytes, the `--stat` file list instead, cut to maxBytes.
 */
export const renderDiff = (
  range: string,
  ignorePaths: string[],
  maxBytes: number
): { inlined: boolean; block: string } => {
  const pathspec = diffPathspec(ignorePaths)
  const diff = git(["diff", range, "--", ...pathspec])

  if (Buffer.byteLength(diff) <= maxBytes) {
    return { inlined: true, block: fenced(diff, "diff") }
  }

  const stat = git(["diff", "--stat", range, "--", ...pathspec])
  return { inlined: false, block: fenced(truncateLines(stat, maxBytes), "") }
}
