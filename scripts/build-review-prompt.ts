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
import {
  diffPathspec,
  fenced,
  git,
  MAX_DIFF_BYTES,
  renderDiff,
} from "./review-diff"
import {
  formatRereviewSection,
  type ReviewMode,
  resolveReviewMode,
} from "./review-mode"
import { classifyDiff, type DiffRisk, type ReviewTier } from "./review-risk"
import { formatStackSkillsSection, resolveStackSkills } from "./stack-skills"

/**
 * Build the review prompt from review/prompt.md plus repo-specific configuration.
 *
 * Repos can create a .claude-review.yml file with:
 * - prompt: Complete custom prompt (replaces review/prompt.md)
 * - focus_areas: Array of specific things to watch for (added to the prompt)
 * - ignore_paths: Glob patterns for files to skip
 * - context: Additional context about the codebase
 * - related_repos: Other artsy/<name> repos that related-repos experiment reviews can
 *   read. Read from the default branch, so a PR cannot grant its own review access to a
 *   repo
 *
 * The lean reviews experiment adds AGENTS.md and the diff in the prompt, and re-reviews of
 * only what changed since the last review. A PR is in it when its author is listed in
 * lean-reviews-experiment/participants.yml, or when it carries the LEAN_LABEL. See
 * lean-reviews-experiment/README.md. Related repos are their own experiment; see
 * related-repos-experiment/README.md.
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

/** Label that opts a single PR into lean reviews without enrolling its author. */
export const LEAN_LABEL = "ai-review-lean"

/** The label from before the rename to lean reviews, still accepted on open PRs. */
export const LEAN_LEGACY_LABEL = "ai-review-experiment"

/** Label that opts a single PR into the related-repos experiment. */
export const RELATED_REPOS_LABEL = "ai-review-related-repos"

/** Label that opts a single PR into the best-practices experiment. */
export const BEST_PRACTICES_LABEL = "ai-review-best-practices"

/** Label that opts a single PR into the security experiment. */
export const SECURITY_LABEL = "security-review"

export const DEFAULT_MODEL = "claude-opus-5-5"

export const REVIEW_EFFORT = "high"

/** Light experiment reviews: docs-only or small diffs away from sensitive code. */
export const LIGHT_MODEL = "claude-sonnet-5-5"

export const LIGHT_EFFORT = "medium"

/**
 * Prompt and experiment files live in this repo's checkout, never in the PR under
 * review, so a PR author cannot swap in their own review prompt through their changes.
 */
const toolingPath = (...parts: string[]): string =>
  path.join(__dirname, "..", ...parts)

export const loadReviewPrompt = (): string =>
  fs.readFileSync(toolingPath("review", "prompt.md"), "utf8")

