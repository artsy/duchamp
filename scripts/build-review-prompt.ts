import { execFileSync } from "child_process"
import { randomUUID } from "crypto"
import * as fs from "fs"
import * as yaml from "js-yaml"
import * as os from "os"
import * as path from "path"
import {
  addDirArgs,
  cloneRelatedRepos,
  formatRelatedReposSection,
  parseRelatedRepos,
  type RelatedRepo,
} from "./related-repos"
import { fenced, MAX_DIFF_BYTES, renderDiff } from "./review-diff"

/**
 * Build the review prompt from review/prompt.md plus repo-specific configuration.
 *
 * Repos can create a .claude-review.yml file with:
 * - prompt: Complete custom prompt (replaces review/prompt.md)
 * - focus_areas: Array of specific things to watch for (added to the prompt)
 * - ignore_paths: Glob patterns for files to skip
 * - context: Additional context about the codebase
 * - related_repos: Other artsy/<name> repos that experiment reviews can read. Read
 *   from the default branch, so a PR cannot grant its own review access to a repo
 *
 * The review experiment adds related repos, and AGENTS.md and the diff in the prompt.
 * A PR is in it when its author is listed
 * in review-experiment/participants.yml, or when it carries the EXPERIMENT_LABEL.
 * See review-experiment/README.md.
 */

interface ExcludeConfig {
  title_patterns?: string[]
  disable_defaults?: boolean
}

interface RepoConfig {
  prompt?: string
  focus_areas?: string[]
  ignore_paths?: string[]
  context?: string
  exclude?: ExcludeConfig
  related_repos?: string[]
}

/** Label that opts a single PR into the experiment without enrolling its author. */
export const EXPERIMENT_LABEL = "ai-review-experiment"

export const DEFAULT_MODEL = "claude-opus-5-5"

export const REVIEW_EFFORT = "high"

/**
 * Prompt and experiment files live in this repo's checkout, never in the PR under
 * review, so a PR author cannot swap in their own review prompt through their changes.
 */
const toolingPath = (...parts: string[]): string =>
  path.join(__dirname, "..", ...parts)

export const loadReviewPrompt = (): string =>
  fs.readFileSync(toolingPath("review", "prompt.md"), "utf8")

export const loadParticipants = (): string[] => {
  const participantsPath = toolingPath("review-experiment", "participants.yml")

  if (!fs.existsSync(participantsPath)) {
    return []
  }

  try {
    const parsed = yaml.load(fs.readFileSync(participantsPath, "utf8")) as {
      participants?: unknown
    } | null
    const participants = parsed?.participants

    if (!Array.isArray(participants)) {
      return []
    }

    return participants
      .filter((login): login is string => typeof login === "string")
      .map(login => login.toLowerCase())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: Failed to parse participants.yml: ${message}`)
    return []
  }
}

/**
 * Labels arrive from the workflow as a JSON array. Fall back to a comma-separated
 * list so a hand-set PR_LABELS still works when testing locally.
 */
export const parseLabels = (raw: string | undefined): string[] => {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .map(label => (typeof label === "string" ? label : (label?.name ?? "")))
        .filter((label: string) => label.length > 0)
    }
  } catch {
    // Not JSON, treat it as a comma-separated list
  }

  return raw
    .split(",")
    .map(label => label.trim())
    .filter(label => label.length > 0)
}

/** Whether this review is in the experiment: on for listed authors and labelled PRs. */
export const usesRelatedRepos = (
  author: string | undefined,
  labels: string[]
): boolean => {
  if (labels.some(label => label.toLowerCase() === EXPERIMENT_LABEL)) {
    return true
  }

  if (!author) {
    return false
  }

  return loadParticipants().includes(author.toLowerCase())
}

/** Claude Code CLI flags that select the model for this review. */
export const resolveModelArgs = (model: string): string =>
  `--model ${model} --effort ${REVIEW_EFFORT}`

export const loadRepoConfig = (): RepoConfig | null => {
  const configPath = path.join(process.cwd(), ".claude-review.yml")

  if (!fs.existsSync(configPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(configPath, "utf8")
    return yaml.load(content) as RepoConfig
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: Failed to parse .claude-review.yml: ${message}`)
    return null
  }
}

