const {
  DEFAULT_TITLE_PATTERNS,
  parseExcludeConfig,
  checkTitleExclusion,
} = require("./check-pr-exclusions")

describe("parseExcludeConfig", () => {
  it("returns null for null input", () => {
    expect(parseExcludeConfig(null)).toBeNull()
  })

  it("returns null for empty config", () => {
    expect(parseExcludeConfig("")).toBeNull()
  })

  it("returns null for config without exclude section", () => {
    const config = `
focus_areas:
  - "Watch for N+1 queries"
`
    expect(parseExcludeConfig(config)).toBeNull()
  })

  it("parses title_patterns with double quotes", () => {
    const config = `
exclude:
  title_patterns:
    - "eigen query map"
    - "schema sync"
`
    const result = parseExcludeConfig(config)
    expect(result.title_patterns).toEqual(["eigen query map", "schema sync"])
  })

  it("parses title_patterns with single quotes", () => {
    const config = `
exclude:
  title_patterns:
    - 'eigen query map'
`
    const result = parseExcludeConfig(config)
    expect(result.title_patterns).toEqual(["eigen query map"])
  })

  it("parses title_patterns without quotes", () => {
    const config = `
exclude:
  title_patterns:
    - eigen query map
`
    const result = parseExcludeConfig(config)
    expect(result.title_patterns).toEqual(["eigen query map"])
  })

  it("parses disable_defaults: true", () => {
    const config = `
exclude:
  disable_defaults: true
  title_patterns:
    - "custom pattern"
`
    const result = parseExcludeConfig(config)
    expect(result.disable_defaults).toBe(true)
  })

  it("has undefined disable_defaults when not specified", () => {
    const config = `
exclude:
  title_patterns:
    - "pattern"
`
    const result = parseExcludeConfig(config)
    expect(result.disable_defaults).toBeUndefined()
  })
})

describe("checkTitleExclusion", () => {
  describe("default patterns", () => {
    it('excludes PRs titled exactly "Deploy"', () => {
      const result = checkTitleExclusion("Deploy", null)
      expect(result.excluded).toBe(true)
      expect(result.reason).toContain("Deploy")
    })

    it('does not exclude PRs with "Deploy" as part of a longer title', () => {
      const result = checkTitleExclusion("Deploy feature X", null)
      expect(result.excluded).toBe(false)
    })

    it('excludes PRs containing "graphql schema"', () => {
      const result = checkTitleExclusion(
        "Update graphql schema from staging",
        null
      )
      expect(result.excluded).toBe(true)
      expect(result.reason).toContain("graphql schema")
    })

    it("is case-insensitive", () => {
      const result = checkTitleExclusion("GRAPHQL SCHEMA update", null)
      expect(result.excluded).toBe(true)
    })

    it("does not exclude regular PR titles", () => {
      const result = checkTitleExclusion("feat: add user authentication", null)
      expect(result.excluded).toBe(false)
    })
  })

  describe("custom patterns", () => {
    const configWithPattern = `
exclude:
  title_patterns:
    - "eigen query map"
`

    it("excludes PRs matching custom patterns", () => {
      const result = checkTitleExclusion(
        "chore: update eigen query map",
        configWithPattern
      )
      expect(result.excluded).toBe(true)
      expect(result.reason).toContain("eigen query map")
    })

    it("still applies default patterns when not disabled", () => {
      const result = checkTitleExclusion("Deploy", configWithPattern)
      expect(result.excluded).toBe(true)
      expect(result.reason).toContain("Deploy")
    })

    it("does not apply default patterns when disable_defaults is true", () => {
      const config = `
exclude:
  disable_defaults: true
  title_patterns:
    - "custom only"
`
      const result = checkTitleExclusion("Deploy", config)
      expect(result.excluded).toBe(false)
    })

    it("handles invalid regex patterns gracefully", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()
      const config = `
exclude:
  title_patterns:
    - "[invalid regex"
`
      const result = checkTitleExclusion("Some PR title", config)
      expect(result.excluded).toBe(false)
      consoleSpy.mockRestore()
    })
  })
})

describe("DEFAULT_TITLE_PATTERNS", () => {
  it("includes Deploy pattern", () => {
    expect(DEFAULT_TITLE_PATTERNS).toContain("^Deploy$")
  })

  it("includes graphql schema pattern", () => {
    expect(DEFAULT_TITLE_PATTERNS).toContain("graphql schema")
  })
})
