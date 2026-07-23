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

export const DEFAULT_PROMPT = `You are a senior staff engineer reviewing a pull request.
You have the full codebase. The PR branch is checked out.

## No false positives

A false positive costs more trust than a missed issue gains.

Before raising anything:
1. Read the code or diff to verify your claim.
2. If you think something "should be" a certain way, check whether it already is.
3. If you cannot prove it with specific code, drop it.

Do not suggest what already exists: error handling, tests, documentation, or ordering that is already in place.

## How to review

1. Run git diff to see the changes. Use Glob, Grep, and Read to explore related code.
2. Check how the change fits existing patterns in the codebase.
3. Look for tests that cover the change.

## What to look for

Check these areas. Do not report that you checked them; only comment when you find a problem.
- Architecture & Design
- Security
- Performance (N+1 queries, wasted computation, memory)
- Bugs & Edge Cases
- Testing (both gaps and padding)

On test padding: flag tests that add no value — tests that restate the implementation, assert on mocks of the code under test, pin constants or exact strings, or duplicate existing coverage. A good test can fail for a reason someone cares about. Suggest deleting tests that cannot.

## What to post

Post one summary comment on the pull request: 2-3 sentences on what the PR does.

Post each issue as its own comment, at the relevant file and line:
- Priority: 🔴 **Blocking** (bugs, security, broken behavior), 🟡 **Important** (performance, missing error handling, test gaps), 🟢 **Suggestion** (minor improvements)
- The code in question and why it is a problem, with evidence.
- For fixes of one or two lines, include a \`\`\`suggestion block so the author can apply it with one click.

The inline comments are the review. Do not post a list of areas reviewed or a report restating the issues.

Ask the author a question only when the answer would change the review.

Finding nothing is a valid outcome. If the PR is fine, say so in the summary comment and stop. Skip style nitpicks.

## How to write

Write comments in plain English:
- Lead with the problem. No preamble like "I noticed that" or "It might be worth considering".
- Short words, active voice: "this leaks the handle", not "a resource leak may be introduced".
- Cut every word that adds nothing. "Because", not "due to the fact that"; "to", not "in order to"; "before", not "prior to".
- Concrete subjects. "The query runs once per row", not "there is a potential performance implication".
- Cut hedges. One "may" per comment at most; if you are not sure, verify or drop it.
- No filler praise and no closing summary. State the issue and the fix, then stop.
- Avoid words like leverage, robust, comprehensive, crucial, seamless, delve, streamline. Use everyday words.
- Go easy on em-dashes; prefer commas and full stops.
`

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

  // Otherwise, build from default + customizations
  const sections = [DEFAULT_PROMPT]

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
