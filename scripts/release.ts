/**
 * Creates a GitHub release for every merge to main that doesn't have one yet: a
 * `vX.Y.Z` tag on the commit and notes naming the PR and the areas it touched.
 * The version comes from the PR title. See README.md, "Releases".
 *
 * Usage: npx ts-node scripts/release.ts [--apply] [--from-start | --rewrite]
 * Without --apply it prints what it would release. --from-start releases from
 * the first commit when no tag exists yet (the one-off backfill). --rewrite
 * redoes the notes of every existing release in the current format.
 */

import { execFileSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export interface Version {
  major: number
  minor: number
  patch: number
}

export type Bump = "major" | "minor" | "patch"

export interface Author {
  login: string
  name?: string
}

export interface Merge {
  sha: string
  title: string
  body: string
  date: string
  files: string[]
  author?: Author
}

export interface Release {
  tag: string
  name: string
  notes: string
  sha: string
}

export const FIRST_VERSION: Version = { major: 1, minor: 0, patch: 0 }

const CONVENTIONAL = /^([a-z]+)(\([^)]*\))?(!)?:/

const MERGE_SUBJECT = /^Merge pull request #(\d+) from \S+/

export const parseVersion = (tag: string): Version | undefined => {
  const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/)
  return match
    ? { major: +match[1], minor: +match[2], patch: +match[3] }
    : undefined
}

export const formatVersion = (version: Version): string =>
  `v${version.major}.${version.minor}.${version.patch}`

/** `!` or a BREAKING CHANGE footer is major, `feat` minor, anything else patch. */
export const bumpFor = (title: string, body = ""): Bump => {
  const match = title.match(CONVENTIONAL)
  if (match?.[3] || /^BREAKING[ -]CHANGE:/m.test(body)) {
    return "major"
  }
  return match?.[1] === "feat" ? "minor" : "patch"
}

export const nextVersion = (version: Version, bump: Bump): Version => {
  if (bump === "major") {
    return { major: version.major + 1, minor: 0, patch: 0 }
  }
  if (bump === "minor") {
    return { major: version.major, minor: version.minor + 1, patch: 0 }
  }
  return { ...version, patch: version.patch + 1 }
}

/**
 * The PR title. Squash merges use it as the subject. Older merge commits say
 * "Merge pull request #N from branch", with the title on the body's first line.
 */
export const mergeTitle = (subject: string, body: string): string => {
  const match = subject.match(MERGE_SUBJECT)
  if (!match) {
    return subject
  }
  const firstLine = body
    .split("\n")
    .map(line => line.trim())
    .find(line => line.length > 0)
  return firstLine ? `${firstLine} (#${match[1]})` : subject
}