/** Logins in an experiment's participants.yml, lowercased. */
export const loadParticipants = (
  experiment = "lean-reviews-experiment"
): string[] => {
  const participantsPath = toolingPath(experiment, "participants.yml")

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

/** Whether this review is in the lean reviews experiment: listed authors and labelled PRs. */
export const inLeanReviews = (
  author: string | undefined,
  labels: string[]
): boolean => {
  if (
    labels.some(label =>
      [LEAN_LABEL, LEAN_LEGACY_LABEL].includes(label.toLowerCase())
    )
  ) {
    return true
  }

  if (!author) {
    return false
  }

  return loadParticipants().includes(author.toLowerCase())
}

/** Whether this review reads related repos: listed authors and labelled PRs. */
export const inRelatedReposExperiment = (
  author: string | undefined,
  labels: string[]
): boolean =>
  labels.some(label => label.toLowerCase() === RELATED_REPOS_LABEL) ||
  (!!author &&
    loadParticipants("related-repos-experiment").includes(author.toLowerCase()))

export const hasSecurityLabel = (labels: string[]): boolean =>
  labels.some(label => label.toLowerCase() === SECURITY_LABEL)

/**
 * Adding the label asks for a security read now. The PR has usually been reviewed at
 * its current commit already, so a re-review would skip and the pass would never run.
 */
export const securityLabelJustAdded = (
  triggerLabel: string | undefined
): boolean => triggerLabel?.toLowerCase() === SECURITY_LABEL

/** A full review when the security label was just added, else the usual choice. */
export const pickReviewMode = (
  triggerLabel: string | undefined,
  repo: string | undefined,
  prNumber: string | undefined,
  ignorePaths: string[],
  inLean: boolean
): ReviewMode =>
  securityLabelJustAdded(triggerLabel)
    ? { mode: "full", reason: `${SECURITY_LABEL} label just added` }
    : resolveReviewMode(repo, prNumber, ignorePaths, inLean)

/** Whether this review is in the security experiment: listed authors and labelled PRs. */
export const inSecurityExperiment = (
  author: string | undefined,
  labels: string[]
): boolean =>
  hasSecurityLabel(labels) ||
  (!!author &&
    loadParticipants("security-experiment").includes(author.toLowerCase()))

/** Whether this review is in the best-practices experiment: listed authors and labelled PRs. */
export const inBestPractices = (
  author: string | undefined,
  labels: string[]
): boolean =>
  labels.some(label => label.toLowerCase() === BEST_PRACTICES_LABEL) ||
  (!!author &&
    loadParticipants("best-practices-experiment").includes(
      author.toLowerCase()
    ))

/** Claude Code CLI flags that select the model for this review. */
export const resolveModelArgs = (
  model: string,
  tier: ReviewTier = "standard"
): string =>
  tier === "light"
    ? `--model ${LIGHT_MODEL} --effort ${LIGHT_EFFORT}`
    : `--model ${model} --effort ${REVIEW_EFFORT}`

const FULL_REVIEW: ReviewMode = { mode: "full", reason: "" }

/** What this run reviews: the whole PR, or on a re-review the changes since the last one. */
export const reviewRange = (
  baseRef: string | undefined,
  reviewMode: ReviewMode
): string | undefined =>
  reviewMode.mode === "rereview"
    ? `${reviewMode.previous.sha}..HEAD`
    : baseRef && `origin/${baseRef}...HEAD`

/**
 * Reads the diff once for the experiments that need it. Lean reviews of
 * light diffs get LIGHT_MODEL, unless the caller set its own model. Security-experiment
 * reviews use the sensitive files. Any failure to read the diff means standard, with no
 * sensitive files.
 */
export const assessChanges = (
  groups: { review: boolean; security: boolean },
  model: string,
  range: string | undefined,
  ignorePaths: string[]
): { tier: ReviewTier; reason: string; sensitive: string[] } => {
  if (!groups.review && !groups.security) {
    return {
      tier: "standard",
      reason: "not in the review or security experiment",
      sensitive: [],
    }
  }
  if (!range) {
    return { tier: "standard", reason: "no base branch", sensitive: [] }
  }

  let risk: DiffRisk
  try {
    risk = classifyDiff(range, ignorePaths)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      tier: "standard",
      reason: `could not read the diff: ${message}`,
      sensitive: [],
    }
  }
  if (!groups.review) {
    return {
      tier: "standard",
      reason: "not in the lean reviews experiment",
      sensitive: risk.sensitive,
    }
  }
  if (model !== DEFAULT_MODEL) {
    return {
      tier: "standard",
      reason: `caller set model ${model}`,
      sensitive: risk.sensitive,
    }
  }
  return risk
}

const MAX_SECURITY_FILES = 30

/**
 * The subagent in .claude/agents. Namespaced, because Claude Code prefers an agent of
 * the same name in the repo under review, which a PR could add.
 */
export const SECURITY_AGENT = "duchamp-security-reviewer"

/**
 * Writes the diff the subagent reads, so the reviewer doesn't copy it into the Agent
 * call. The labelled pass covers every file. Undefined when git or the write fails.
 */
