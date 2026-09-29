import { execFileSync } from "child_process"
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
 * The review experiment adds related repos. A PR is in it when its author is listed
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

/** The experiment is related repos: on for listed authors and for labelled PRs. */
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

const main = (): void => {
  const relatedEnabled = usesRelatedRepos(
    process.env.PR_AUTHOR,
    parseLabels(process.env.PR_LABELS)
  )

  // Lets the workflow skip minting the related repos token for reviews that don't use it.
  if (process.argv.includes("--check-experiment")) {
    const outputPath = process.env.GITHUB_OUTPUT
    if (outputPath) {
      fs.appendFileSync(outputPath, `related_repos=${relatedEnabled}\n`)
    }
    console.log(`Related repos: ${relatedEnabled}`)
    return
  }

  const related = resolveRelatedRepos(relatedEnabled)
  const prompt =
    buildPrompt() +
    formatRelatedReposSection(related, process.env.REPO_PRIVATE === "true")
  const modelArgs = [
    resolveModelArgs(process.env.DEFAULT_MODEL || DEFAULT_MODEL),
    addDirArgs(related),
  ]
    .filter(Boolean)
    .join(" ")

  // Set the output for GitHub Actions
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath) {
    // Use heredoc-style delimiter for multiline output (modern GitHub Actions approach)
    const delimiter = `EOF_${Date.now()}`
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
