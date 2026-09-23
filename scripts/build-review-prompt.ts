import * as fs from "fs"
import * as yaml from "js-yaml"
import * as path from "path"

/**
 * Build a review prompt by merging default Artsy guidelines with repo-specific configuration.
 *
 * Repos can create a .claude-review.yml file with:
 * - prompt: Complete custom prompt (overrides everything else)
 * - focus_areas: Array of specific things to watch for (added to default prompt)
 * - ignore_paths: Glob patterns for files to skip
 * - context: Additional context about the codebase
 *
 * PRs in the review experiment swap DEFAULT_PROMPT for review-experiment/prompt.md
 * and run on EXPERIMENT_MODEL. A PR is in the experiment when its author is listed in
 * review-experiment/participants.yml, or when it carries the EXPERIMENT_LABEL.
 * See review-experiment/README.md.
 */

interface ExcludeConfig {
  title_patterns?: string[]
  disable_defaults?: boolean
}

interface ReviewPrompt {
  prompt: string
  /** True only when the experiment prompt is in use, so the model follows the prompt. */
  experiment: boolean
}

interface RepoConfig {
  prompt?: string
  focus_areas?: string[]
  ignore_paths?: string[]
  context?: string
  exclude?: ExcludeConfig
}

export const DEFAULT_PROMPT = `You are a senior staff engineer conducting a code review.
You have access to the full codebase. The PR branch has been checked out.

## Critical: Avoid False Positives

**False positives damage developer trust more than missed issues help.**

Before suggesting ANY change:
1. Read the actual code/diff to verify your claim
2. If suggesting something "should be" a certain way, CHECK if it already IS that way
3. Do not suggest changes that are already implemented
4. If you cannot verify a claim with evidence from the code, do not make it

Common hallucination patterns to avoid:
- Suggesting alphabetization when items are already alphabetized
- Recommending error handling that already exists
- Proposing tests that are already present
- Claiming missing documentation that exists elsewhere

## Your Task
1. Use git diff to see the changes, then use Glob/Grep/Read to explore related files
2. Check how the changed code integrates with existing patterns in the codebase
3. Look for existing tests - use Glob to find test files, Read to check coverage
4. VERIFY before suggesting: only raise issues you can prove with specific code references
5. Provide a focused code review - quality over quantity
6. **Post your review as a comment on this pull request**

## Review Format

### Summary
2-3 sentences on what this PR does.

### Issues Found
Organize by priority:
- 🔴 **Blocking**: Must fix before merge (bugs, security issues, broken functionality)
- 🟡 **Important**: Should fix (performance problems, missing error handling, test gaps)
- 🟢 **Suggestion**: Nice to have (code style, minor improvements)

For each issue you report:
1. State the specific file and line
2. Quote the relevant code
3. Explain why it is a problem with evidence

**Only report issues you are confident about.** If you are uncertain, use "Questions for Author" instead.

If the PR looks good, say so! Many PRs have no significant issues - this is normal and good.

### Areas Reviewed
Briefly note any concerns in these areas (skip if nothing notable):
- Architecture & Design
- Security
- Performance (N+1 queries, unnecessary computation, memory issues)
- Bugs & Edge Cases
- Testing

### Questions for Author
List anything unclear that needs clarification before you can fully assess the PR.

## How to write
- Lead with the problem. No preamble like "I noticed that" or "It might be worth considering".
- Short words, active voice: "this leaks the handle", not "a resource leak may be introduced".
- Cut every word that adds nothing. "Because", not "due to the fact that"; "to", not "in order to"; "before", not "prior to".
- Concrete subjects. "The query runs once per row", not "there is a potential performance implication".
- Cut hedges. One "may" per comment at most; if you are not sure, verify or drop it.
- No filler praise and no closing summary. State the issue and the fix, then stop.
- Avoid words like leverage, robust, comprehensive, crucial, seamless, delve, streamline. Use everyday words.
- Go easy on em-dashes; prefer commas and full stops.

---
Be constructive and explain your reasoning. Focus on substantive issues, not style nitpicks.

Remember: An empty "Issues Found" section is a valid and often correct outcome. The goal is accurate review, not comprehensive critique.
`

/** Label that opts a single PR into the experiment without enrolling its author. */
export const EXPERIMENT_LABEL = "ai-review-experiment"

export const EXPERIMENT_MODEL = "claude-opus-5-5"

export const EXPERIMENT_EFFORT = "medium"

/**
 * Experiment files live in this repo's checkout, never in the PR under review, so a
 * PR author cannot swap in their own review prompt through their own changes.
 */
const experimentPath = (file: string): string =>
  path.join(__dirname, "..", "review-experiment", file)

export const loadParticipants = (): string[] => {
  const participantsPath = experimentPath("participants.yml")

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

export const isExperimentPR = (
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

export const loadExperimentPrompt = (): string | null => {
  const promptPath = experimentPath("prompt.md")

  try {
    return fs.readFileSync(promptPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `Warning: Failed to read review-experiment/prompt.md, falling back to the default prompt: ${message}`
    )
    return null
  }
}

/**
 * Pick the base prompt for this PR. Repo-level customisations are layered on top of
 * whichever one comes back.
 */
export const resolveBasePrompt = (
  author: string | undefined,
  labels: string[]
): ReviewPrompt => {
  if (!isExperimentPR(author, labels)) {
    return { prompt: DEFAULT_PROMPT, experiment: false }
  }

  const experimentPrompt = loadExperimentPrompt()

  if (!experimentPrompt) {
    return { prompt: DEFAULT_PROMPT, experiment: false }
  }

  console.log("Using experimental review prompt")
  return { prompt: experimentPrompt, experiment: true }
}

/** Claude Code CLI flags that select the model for this review. */
export const resolveModelArgs = (
  experiment: boolean,
  defaultModel: string
): string =>
  experiment
    ? `--model ${EXPERIMENT_MODEL} --effort ${EXPERIMENT_EFFORT}`
    : `--model ${defaultModel}`

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

export const buildPrompt = (): ReviewPrompt => {
  const repoConfig = loadRepoConfig()

  // If repo provides a complete custom prompt, use it directly. This wins over the
  // experiment too - a repo that sets it has opted out.
  if (repoConfig?.prompt) {
    return { prompt: repoConfig.prompt, experiment: false }
  }

  // Otherwise, build from the base prompt + customizations
  const base = resolveBasePrompt(
    process.env.PR_AUTHOR,
    parseLabels(process.env.PR_LABELS)
  )
  const sections = [base.prompt]

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

  return { prompt: sections.join(""), experiment: base.experiment }
}

const main = (): void => {
  const { prompt, experiment } = buildPrompt()
  const modelArgs = resolveModelArgs(
    experiment,
    process.env.DEFAULT_MODEL ?? "claude-opus-4-8"
  )

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