export const prNumber = (title: string): string | undefined =>
  title.match(/\(#(\d+)\)\s*$/)?.[1]

/**
 * A caller template (templates/run-X.yml) and duchamp's own caller
 * (.github/workflows/run-X.yml) belong with the workflow they call.
 */
const workflowFor = (file: string): string =>
  file
    .replace(/^templates\/run-/, ".github/workflows/")
    .replace(/^\.github\/workflows\/run-/, ".github/workflows/")

/** Matched against workflowFor(file). First match wins, so a more specific rule goes first. */
const AREAS: [string, RegExp][] = [
  ["Releases", /^(\.github\/workflows\/release\.yml|scripts\/release\.)/],
  ["AI review experiments", /^[^/]+-experiment\//],
  [
    "AI review",
    /^(\.github\/workflows\/claude-review\.yml|review\/|review-styles\/|\.claude\/|docs\/enabling-ai-review\.md|scripts\/(build-review-prompt|review-|post-review-summary|post-side-by-side|related-repos|stack-skills|cleanup-ai-reviews|collect-|test-review))/,
  ],
  [
    "Incidents and on-call",
    /^(\.github\/workflows\/incident-|scripts\/on-call\/)/,
  ],
  ["Datadog triage", /^\.github\/workflows\/daily-datadog-triage\.yml/],
  ["Notion", /^\.github\/(workflows|actions)\/link-pr-to-notion/],
  [
    "Agent wrappers",
    /^(\.github\/workflows\/(sync-agent-wrappers|auto-sync-agent-wrappers|open-agent-wrappers-pr|lint-agents-md)\.yml|\.github\/actions\/sync-agent-wrappers\/|scripts\/sync-agent-wrappers)/,
  ],
  [
    "Danger and PR checks",
    /^(\.github\/workflows\/(danger|danger-yarn|dangerfile|add-version-label|conventional-commits-check|npm-audit|remind-to-update-docs|merge-on-green)\.yml|\.github\/actions\/setup-and-install\/|(scripts\/)?(danger-yarn|add-version-label)\.ts$|scripts\/(check-pr-exclusions|npm-audit))/,
  ],
  ["Docs", /^(docs\/|README\.md$)/],
]

/** The areas a merge touched, in AREAS order. Files no rule names count as Tooling. */
export const areasFor = (files: string[]): string[] => {
  const touched = new Set(
    files.map(
      file =>
        AREAS.find(([, pattern]) => pattern.test(workflowFor(file)))?.[0] ??
        "Tooling"
    )
  )
  return [...AREAS.map(([area]) => area), "Tooling"].filter(area =>
    touched.has(area)
  )
}

/** auto's section names, picked from the PR title instead of a label. */
export const sectionFor = (title: string, body = ""): string => {
  if (bumpFor(title, body) === "major") {
    return "💥  Breaking Change"
  }
  const type = title.match(CONVENTIONAL)?.[1]
  if (type === "feat") {
    return "🚀  Enhancement"
  }
  if (type === "fix" || type === "perf" || /^revert\b/i.test(title)) {
    return "🐛  Bug Fix"
  }
  if (type === "docs") {
    return "📝  Documentation"
  }
  return "🏠  Internal"
}

const AREA_ICONS: Record<string, string> = {
  Releases: "🏷️",
  "AI review experiments": "🧪",
  "AI review": "🤖",
  "Incidents and on-call": "🚨",
  "Datadog triage": "🐶",
  Notion: "🗒️",
  "Agent wrappers": "🧩",
  "Danger and PR checks": "✅",
  Docs: "📝",
  Tooling: "🔧",
}

const profile = (login: string): string =>
  `[@${login}](https://github.com/${login})`

/** Laid out like the release notes `auto` writes for Artsy's npm packages. */
export const formatRelease = (
  version: Version,
  merge: Merge,
  repo: string,
  previous?: Version
): Release => {
  const tag = formatVersion(version)
  const pr = prNumber(merge.title)
  const title = merge.title.replace(/\s*\(#\d+\)\s*$/, "")
  const link = pr
    ? `[#${pr}](https://github.com/${repo}/pull/${pr})`
    : `[\`${merge.sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${merge.sha})`
  const by = merge.author ? ` (${profile(merge.author.login)})` : ""
  const areas = areasFor(merge.files)
  const date = merge.date.slice(0, 10)
  const compare = previous
    ? `[${formatVersion(previous)}...${tag}](https://github.com/${repo}/compare/${formatVersion(previous)}...${tag})`
    : undefined

  const notes = [
    `#### ${sectionFor(merge.title, merge.body)}`,
    "",
    `- ${title} ${link}${by}`,
    ...(sectionFor(merge.title, merge.body).startsWith("💥")
      ? ["", "Callers on `@main` already run this. Check their workflows."]
      : []),
    ...(areas.length > 0
      ? [
          "",
          "#### 🗂️  Areas",
          "",
          ...areas.map(area => `- ${AREA_ICONS[area] ?? "•"} ${area}`),
        ]
      : []),
    ...(merge.author
      ? [
          "",
          "#### Authors: 1",
          "",
          `- ${merge.author.name ? `${merge.author.name} (${profile(merge.author.login)})` : profile(merge.author.login)}`,
        ]
      : []),
    "",
    `Merged ${date}${compare ? ` · ${compare}` : ""}`,
  ].join("\n")
  return { tag, name: tag, notes, sha: merge.sha }
}

/** Each merge gets the next version after the one before it. */
export const planReleases = (
  latest: Version | undefined,
  merges: Merge[],
  repo: string
): Release[] => {
  const releases: Release[] = []
  let version = latest
  for (const merge of merges) {
    const previous = version
    version = previous
      ? nextVersion(previous, bumpFor(merge.title, merge.body))
      : FIRST_VERSION
    releases.push(formatRelease(version, merge, repo, previous))
  }
  return releases
}

const run = (command: string, args: string[]): string =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })

/**
 * Only commits on the remote's main are released. A local branch's commits don't
 * exist on GitHub, so a release can't point at them.
 */
export const RELEASE_REF = "origin/main"

/** The newest `vX.Y.Z` tag reachable from RELEASE_REF, if any. */
export const latestTag = (): string | undefined => {
  try {
    return (
      run("git", [
        "describe",
        "--tags",
        "--abbrev=0",
        "--match",
        "v[0-9]*.[0-9]*.[0-9]*",
        RELEASE_REF,
      ]).trim() || undefined
    )
  } catch {
    return undefined
  }
}

const changedFiles = (sha: string, parents: string[]): string[] => {
  const args =
    parents.length === 0
      ? ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha]
      : ["diff", "--name-only", parents[0], sha]
  return run("git", args).split("\n").filter(Boolean)
}

/** First-parent merges on RELEASE_REF after `since` (or from the first commit), oldest first. */
export const readMerges = (since: string | undefined): Merge[] => {
  const range = since ? `${since}..${RELEASE_REF}` : RELEASE_REF
  const log = run("git", [
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H%x1f%P%x1f%cI%x1f%s%x1f%b%x1e",
    range,
  ])
  return log
    .split("\x1e")
    .map(entry => entry.replace(/^\n/, ""))
    .filter(entry => entry.trim().length > 0)
    .map(entry => {
      const [sha, parents, date, subject, body = ""] = entry.split("\x1f")
      const parentList = parents.split(" ").filter(Boolean)
      return {
        sha,
        title: mergeTitle(subject, body),
        body,
        date,
        files: changedFiles(sha, parentList),
      }
    })
}

const names = new Map<string, string | undefined>()

const nameOf = (login: string): string | undefined => {
  if (!names.has(login)) {
    try {
      names.set(
        login,
        run("gh", ["api", `users/${login}`, "--jq", ".name // empty"]).trim() ||
          undefined
      )
    } catch {
      names.set(login, undefined)
    }
  }
  return names.get(login)
}

/**
 * The PR's author, or the commit's when the title names no PR. Squash merges are
 * authored by the PR's author, but old merge commits by whoever merged. Undefined
 * when GitHub can't say.
 */
export const authorOf = (merge: Merge, repo: string): Author | undefined => {
  const pr = prNumber(merge.title)
  try {
    const login = run("gh", [
      "api",
      pr ? `repos/${repo}/pulls/${pr}` : `repos/${repo}/commits/${merge.sha}`,
      "--jq",
      pr ? ".user.login" : ".author.login // empty",
    ]).trim()
    if (!login) {
      return undefined
    }
    return login.endsWith("[bot]") ? { login } : { login, name: nameOf(login) }
  } catch {
    return undefined
  }
}

const createRelease = (
  release: Release,
  repo: string,
  rewrite = false
): void => {
  const notesPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "release-")),
    "notes.md"
  )
  fs.writeFileSync(notesPath, release.notes)
  run("gh", [
    "release",
    ...(rewrite
      ? ["edit", release.tag]
      : ["create", release.tag, "--target", release.sha]),
    "--repo",
    repo,
    "--title",
    release.name,
    "--notes-file",
    notesPath,
  ])
}

