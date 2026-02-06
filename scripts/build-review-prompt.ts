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

interface RepoConfig {
  prompt?: string
  focus_areas?: string[]
  ignore_paths?: string[]
  context?: string
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

### Verdict
One of:
- ✅ **Approve**: Good to merge (possibly with minor suggestions)
- 🔄 **Request Changes**: Has blocking issues that must be addressed
- 💬 **Needs Discussion**: Requires clarification or team input on approach

**Default to Approve** unless you have verified blocking issues. When in doubt, approve with questions.

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