export const buildPrompt = (): string => {
  const repoConfig = loadRepoConfig()

  // If repo provides a complete custom prompt, use it directly
  if (repoConfig?.prompt) {
    return repoConfig.prompt
  }

  // Otherwise, build from the review prompt + customizations
  const sections = [loadReviewPrompt()]

  if (repoConfig) {
    // Add repo-specific context
    if (repoConfig.context) {
      sections.push(`\n## Repository Context\n\n${repoConfig.context}\n`)
    }

    // Add focus areas
    if (repoConfig.focus_areas && repoConfig.focus_areas.length > 0) {
      const focusItems = repoConfig.focus_areas
        .map(area => `- ${area}`)
        .join("\n")
      sections.push(
        `\n## Additional Focus Areas\n\nPay special attention to:\n${focusItems}\n`
      )
    }

    // Add ignore paths
    if (repoConfig.ignore_paths && repoConfig.ignore_paths.length > 0) {
      const ignoreItems = repoConfig.ignore_paths
        .map(pattern => `- ${pattern}`)
        .join("\n")
      sections.push(
        `\n## Files to Skip\n\nDo not review changes in:\n${ignoreItems}\n`
      )
    }
  }

  return sections.join("")
}

/**
 * Read the repo config from the default branch, so adding a related repo takes a
 * merged, reviewed change. Not the PR's base branch: the author picks that, and can
 * point the PR at a branch they pushed themselves. The review job checks out with
 * fetch-depth: 0, so origin/<default> is available.
 */
export const loadDefaultBranchRepoConfig = (
  defaultBranch: string | undefined
): RepoConfig | null => {
  if (!defaultBranch) {
    return null
  }

  try {
    const content = execFileSync(
      "git",
      ["show", `origin/${defaultBranch}:.claude-review.yml`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
    return yaml.load(content) as RepoConfig
  } catch {
    return null
  }
}

/** Clone the repo's related repos when this review uses them (see usesRelatedRepos). */
export const resolveRelatedRepos = (enabled: boolean): RelatedRepo[] => {
  const repos = parseRelatedRepos(
    loadDefaultBranchRepoConfig(process.env.DEFAULT_BRANCH)?.related_repos,
    process.env.GITHUB_REPOSITORY
  )

  if (repos.length === 0) {
    return []
  }

  if (!enabled) {
    console.log(
      "Ignoring related_repos: only PRs in the review experiment read them"
    )
    return []
  }

  const destRoot = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "related")
  return cloneRelatedRepos(
    repos,
    destRoot,
    process.env.RELATED_REPOS_TOKEN || undefined
  )
}

/**
 * The prompt reaches claude-code-action as an input, which the runner passes as one
 * environment variable. Linux caps a single one at 128 KB; MAX_PROMPT_BYTES leaves
 * room for the workflow's own text around the prompt.
 */
export const MAX_PROMPT_BYTES = 120_000
export const MAX_INSTRUCTIONS_BYTES = 20_000

/** A PR controls these files, so a symlink could point at the runner's secrets. */
const readRegularFile = (file: string): string | undefined => {
  const filePath = path.join(process.cwd(), file)
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false })
  if (!stat?.isFile()) {
    return undefined
  }
  return fs.readFileSync(filePath, "utf8")
}

/**
 * Inline the repo's root AGENTS.md, which the reviewer would otherwise spend a turn
 * reading. The action already loads CLAUDE.md, and AGENTS.md with it when CLAUDE.md
 * imports it, so those stay out.
 */
export const formatInstructionsSection = (): string => {
  if (readRegularFile("CLAUDE.md")?.includes("@AGENTS.md")) {
    return ""
  }

  const content = readRegularFile("AGENTS.md")
  if (content === undefined) {
    return ""
  }

  if (Buffer.byteLength(content) > MAX_INSTRUCTIONS_BYTES) {
    return "\n## Repository Instructions\n\nRead `AGENTS.md` in the repo root first; it is too large to include here.\n"
  }

  return [
    "\n## Repository Instructions\n",
    "The repo's root AGENTS.md, already read for you. Do not read it again.\n",
    fenced(content, "markdown"),
    "",
  ].join("\n")
}