export const writeSecurityDiff = (
  range: string,
  files: string[] | null,
  ignorePaths: string[],
  dir: string = process.env.RUNNER_TEMP || os.tmpdir()
): string | undefined => {
  try {
    const pathspec = files
      ? files.map(file => `:(literal)${file}`)
      : diffPathspec(ignorePaths)
    const diffPath = path.join(dir, "security.diff")
    fs.writeFileSync(diffPath, git(["diff", range, "--", ...pathspec]))
    return diffPath
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: Failed to write the security diff: ${message}`)
    return undefined
  }
}

/**
 * Hands the security read to the SECURITY_AGENT subagent, for security-experiment PRs
 * that touch sensitive files or carry SECURITY_LABEL.
 */
export const formatSecuritySection = (
  sensitive: string[],
  labelled: boolean,
  range: string | undefined,
  diffPath?: string
): string => {
  if (!range || (sensitive.length === 0 && !labelled)) {
    return ""
  }

  const listed = sensitive.slice(0, MAX_SECURITY_FILES)
  const more = sensitive.length - listed.length
  const why = labelled
    ? `The PR carries the \`${SECURITY_LABEL}\` label, so the author asked for a security read of the whole change, \`${range}\`.\n`
    : `This PR touches files where a small change can open a security hole:\n\n${listed.map(f => `- \`${f}\``).join("\n")}${more > 0 ? `\n- and ${more} more` : ""}\n`
  const scope = labelled ? "every changed file" : "the files above"
  const handoff = diffPath
    ? `give it the list of ${scope} and the path \`${diffPath}\`, which holds \`git diff ${range}\` for them. It reads the diff from there; do not copy the diff into the call.`
    : `give it the list of ${scope} and the diff hunks for them from \`git diff ${range}\`.`

  return [
    "\n## Security Pass\n",
    why,
    `This step is required. As soon as you have the diff, start the security subagent: call the Agent tool (it may be listed as Task) with \`subagent_type: "${SECURITY_AGENT}"\`. It can read files but cannot run git, so ${handoff} A review that ends without it has not been delivered. If the Agent tool says \`${SECURITY_AGENT}\` does not exist, do this security read yourself and say so in the summary.\n`,
    'Its leads are claims to check, like the PR description. Verify each one against the code as "Verify Before You Claim" says. Post the ones that hold up as security findings, in the full-paragraph format. Drop the rest; do not post a lead you could not confirm.\n',
    "In the summary, say in one line that the security pass ran and how many of its leads you posted.\n",
  ].join("\n")
}

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

/** Clone the repo's related repos when this review uses them (see inRelatedReposExperiment). */
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
      "Ignoring related_repos: only PRs in the related-repos experiment read them"
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

