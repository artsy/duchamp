/**
 * Check if a PR should be excluded based on title patterns.
 * Used by github-script in the workflow.
 */

const yaml = require("js-yaml")

const DEFAULT_TITLE_PATTERNS = ["^Deploy$", "graphql schema"]

function parseExcludeConfig(configContent) {
  if (!configContent) return null

  try {
    const config = yaml.load(configContent)
    return config?.exclude ?? null
  } catch {
    return null
  }
}

function checkTitleExclusion(title, configContent) {
  const config = parseExcludeConfig(configContent)
  const useDefaults = config?.disable_defaults !== true
  const customPatterns = config?.title_patterns ?? []

  if (useDefaults) {
    const matchedDefault = DEFAULT_TITLE_PATTERNS.find(pattern => {
      try {
        return new RegExp(pattern, "i").test(title)
      } catch {
        return false
      }
    })
    if (matchedDefault) {
      return {
        excluded: true,
        reason: `Title matches default pattern: ${matchedDefault}`,
      }
    }
  }

  const matchedCustom = customPatterns.find(pattern => {
    try {
      return new RegExp(pattern, "i").test(title)
    } catch {
      console.log(`Warning: Invalid regex pattern "${pattern}"`)
      return false
    }
  })
  if (matchedCustom) {
    return {
      excluded: true,
      reason: `Title matches custom pattern: ${matchedCustom}`,
    }
  }

  return { excluded: false }
}

/**
 * Bots whose PRs are reviewed. Their code is written on request rather than generated
 * mechanically, like a dependency bump. The `check` job's `if:` in claude-review.yml
 * names the same logins.
 */
const REVIEWED_BOTS = ["claude[bot]"]

/**
 * Whether a PR is from a reviewed bot. An app is not a collaborator, so the author's
 * write access can't be looked up. A branch in the repo itself stands in for it: only
 * an app installed with write access can push one, and a fork PR never qualifies.
 */
function isReviewedBotPr(pullRequest, repoFullName) {
  const login = pullRequest?.user?.login
  const headRepo = pullRequest?.head?.repo?.full_name

  return (
    pullRequest?.user?.type === "Bot" &&
    REVIEWED_BOTS.includes(login) &&
    !!headRepo &&
    headRepo.toLowerCase() === repoFullName.toLowerCase()
  )
}

module.exports = {
  DEFAULT_TITLE_PATTERNS,
  REVIEWED_BOTS,
  isReviewedBotPr,
  parseExcludeConfig,
  checkTitleExclusion,
}
