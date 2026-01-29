const fs = require("fs")
const path = require("path")

/**
 * Build a review prompt by merging default Artsy guidelines with repo-specific configuration.
 *
 * Repos can create a .claude-review.yml file with:
 * - prompt: Complete custom prompt (overrides everything else)
 * - focus_areas: Array of specific things to watch for (added to default prompt)
 * - ignore_paths: Glob patterns for files to skip
 * - context: Additional context about the codebase
 *
 * Example .claude-review.yml:
 *   focus_areas:
 *     - "Watch for N+1 queries in database operations"
 *     - "Ensure new endpoints have authentication"
 *   ignore_paths:
 *     - "**\/*.generated.ts"
 *   context: |
 *     This is a Ruby on Rails API using GraphQL.
 *
 * Or for complete control:
 *   prompt: |
 *     You are a security-focused reviewer...
 *     (your entire custom prompt here)
 */

const DEFAULT_PROMPT = `You are a senior staff engineer conducting a code review.
You have access to the full codebase. The PR branch has been checked out.

## Your Task
1. Review the changes in this pull request
2. Read related files to understand how changes integrate with existing code
3. Check if tests exist for the changed code
4. Provide a focused code review

## Review Format

### Summary
2-3 sentences on what this PR does.

### Issues Found
Organize by priority:
- 🔴 **Blocking**: Must fix before merge (bugs, security issues, broken functionality)
- 🟡 **Important**: Should fix (performance problems, missing error handling, test gaps)
- 🟢 **Suggestion**: Nice to have (code style, minor improvements)

For each issue, include the file path and line number when relevant.

If the PR looks good, say so! Not every PR has problems.

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

---
Be constructive and explain your reasoning. Focus on substantive issues, not style nitpicks.
`

function parseYaml(content) {
  // Simple YAML parser for our specific config format
  const config = {
    prompt: "",
    focus_areas: [],
    ignore_paths: [],
    context: "",
  }

  const lines = content.split("\n")
  let currentKey = null
  let inMultiline = false
  let multilineContent = []

  for (const line of lines) {
    // Check for multiline indicator
    if (line.match(/^(\w+):\s*\|$/)) {
      const match = line.match(/^(\w+):\s*\|$/)
      currentKey = match[1]
      inMultiline = true
      multilineContent = []
      continue
    }

    // Handle multiline content
    if (inMultiline) {
      if (line.match(/^\s{2}/) || line === "") {
        multilineContent.push(line.replace(/^\s{2}/, ""))
        continue
      } else {
        config[currentKey] = multilineContent.join("\n").trim()
        inMultiline = false
      }
    }

    // Check for array key
    if (line.match(/^(\w+):$/)) {
      const match = line.match(/^(\w+):$/)
      currentKey = match[1]
      continue
    }

    // Check for array item
    if (line.match(/^\s+-\s+"(.+)"$/) || line.match(/^\s+-\s+'(.+)'$/)) {
      const match =
        line.match(/^\s+-\s+"(.+)"$/) || line.match(/^\s+-\s+'(.+)'$/)
      if (currentKey && Array.isArray(config[currentKey])) {
        config[currentKey].push(match[1])
      }
      continue
    }

    // Check for unquoted array item
    if (line.match(/^\s+-\s+(.+)$/)) {
      const match = line.match(/^\s+-\s+(.+)$/)
      if (currentKey && Array.isArray(config[currentKey])) {
        config[currentKey].push(match[1])
      }
    }
  }

  // Handle any remaining multiline content
  if (inMultiline) {
    config[currentKey] = multilineContent.join("\n").trim()
  }

  return config
}

function loadRepoConfig() {
  const configPath = path.join(process.cwd(), ".claude-review.yml")

  if (!fs.existsSync(configPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(configPath, "utf8")
    return parseYaml(content)
  } catch (error) {
    console.error(
      `Warning: Failed to parse .claude-review.yml: ${error.message}`
    )
    return null
  }
}

function buildPrompt() {
  const repoConfig = loadRepoConfig()

  // If repo provides a complete custom prompt, use it directly
  if (repoConfig && repoConfig.prompt) {
    return repoConfig.prompt
  }

  // Otherwise, build from default + customizations
  let prompt = DEFAULT_PROMPT

  if (repoConfig) {
    // Add repo-specific context
    if (repoConfig.context) {
      prompt += `\n## Repository Context\n\n${repoConfig.context}\n`
    }

    // Add focus areas
    if (repoConfig.focus_areas && repoConfig.focus_areas.length > 0) {
      prompt += "\n## Additional Focus Areas\n\nPay special attention to:\n"
      for (const area of repoConfig.focus_areas) {
        prompt += `- ${area}\n`
      }
    }

    // Add ignore paths
    if (repoConfig.ignore_paths && repoConfig.ignore_paths.length > 0) {
      prompt += "\n## Files to Skip\n\nDo not review changes in:\n"
      for (const pattern of repoConfig.ignore_paths) {
        prompt += `- ${pattern}\n`
      }
    }
  }

  return prompt
}

function main() {
  const prompt = buildPrompt()

  // Escape the prompt for GitHub Actions output
  // GitHub Actions requires escaping %, \n, and \r
  const escapedPrompt = prompt
    .replace(/%/g, "%25")
    .replace(/\n/g, "%0A")
    .replace(/\r/g, "%0D")

  // Set the output for GitHub Actions
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath) {
    fs.appendFileSync(outputPath, `review_prompt=${escapedPrompt}\n`)
    console.log("Review prompt written to GITHUB_OUTPUT")
  } else {
    // For local testing, just print the prompt
    console.log("Generated review prompt:")
    console.log("---")
    console.log(prompt)
    console.log("---")
  }
}

module.exports = { buildPrompt, parseYaml, loadRepoConfig, DEFAULT_PROMPT }

// Run main if this is the entry point
if (require.main === module) {
  main()
}
