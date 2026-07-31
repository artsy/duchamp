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

const PASS1_FINDINGS_FILENAME = "pass1-findings.md"

/**
 * Where the pass-1 (finder) step writes its raw findings, and where the
 * pass-2 (filter) step reads them from. Lives outside the checked-out repo
 * (the CI runner's temp dir) so it never shows up in git status and never
 * needs its own cleanup step.
 */
export const pass1FindingsPath = (): string =>
  path.join(process.env.RUNNER_TEMP || "/tmp", PASS1_FINDINGS_FILENAME)

export const FINDER_PROMPT = `You are doing PASS 1 of a two-pass code review: find, don't judge.
You have access to the full codebase. The PR branch has been checked out.
A second, separate pass will read your output, verify it, and decide what's worth reporting - that is not your job here.

## Your Task
1. Use git diff to see the changes, then use Glob/Grep/Read to explore related files and existing patterns.
2. List every issue you notice, including ones you are uncertain about or consider minor. Do not filter for importance or confidence - a second pass will do that. It is better to surface something that later gets filtered out than to silently drop it.
3. Where you can cheaply verify a claim (read the referenced code, check for an existing test), do so before listing it. An unverified guess is still worth listing - just don't spend excessive time confirming everything.

## Output Format
One line per finding: \`[confidence: low/med/high] [severity: nit/minor/major] claim, with file:line if applicable\`
No summary paragraph, no preamble, no "areas reviewed" section, no closing remarks. If you find nothing at all, output exactly \`NONE\`.

## What NOT to do
- Do not post anything to GitHub. This pass has no tools that can do so - it is read-only by design.
- Do not write a polished review. This list is raw material for an internal filtering step, not something a human will read directly.

Write your complete findings list to ${pass1FindingsPath()} using the Write tool (overwrite it if it already exists).
`

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

const appendConfigSections = (
  base: string,
  repoConfig: RepoConfig | null
): string => {
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

  return sections.join("")
}

/**
 * Prepends a pass-1 (finder) findings list to a filter-pass prompt, if any
 * was provided. Framed as unverified leads, not a report to relay as-is -
 * the filter pass is expected to verify and cut most of it.
 */
const withPass1Findings = (prompt: string, pass1Findings?: string): string => {
  if (!pass1Findings || !pass1Findings.trim()) {
    return prompt
  }

  return `## Pass 1 Candidate Findings (unverified)

A first, read-only pass produced the raw findings below. Treat this as a list of leads to verify, not a report to relay as-is:
- Verify each claim against the diff and codebase before deciding whether it holds up.
- Drop anything that isn't real, doesn't matter, or is pure speculation.
- Most items here should NOT appear in your final review.
- If pass 1 found a genuine, verified bug, it must survive - do not water a real issue down to a nit because there are many other items around it.

${pass1Findings.trim()}

---

${prompt}`
}

export const buildFinderPrompt = (): string => {
  const repoConfig = loadRepoConfig()
  return appendConfigSections(FINDER_PROMPT, repoConfig)
}

export const buildPrompt = (pass1Findings?: string): string => {
  const repoConfig = loadRepoConfig()

  // If repo provides a complete custom prompt, use it directly (still gets
  // any pass-1 findings prepended - that step runs regardless of custom prompts)
  if (repoConfig?.prompt) {
    return withPass1Findings(repoConfig.prompt, pass1Findings)
  }

  return withPass1Findings(
    appendConfigSections(DEFAULT_PROMPT, repoConfig),
    pass1Findings
  )
}

const writeOutput = (prompt: string): void => {
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

const main = (): void => {
  const isFinderMode = process.argv.includes("--mode=finder")

  if (isFinderMode) {
    writeOutput(buildFinderPrompt())
    return
  }

  const findingsPath = pass1FindingsPath()
  const pass1Findings = fs.existsSync(findingsPath)
    ? fs.readFileSync(findingsPath, "utf8")
    : undefined

  writeOutput(buildPrompt(pass1Findings))
}

// Run main if this is the entry point
if (require.main === module) {
  main()
}