const main = (): void => {
  const apply = process.argv.includes("--apply")
  const fromStart = process.argv.includes("--from-start")
  const rewrite = process.argv.includes("--rewrite")
  const repo = process.env.GITHUB_REPOSITORY || "artsy/duchamp"

  // The latest main, and tags made by an earlier run here or in CI, so a rerun
  // picks up where it stopped.
  run("git", ["fetch", "--tags", "--quiet", "origin", "main"])
  // --rewrite redoes the notes of every release so far, with the current format.
  const tag = rewrite ? undefined : latestTag()
  const latest = tag ? parseVersion(tag) : undefined
  if (!latest && !fromStart && !rewrite) {
    console.log(
      "No vX.Y.Z tag yet. Run the backfill first: npx ts-node scripts/release.ts --from-start --apply"
    )
    return
  }

  const merges = readMerges(tag).map(merge => ({
    ...merge,
    author: authorOf(merge, repo),
  }))
  const releases = planReleases(latest, merges, repo)
  if (releases.length === 0) {
    console.log(`Nothing to release after ${tag}.`)
    return
  }

  for (const release of releases) {
    console.log(`${release.sha.slice(0, 7)} ${release.name}`)
    if (apply) {
      createRelease(release, repo, rewrite)
    }
  }
  const verb = rewrite ? "Rewrote" : "Created"
  console.log(
    apply
      ? `${verb} ${releases.length} release(s).`
      : `Dry run: ${releases.length} release(s). Pass --apply to write them.`
  )
}

if (require.main === module) {
  main()
}
