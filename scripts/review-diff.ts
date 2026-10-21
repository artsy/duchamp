import { execFileSync } from "child_process"

const LOCKFILES = [
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "Gemfile.lock",
  "Podfile.lock",
]

/** The diff's cap in the prompt; see MAX_PROMPT_BYTES in build-review-prompt.ts. */
export const MAX_DIFF_BYTES = 60_000

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

/**
 * Read ignore_paths the way .gitignore does: a pattern without a slash matches at any
 * depth, and a leading slash anchors it to the root. Under git's glob magic, `*` stops
 * at `/` and a leading `/` is a fatal error.
 */
export const toGitGlobs = (pattern: string): string[] => {
  let glob = pattern.trim()
  const dirOnly = glob.endsWith("/")
  if (dirOnly) {
    glob = glob.slice(0, -1)
  }
  const anchored = glob.includes("/")
  glob = glob.replace(/^\//, "")
  if (!anchored) {
    glob = `**/${glob}`
  }
  // A glob pathspec matches the path itself, not the files under a matching directory.
  return dirOnly ? [`${glob}/**`] : [glob, `${glob}/**`]
}

const excludedGlobs = (excludePatterns: string[]): string[] => [
  ...LOCKFILES.map(file => `**/${file}`),
  ...excludePatterns.flatMap(toGitGlobs),
]

/** Everything except lockfiles and the given glob patterns. */
export const diffPathspec = (excludePatterns: string[]): string[] => [
  ".",
  ...excludedGlobs(excludePatterns).map(glob => `:(exclude,glob)${glob}`),
]

const MAX_LEFT_OUT_BYTES = 2_000

/**
 * The diff for a range as a fenced block, minus lockfiles and ignored paths, which are
 * listed by name after it. Over maxBytes, the `--numstat` file list instead.
 */
export const renderDiff = (
  range: string,
  ignorePaths: string[],
  maxBytes: number
): { inlined: boolean; block: string } => {
  const pathspec = diffPathspec(ignorePaths)
  const diff = git(["diff", range, "--", ...pathspec])
  const leftOut = git([
    "diff",
    "--name-only",
    range,
    "--",
    ...excludedGlobs(ignorePaths).map(glob => `:(glob)${glob}`),
  ]).trim()
  const leftOutNote = leftOut
    ? `\nAlso changed, but left out as lockfiles or ignored paths:\n\n${fenced(truncateLines(leftOut, MAX_LEFT_OUT_BYTES), "")}`
    : ""

  if (Buffer.byteLength(diff) <= maxBytes) {
    const block = diff.trim()
      ? fenced(diff, "diff")
      : "No changes outside lockfiles and ignored paths."
    return { inlined: true, block: block + leftOutNote }
  }

  // --stat shortens long paths to fit 80 columns, and a shortened path matches nothing.
  const numstat = git(["diff", "--numstat", range, "--", ...pathspec])
  return {
    inlined: false,
    block: fenced(truncateLines(numstat, maxBytes), "") + leftOutNote,
  }
}
