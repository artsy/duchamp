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

module.exports = {
  DEFAULT_TITLE_PATTERNS,
  parseExcludeConfig,
  checkTitleExclusion,
}