/**
 * Inline the PR diff, minus lockfiles and the repo's ignore_paths. Over maxBytes, give
 * the file list instead and leave the reviewer to read the diff per file.
 */
export const formatDiffSection = (
  baseRef: string | undefined,
  ignorePaths: string[],
  maxBytes: number = MAX_DIFF_BYTES
): string => {
  if (!baseRef) {
    return ""
  }

  const range = `origin/${baseRef}...HEAD`
  try {
    const { inlined, block } = renderDiff(range, ignorePaths, maxBytes)
    const intro = inlined
      ? `The full output of \`git diff ${range}\`, leaving out lockfiles and ignored paths. Do not run git diff for it again; read files for the code around it.`
      : `The diff is too large to include. These files changed (lines added, lines removed, path); run \`git diff ${range} -- <path>\` for the ones you need.`
    return ["\n## The Diff\n", `${intro}\n`, block, ""].join("\n")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: Failed to read the PR diff: ${message}`)
    return `\n## The Diff\n\nRun \`git diff ${range}\` to see the changes.\n`
  }
}

/**
 * How the reviewer gets the repo instructions and the diff. Experiment reviews get
 * them in the prompt, sized to what promptBytes leaves under MAX_PROMPT_BYTES. The
 * rest are told where to find them, as before.
 */
export const formatContextSection = (
  inExperiment: boolean,
  baseRef: string | undefined,
  ignorePaths: string[],
  promptBytes = 0
): string => {
  if (!inExperiment) {
    const diffHint = baseRef
      ? ` Use \`git diff origin/${baseRef}...HEAD\` to see changes.`
      : ""
    return `\nIf an AGENTS.md or CLAUDE.md file exists in the repo root, read it first for project-specific guidelines.${diffHint}\n`
  }

  const instructions = formatInstructionsSection()
  const readHint =
    "\nWhen you know several files you need, read them all in one turn rather than one per turn.\n"
  const diffBytes = Math.min(
    MAX_DIFF_BYTES,
    MAX_PROMPT_BYTES - promptBytes - Buffer.byteLength(instructions + readHint)
  )
  return (
    instructions + formatDiffSection(baseRef, ignorePaths, diffBytes) + readHint
  )
}

const main = (): void => {
  const inExperiment = usesRelatedRepos(
    process.env.PR_AUTHOR,
    parseLabels(process.env.PR_LABELS)
  )

  // Lets the workflow skip minting the related repos token for reviews that don't use it.
  if (process.argv.includes("--check-experiment")) {
    const outputPath = process.env.GITHUB_OUTPUT
    if (outputPath) {
      fs.appendFileSync(outputPath, `related_repos=${inExperiment}\n`)
    }
    console.log(`Related repos: ${inExperiment}`)
    return
  }

  const related = resolveRelatedRepos(inExperiment)
  const promptHead =
    buildPrompt() +
    formatRelatedReposSection(related, process.env.REPO_PRIVATE === "true")
  const prompt =
    promptHead +
    formatContextSection(
      inExperiment,
      process.env.BASE_REF,
      loadRepoConfig()?.ignore_paths ?? [],
      Buffer.byteLength(promptHead)
    )
  const modelArgs = [
    resolveModelArgs(process.env.DEFAULT_MODEL || DEFAULT_MODEL),
    addDirArgs(related),
  ]
    .filter(Boolean)
    .join(" ")

  // Set the output for GitHub Actions
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath) {
    // Repo files reach the prompt verbatim, so a guessable delimiter could end it early
    const delimiter = `EOF_${randomUUID()}`
    fs.appendFileSync(
      outputPath,
      `review_prompt<<${delimiter}\n${prompt}\n${delimiter}\nmodel_args=${modelArgs}\n`
    )
    console.log("Review prompt written to GITHUB_OUTPUT")
  } else {
    // For local testing, just print the prompt
    console.log(`Model args: ${modelArgs}`)
    console.log("Generated review prompt:")
    console.log("---")
    console.log(prompt)
    console.log("---")
  }
}

// Run main if this is the entry point
if (require.main === module) {
  main()
}
