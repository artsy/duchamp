/**
 * Publish guards. They read git's own view of the applied patches (`--raw -z` for
 * modes and status, `--numstat -z` for line counts, the patch text for debug tags),
 * never the agent's description of them.
 */

export interface RawEntry {
  srcMode: string
  dstMode: string
  status: string
  path: string
}

/** `git diff --cached --raw -z --no-renames`: `:<src> <dst> <sha> <sha> <status>\0<path>\0`. */
export const parseRawZ = (output: string): RawEntry[] => {
  const tokens = output.split("\0")
  const entries: RawEntry[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const meta = tokens[i].replace(/^\n/, "")
    if (!meta.startsWith(":")) {
      throw new Error(`unexpected --raw entry: ${meta.slice(0, 80)}`)
    }
    const [srcMode, dstMode, , , status] = meta.slice(1).split(" ")
    entries.push({ srcMode, dstMode, status, path: tokens[i + 1] })
  }
  return entries
}

export interface NumstatEntry {
  path: string
  added: number
  removed: number
  binary: boolean
}

/** `git diff --cached --numstat -z --no-renames`: `<added>\t<removed>\t<path>\0`. */
export const parseNumstatZ = (output: string): NumstatEntry[] =>
  output
    .split("\0")
    .filter(token => token.trim().length > 0)
    .map(token => {
      const [added, removed, ...rest] = token.replace(/^\n/, "").split("\t")
      const binary = added === "-" || removed === "-"
      return {
        path: rest.join("\t"),
        added: binary ? 0 : Number(added),
        removed: binary ? 0 : Number(removed),
        binary,
      }
    })

const SPEC_HELPERS = new Set(["spec/spec_helper.rb", "spec/rails_helper.rb"])

/** The paths the fix agent may change. Same list as fix-guard.sh. */
export const isAllowedPath = (path: string): boolean => {
  if (!/^[\w./-]+$/.test(path)) return false
  const parts = path.split("/")
  if (
    parts.some(
      part =>
        part === "" || part === "." || part === ".." || part.startsWith(".")
    )
  ) {
    return false
  }
  if (path.startsWith("app/")) return true
  if (path.startsWith("lib/")) return !path.startsWith("lib/tasks/")
  if (path.startsWith("spec/")) {
    return !SPEC_HELPERS.has(path) && !path.startsWith("spec/support/")
  }
  return false
}

export const isSpecPath = (path: string): boolean => path.startsWith("spec/")

const REGULAR = "100644"
const ABSENT = "000000"

export const modeProblem = (entry: RawEntry): string | null => {
  const { srcMode, dstMode } = entry
  for (const mode of [srcMode, dstMode]) {
    if (mode === "120000") return "a symlink"
    if (mode === "160000") return "a submodule"
  }
  if (srcMode !== ABSENT && dstMode !== ABSENT && srcMode !== dstMode) {
    return `a mode change ${srcMode} → ${dstMode}`
  }
  const mode = dstMode === ABSENT ? srcMode : dstMode
  return mode === REGULAR ? null : `mode ${mode}`
}

/** Simple globs: `*` within a segment, `**` across segments. Separated by newlines, commas or spaces. */
const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split("**")
      .map(part =>
        part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
      )
      .join(".*")}$`
  )

export const parsePatterns = (input: string): RegExp[] =>
  input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(globToRegExp)

export interface GuardInput {
  decision: unknown
  raw: RawEntry[]
  numstat: NumstatEntry[]
  /** The text of both patches. */
  patch: string
  maxLines: number
  sensitive: RegExp[]
}

export interface GuardResult {
  ok: boolean
  reasons: string[]
  /** Changed paths that match sensitive-paths: allowed, but labelled. */
  sensitive: string[]
  /** Added + removed lines, spec lines counted at half weight. */
  weightedLines: number
  files: string[]
}

export const DEBUG_TAG = "[DEBUG-"

export const addedDebugTags = (patch: string): boolean =>
  patch
    .split("\n")
    .some(
      line =>
        line.startsWith("+") &&
        !line.startsWith("+++") &&
        line.includes(DEBUG_TAG)
    )

export const checkGuards = (input: GuardInput): GuardResult => {
  const reasons: string[] = []
  const files = input.raw.map(entry => entry.path)

  if (input.decision !== "fix") {
    reasons.push(
      `the agent's decision is ${JSON.stringify(input.decision)}, not "fix"`
    )
  }
  if (!files.some(isSpecPath) || !files.some(file => !isSpecPath(file))) {
    reasons.push("needs at least one change under spec/ and one outside it")
  }
  for (const file of files.filter(file => !isAllowedPath(file))) {
    reasons.push(`path outside the allowlist: ${file}`)
  }
  for (const entry of input.raw) {
    const problem = modeProblem(entry)
    if (problem) reasons.push(`${entry.path} is ${problem}`)
  }
  for (const entry of input.numstat.filter(entry => entry.binary)) {
    reasons.push(`${entry.path} is binary`)
  }
  const weightedLines = input.numstat.reduce(
    (sum, entry) =>
      sum + (entry.added + entry.removed) * (isSpecPath(entry.path) ? 0.5 : 1),
    0
  )
  if (weightedLines > input.maxLines) {
    reasons.push(
      `${weightedLines} changed lines (spec lines count half), over ${input.maxLines}`
    )
  }
  if (addedDebugTags(input.patch)) {
    reasons.push(`adds a ${DEBUG_TAG}…] debug tag`)
  }
  return {
    ok: reasons.length === 0,
    reasons,
    sensitive: files.filter(file =>
      input.sensitive.some(pattern => pattern.test(file))
    ),
    weightedLines,
    files,
  }
}
