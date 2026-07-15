export type DeployCategory =
  | "features"
  | "fixes"
  | "improvements-and-maintenance"

export interface DeployChange {
  type: string
  scope?: string
  description: string
  prNumber?: number
}

const MERGE_COMMIT_PATTERN =
  /^Merge pull request #(?<pr>\d+) from [\w-]+\/(?<branch>.+)$/i

const CONVENTIONAL_COMMIT_PATTERN =
  /^(?<type>[a-z]+)(?:\([^)]+\))?!?:\s*(?<description>.+?)(?:\s*\(#(?<pr>\d+)\))?$/i

const TYPE_ORDER = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "chore",
  "style",
  "test",
  "build",
  "ci",
  "revert",
]

const TYPE_LABELS: Record<string, string> = {
  feat: "Features",
  fix: "Bug fixes",
  perf: "Performance",
  refactor: "Refactoring",
  docs: "Documentation",
  chore: "Chores",
  style: "Style",
  test: "Tests",
  build: "Build",
  ci: "CI",
  revert: "Reverts",
}

function parseCommitHeadline(headline: string): DeployChange | null {
  const trimmed = headline.trim()

  const mergeMatch = trimmed.match(MERGE_COMMIT_PATTERN)
  if (mergeMatch?.groups) {
    const branch = mergeMatch.groups.branch
    const description = branch.includes("/")
      ? branch.split("/").slice(1).join("/").replace(/-/g, " ")
      : branch.replace(/-/g, " ")
    return {
      type: inferTypeFromBranch(branch),
      description,
      prNumber: Number.parseInt(mergeMatch.groups.pr, 10),
    }
  }

  const conventionalMatch = trimmed.match(CONVENTIONAL_COMMIT_PATTERN)
  if (conventionalMatch?.groups) {
    const scopeMatch = trimmed.match(/^[a-z]+\(([^)]+)\)/i)
    const change: DeployChange = {
      type: conventionalMatch.groups.type.toLowerCase(),
      scope: scopeMatch?.[1],
      description: conventionalMatch.groups.description.trim(),
    }

    if (conventionalMatch.groups.pr) {
      change.prNumber = Number.parseInt(conventionalMatch.groups.pr, 10)
    }

    return change
  }

  return {
    type: "other",
    description: trimmed,
  }
}

function inferTypeFromBranch(branch: string): string {
  const prefix = branch.split("/")[0]?.toLowerCase()
  if (prefix && TYPE_ORDER.includes(prefix)) {
    return prefix
  }
  return "other"
}

function dedupeKey(change: DeployChange): string {
  if (change.prNumber !== undefined) {
    return `pr:${change.prNumber}`
  }
  return `msg:${change.type}:${change.description}`
}

export function parseDeployChanges(commitHeadlines: string[]): DeployChange[] {
  const seen = new Set<string>()
  const changes: DeployChange[] = []

  for (const headline of commitHeadlines) {
    const change = parseCommitHeadline(headline)
    if (!change) continue

    const key = dedupeKey(change)
    if (seen.has(key)) continue

    seen.add(key)
    changes.push(change)
  }

  return changes
}

export function groupChangesByType(
  changes: DeployChange[]
): Map<string, DeployChange[]> {
  const groups = new Map<string, DeployChange[]>()

  for (const change of changes) {
    const existing = groups.get(change.type) ?? []
    existing.push(change)
    groups.set(change.type, existing)
  }

  return groups
}

export function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? "Other changes"
}

const FEATURE_TYPES = new Set(["feat"])
const FIX_TYPES = new Set(["fix"])

export function parseConventionalType(text: string): string | undefined {
  const match = text.trim().match(/^([a-z]+)(?:\([^)]+\))?!?:\s/i)
  return match?.[1]?.toLowerCase()
}

export function resolveChangeCategory(
  prTitle: string | undefined,
  commitType: string
): DeployCategory {
  const prType = prTitle ? parseConventionalType(prTitle) : undefined
  return categorizeChangeType(prType ?? commitType)
}

export function categorizeChangeType(type: string): DeployCategory {
  if (FEATURE_TYPES.has(type)) return "features"
  if (FIX_TYPES.has(type)) return "fixes"
  return "improvements-and-maintenance"
}

export function sortTypeKeys(types: string[]): string[] {
  return [...types].sort((a, b) => {
    const aIndex = TYPE_ORDER.indexOf(a)
    const bIndex = TYPE_ORDER.indexOf(b)
    const aRank = aIndex === -1 ? TYPE_ORDER.length + 1 : aIndex
    const bRank = bIndex === -1 ? TYPE_ORDER.length + 1 : bIndex

    if (aRank !== bRank) return aRank - bRank
    return a.localeCompare(b)
  })
}