/** CLAUDE.md imports AGENTS.md, or is a symlink to it. readlink reads nothing through the link. */
const claudeMdLoadsAgentsMd = (): boolean => {
  const filePath = path.join(process.cwd(), "CLAUDE.md")
  if (fs.lstatSync(filePath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    return path.basename(fs.readlinkSync(filePath)) === "AGENTS.md"
  }
  return readRegularFile("CLAUDE.md")?.includes("@AGENTS.md") ?? false
}

/**
 * Inline the repo's root AGENTS.md, which the reviewer would otherwise spend a turn
 * reading. The action already loads CLAUDE.md, and AGENTS.md with it when CLAUDE.md
 * imports it, so those stay out.
 */
export const formatInstructionsSection = (): string => {
  if (claudeMdLoadsAgentsMd()) {
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
  const runGitDiff = `\n## The Diff\n\nRun \`git diff ${range}\` to see the changes.\n`
  if (maxBytes <= 0) {
    return runGitDiff
  }

  try {
    const { inlined, block } = renderDiff(range, ignorePaths, maxBytes)
    const intro = inlined
      ? `The full output of \`git diff ${range}\`, leaving out lockfiles and ignored paths. Do not run git diff for it again; read files for the code around it.`
      : `The diff is too large to include. These files changed (lines added, lines removed, path); run \`git diff ${range} -- <path>\` for the ones you need.`
    return ["\n## The Diff\n", `${intro}\n`, block, ""].join("\n")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: Failed to read the PR diff: ${message}`)
    return runGitDiff
  }
}

/**
 * The repo instructions and the changes for experiment reviews, sized to what
 * promptBytes leaves under MAX_PROMPT_BYTES, and as a re-review when there is an
 * earlier review to build on. They replace the workflow's steps to read AGENTS.md or
 * CLAUDE.md and run git diff, which other reviews still follow. Returns the mode that
 * ran: full when the re-review fails.
 */
export const formatContextSection = (
  baseRef: string | undefined,
  ignorePaths: string[],
  promptBytes = 0,
  reviewMode: ReviewMode = FULL_REVIEW
): { section: string; reviewMode: ReviewMode } => {
  const lead =
    "\n## Context Already Loaded\n\nSkip the steps above to read AGENTS.md or CLAUDE.md and run `git diff`. CLAUDE.md is already in your context, and the sections below give AGENTS.md and the diff, or say what to fetch. When you know several files you need, read them all in one turn rather than one per turn.\n"
  const instructions = formatInstructionsSection()
  const diffBytes = Math.min(
    MAX_DIFF_BYTES,
    MAX_PROMPT_BYTES - promptBytes - Buffer.byteLength(lead + instructions)
  )

  let changes: string | undefined
  if (reviewMode.mode === "rereview" && baseRef) {
    try {
      changes = formatRereviewSection(
        reviewMode.previous,
        baseRef,
        ignorePaths,
        diffBytes
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `Warning: Failed to build the re-review section: ${message}`
      )
    }
  }
  if (changes === undefined) {
    return {
      section:
        lead +
        instructions +
        formatDiffSection(baseRef, ignorePaths, diffBytes),
      reviewMode:
        reviewMode.mode === "rereview"
          ? { mode: "full", reason: "could not build the re-review" }
          : reviewMode,
    }
  }
  return { section: lead + instructions + changes, reviewMode }
}

/** Outputs the workflow's later steps need. */
export const formatReviewModeOutputs = (reviewMode: ReviewMode): string =>
  [
    `review_mode=${reviewMode.mode}`,
    `reviewed_since=${reviewMode.mode === "rereview" ? reviewMode.previous.sha.slice(0, 7) : ""}`,
    "",
  ].join("\n")

/** Experiment reviews only: fewer inline comments, so the ones left carry weight. */
export const LEAN_INLINE_SECTION = [
  "\n## Which Findings Go Inline\n",
  'This section narrows "How to Write Comments" and "Report Format". Where they disagree, follow this section.\n',
  "- **Nits never go inline.** List at most three in the summary under `### Nits`, one line each, with a `file:line`. Leave the rest out.",
  "- **Questions go inline only when the answer decides whether the PR is safe to merge**, that is, when one answer would make it blocking or required. Put other questions under Questions for Author in the summary.",
  "- **Score each required finding before you post it.** Rate how likely its trigger is in real use, from 1 (rare edge case) to 5 (most requests or users hit it), and how bad the outcome is, from 1 (cosmetic) to 5 (data loss, outage or security). Multiply the two. If the product is below 6, the finding is not required: put it under Suggestions in the summary and do not post it inline. Do not show the scores in comments.",
  "- **Blocking findings are not scored.** Security, data loss and broken core paths always go inline.",
  "",
].join("\n")

/** The prompt in order; experiment reviews get the inline rules before delivery. */
export const assemblePrompt = (
  parts: { head: string; context: string; delivery: string },
  inLean: boolean
): string =>
  parts.head +
  parts.context +
  (inLean ? LEAN_INLINE_SECTION : "") +
  parts.delivery

const REVIEW_TOOLS =
  "Read,Glob,Grep,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(gh pr diff:*),Bash(gh pr view:*),Skill,mcp__github_inline_comment__create_inline_comment"

const SUMMARY_SCHEMA =
  '{"type":"object","properties":{"summary":{"type":"string","description":"The review summary comment, in Markdown"}},"required":["summary"]}'

/**
 * Experiment reviews return the summary, and the workflow posts it with the run's
 * stats and re-review marker as github-actions[bot]. Other reviews post it themselves,
 * so it shows as claude[bot].
 */
export const formatDelivery = (
  inLean: boolean,
  prNumber = "",
  securityPass = false
): { toolArgs: string; section: string } => {
  const tools = securityPass ? `${REVIEW_TOOLS},Agent` : REVIEW_TOOLS
  const inline =
    "Use `mcp__github_inline_comment__create_inline_comment` for inline code comments."
  if (inLean) {
    return {
      toolArgs: `--allowedTools "${tools}" --json-schema '${SUMMARY_SCHEMA}'`,
      section: `\n## How to Deliver Your Review\n\n${inline}\nReturn the summary comment as the \`summary\` field of your structured output. The workflow posts it on the PR; do not post it yourself.\n`,
    }
  }
  return {
    toolArgs: `--allowedTools "Bash(gh pr comment:*),${tools}"`,
    section: `\n## How to Deliver Your Review\n\n${inline}\nPost the summary comment with \`gh pr comment ${prNumber}\`, once. Only post GitHub comments; do not submit review text as messages.\n`,
  }
}

const main = (): void => {
  const labels = parseLabels(process.env.PR_LABELS)
  const inLean = inLeanReviews(process.env.PR_AUTHOR, labels)
  const inRelatedRepos = inRelatedReposExperiment(process.env.PR_AUTHOR, labels)
  const inSecurity = inSecurityExperiment(process.env.PR_AUTHOR, labels)
  const labelled = hasSecurityLabel(labels)
  const bestPractices = inBestPractices(process.env.PR_AUTHOR, labels)

  // Lets the workflow skip minting the related repos token for reviews that don't use it.
  if (process.argv.includes("--check-experiment")) {
    const outputPath = process.env.GITHUB_OUTPUT
    if (outputPath) {
      fs.appendFileSync(
        outputPath,
        `experiment=${inLean}\nrelated_repos=${inRelatedRepos}\n`
      )
    }
    console.log(`Lean reviews experiment: ${inLean}`)
    console.log(`Related repos: ${inRelatedRepos}`)
    return
  }

  const ignorePaths = loadRepoConfig()?.ignore_paths ?? []
  const reviewMode = pickReviewMode(
    process.env.TRIGGER_LABEL,
    process.env.GITHUB_REPOSITORY,
    process.env.PR_NUMBER,
    ignorePaths,
    inLean
  )
  console.log(`Review mode: ${reviewMode.mode} (${reviewMode.reason})`)

  const outputPath = process.env.GITHUB_OUTPUT
  if (reviewMode.mode === "skip") {
    if (outputPath) {
      fs.appendFileSync(outputPath, "review_mode=skip\n")
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `AI review skipped: ${reviewMode.reason}. The earlier review stands.\n`
      )
    }
    return
  }

  const model = process.env.DEFAULT_MODEL || DEFAULT_MODEL
  const range = reviewRange(process.env.BASE_REF, reviewMode)
  const changes = assessChanges(
    { review: inLean, security: inSecurity },
    model,
    range,
    ignorePaths
  )
  console.log(`Review tier: ${changes.tier} (${changes.reason})`)
  // The label asks for the whole change, even on a re-review of a few commits.
  const securityRange = labelled
    ? reviewRange(process.env.BASE_REF, FULL_REVIEW)
    : range
  const security =
    inSecurity && securityRange && (labelled || changes.sensitive.length > 0)
      ? formatSecuritySection(
          changes.sensitive,
          labelled,
          securityRange,
          writeSecurityDiff(
            securityRange,
            labelled ? null : changes.sensitive,
            ignorePaths
          )
        )
      : ""
  console.log(`Security pass: ${security !== ""}`)
  const stack = resolveStackSkills(
    bestPractices,
    process.env.GITHUB_REPOSITORY,
    range,
    ignorePaths
  )
  console.log(
    `Stack skills: ${stack.skills.join(", ") || "none"} (${stack.reason})`
  )

  const related = resolveRelatedRepos(inRelatedRepos)
  // These sections go in the head so the diff's budget leaves room for them.
  const promptHead =
    buildPrompt() +
    formatRelatedReposSection(related, process.env.REPO_PRIVATE === "true") +
    security +
    formatStackSkillsSection(stack.skills)
  const context = inLean
    ? formatContextSection(
        process.env.BASE_REF,
        ignorePaths,
        Buffer.byteLength(promptHead),
        reviewMode
      )
    : { section: "", reviewMode }
  const delivery = formatDelivery(
    inLean,
    process.env.PR_NUMBER,
    security !== ""
  )
  const prompt = assemblePrompt(
    {
      head: promptHead,
      context: context.section,
      delivery: delivery.section,
    },
    inLean
  )
  const modelArgs = [resolveModelArgs(model, changes.tier), addDirArgs(related)]
    .filter(Boolean)
    .join(" ")

  // Set the output for GitHub Actions
  if (outputPath) {
    // Repo files reach the prompt verbatim, so a guessable delimiter could end it early
    const delimiter = `EOF_${randomUUID()}`
    fs.appendFileSync(
      outputPath,
      `review_prompt<<${delimiter}\n${prompt}\n${delimiter}\nmodel_args=${modelArgs}\ntool_args=${delivery.toolArgs}\nsecurity_pass=${security !== ""}\nbest_practices=${stack.skills.length > 0}\nstack_skills=${stack.skills.join(" ")}\nrelated_repos_read=${related.length > 0}\n${formatReviewModeOutputs(context.reviewMode)}`
    )
    console.log("Review prompt written to GITHUB_OUTPUT")
  } else {
    // For local testing, just print the prompt
    console.log(`Model args: ${modelArgs}`)
    console.log(`Tool args: ${delivery.toolArgs}`)
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
