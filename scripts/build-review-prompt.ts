import * as fs from "fs"
import * as yaml from "js-yaml"
import * as path from "path"

/**
 * Build a review prompt by merging default Artsy guidelines with repo-specific
 * configuration and the PR author's personal review style.
 *
 * Repos can create a .claude-review.yml file with:
 * - prompt: Complete custom prompt (overrides everything else)
 * - focus_areas: Array of specific things to watch for (added to default prompt)
 * - ignore_paths: Glob patterns for files to skip
 * - context: Additional context about the codebase
 *
 * Individuals can create a review-styles/<github-login>.md file (in this repo) with
 * optional frontmatter choosing how it merges with the default prompt:
 * - mode: augment (default) - keep the default prompt, append the style as a
 *   preference section
 * - mode: replace_style - keep guardrails/format, swap only the "How to write" tone
 * - mode: override - the personal file becomes the entire prompt
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
}

export type PersonalStyleMode = "augment" | "replace_style" | "override"

const VALID_PERSONAL_STYLE_MODES: PersonalStyleMode[] = [
  "augment",
  "replace_style",
  "override",
]

export interface PersonalStyle {
  login: string
  mode: PersonalStyleMode
  content: string
}

export const PROMPT_HEADER = `You are a senior staff engineer conducting a code review.
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

`

export const HOW_TO_WRITE = `## How to write
- Lead with the problem. No preamble like "I noticed that" or "It might be worth considering".
- Short words, active voice: "this leaks the handle", not "a resource leak may be introduced".
- Cut every word that adds nothing. "Because", not "due to the fact that"; "to", not "in order to"; "before", not "prior to".
- Concrete subjects. "The query runs once per row", not "there is a potential performance implication".
- Cut hedges. One "may" per comment at most; if you are not sure, verify or drop it.
- No filler praise and no closing summary. State the issue and the fix, then stop.
- Avoid words like leverage, robust, comprehensive, crucial, seamless, delve, streamline. Use everyday words.
- Go easy on em-dashes; prefer commas and full stops.

`

export const PROMPT_CLOSING = `---
Be constructive and explain your reasoning. Focus on substantive issues, not style nitpicks.

Remember: An empty "Issues Found" section is a valid and often correct outcome. The goal is accurate review, not comprehensive critique.
`

export const DEFAULT_PROMPT = PROMPT_HEADER + HOW_TO_WRITE + PROMPT_CLOSING

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

/**
 * Parse a personal style file's contents into a mode + body.
 *
 * The file may start with YAML frontmatter (delimited by `---` lines) specifying
 * `mode`. Everything after the frontmatter (or the whole file, if there is none)
 * is the style content. Pure function - no file IO - so it's easy to unit test.
 */
export const parsePersonalStyle = (
  login: string,
  raw: string
): PersonalStyle => {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)

  let rawMode: unknown
  let content = raw

  if (frontmatterMatch) {
    content = raw.slice(frontmatterMatch[0].length)
    try {
      const frontmatter = yaml.load(frontmatterMatch[1]) as { mode?: unknown }
      rawMode = frontmatter?.mode
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `Warning: Failed to parse frontmatter in review-styles/${login}.md: ${message}`
      )
    }
  }

  let mode: PersonalStyleMode = "augment"
  if (rawMode !== undefined) {
    if (VALID_PERSONAL_STYLE_MODES.includes(rawMode as PersonalStyleMode)) {
      mode = rawMode as PersonalStyleMode
    } else {
      console.error(
        `Warning: Unknown mode "${String(rawMode)}" in review-styles/${login}.md, falling back to "augment"`
      )
    }
  }

  return { login, mode, content: content.trim() }
}

/**
 * Load the PR author's personal review style, if they have one.
 *
 * Resolved relative to this script's location (not process.cwd(), which is the
 * checked-out PR repo) since style files live centrally in this repo.
 */
export const loadPersonalStyle = (
  author: string | undefined
): PersonalStyle | null => {
  if (!author) {
    return null
  }

  const login = author.toLowerCase()
  const stylePath = path.join(__dirname, "..", "review-styles", `${login}.md`)

  if (!fs.existsSync(stylePath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(stylePath, "utf8")
    return parsePersonalStyle(login, raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `Warning: Failed to read review-styles/${login}.md: ${message}`
    )
    return null
  }
}

/**
 * Assemble the final prompt from repo config and personal style. Pure function -
 * both inputs are already loaded - so merge behavior is directly testable.
 */
export const assemblePrompt = (
  repoConfig: RepoConfig | null,
  personalStyle: PersonalStyle | null
): string => {
  // A personal full override takes the place of the default prompt entirely,
  // but repo-level customization (context/focus areas/ignore paths) still applies -
  // see buildPrompt() for the repo `prompt:` override, which beats everything.
  if (personalStyle?.mode === "override") {
    return personalStyle.content
  }

  const base =
    personalStyle?.mode === "replace_style"
      ? PROMPT_HEADER +
        `## How to write\n${personalStyle.content}\n\n` +
        PROMPT_CLOSING
      : DEFAULT_PROMPT

  const sections = [base]

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

  if (personalStyle?.mode === "augment") {
    sections.push(
      `\n## Reviewer Style Preferences (${personalStyle.login})\n\n` +
        `The PR author has personal review-style preferences below. Where these conflict with the guidance above, prefer these.\n\n` +
        `${personalStyle.content}\n`
    )
  }

  return sections.join("")
}

export const buildPrompt = (): string => {
  const repoConfig = loadRepoConfig()

  // If repo provides a complete custom prompt, use it directly - this is a
  // deliberate repo-wide decision and beats any personal style.
  if (repoConfig?.prompt) {
    return repoConfig.prompt
  }

  const personalStyle = loadPersonalStyle(process.env.PR_AUTHOR)

  return assemblePrompt(repoConfig, personalStyle)
}

const main = (): void => {
  const prompt = buildPrompt()

  // Set the output for GitHub Actions
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath) {
    // Use heredoc-style delimiter for multiline output (modern GitHub Actions approach)
    const delimiter = `EOF_${Date.now()}`
    fs.appendFileSync(
      outputPath,
      `review_prompt<<${delimiter}\n${prompt}\n${delimiter}\n`
    )
    console.log("Review prompt written to GITHUB_OUTPUT")
  } else {
    // For local testing, just print the prompt
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
