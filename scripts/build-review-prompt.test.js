const fs = require("fs")
const {
  buildPrompt,
  parseYaml,
  loadRepoConfig,
  DEFAULT_PROMPT,
} = require("./build-review-prompt")

jest.mock("fs")

describe("parseYaml", () => {
  it("should parse focus_areas array", () => {
    const yaml = `focus_areas:
  - "Watch for N+1 queries"
  - "Check authentication"`

    const result = parseYaml(yaml)

    expect(result.focus_areas).toEqual([
      "Watch for N+1 queries",
      "Check authentication",
    ])
  })

  it("should parse ignore_paths array", () => {
    const yaml = `ignore_paths:
  - "**/*.generated.ts"
  - "**/migrations/**"`

    const result = parseYaml(yaml)

    expect(result.ignore_paths).toEqual([
      "**/*.generated.ts",
      "**/migrations/**",
    ])
  })

  it("should parse multiline context", () => {
    const yaml = `context: |
  This is a Ruby on Rails API.
  We use GraphQL with graphql-ruby.`

    const result = parseYaml(yaml)

    expect(result.context).toBe(
      "This is a Ruby on Rails API.\nWe use GraphQL with graphql-ruby."
    )
  })

  it("should parse multiline prompt for complete override", () => {
    const yaml = `prompt: |
  You are a custom reviewer.
  Focus only on security.`

    const result = parseYaml(yaml)

    expect(result.prompt).toBe(
      "You are a custom reviewer.\nFocus only on security."
    )
  })

  it("should parse complete config", () => {
    const yaml = `focus_areas:
  - "Watch for N+1 queries"
  - "Check authentication"

ignore_paths:
  - "**/*.generated.ts"

context: |
  This is a Rails API.`

    const result = parseYaml(yaml)

    expect(result.focus_areas).toEqual([
      "Watch for N+1 queries",
      "Check authentication",
    ])
    expect(result.ignore_paths).toEqual(["**/*.generated.ts"])
    expect(result.context).toBe("This is a Rails API.")
  })

  it("should handle single-quoted strings", () => {
    const yaml = `focus_areas:
  - 'Single quoted string'`

    const result = parseYaml(yaml)

    expect(result.focus_areas).toEqual(["Single quoted string"])
  })

  it("should handle unquoted strings", () => {
    const yaml = `focus_areas:
  - Unquoted string here`

    const result = parseYaml(yaml)

    expect(result.focus_areas).toEqual(["Unquoted string here"])
  })
})

describe("loadRepoConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("should return null when config file does not exist", () => {
    fs.existsSync.mockReturnValue(false)

    const result = loadRepoConfig()

    expect(result).toBeNull()
  })

  it("should parse config when file exists", () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(`focus_areas:
  - "Test focus area"`)

    const result = loadRepoConfig()

    expect(result.focus_areas).toEqual(["Test focus area"])
  })

  it("should return null and log warning on parse error", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation()
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockImplementation(() => {
      throw new Error("Read error")
    })

    const result = loadRepoConfig()

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse .claude-review.yml")
    )
    consoleSpy.mockRestore()
  })
})

describe("buildPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("should return default prompt when no config exists", () => {
    fs.existsSync.mockReturnValue(false)

    const result = buildPrompt()

    expect(result).toContain("senior staff engineer")
    expect(result).toContain("### Summary")
    expect(result).toContain("### Issues Found")
    expect(result).toContain("🔴 **Blocking**")
    expect(result).toContain("🟡 **Important**")
    expect(result).toContain("🟢 **Suggestion**")
    expect(result).toContain("### Areas Reviewed")
    expect(result).toContain("Architecture & Design")
    expect(result).toContain("Security")
    expect(result).toContain("Performance")
    expect(result).toContain("### Verdict")
  })

  it("should use custom prompt when provided", () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(`prompt: |
  You are a custom security reviewer.
  Only look for security issues.`)

    const result = buildPrompt()

    expect(result).toBe(
      "You are a custom security reviewer.\nOnly look for security issues."
    )
    expect(result).not.toContain("### Summary")
  })

  it("should include repo context when configured", () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(`context: |
  This is a Rails API.`)

    const result = buildPrompt()

    expect(result).toContain("## Repository Context")
    expect(result).toContain("This is a Rails API.")
  })

  it("should include focus areas when configured", () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(`focus_areas:
  - "Watch for N+1 queries"
  - "Check authentication"`)

    const result = buildPrompt()

    expect(result).toContain("## Additional Focus Areas")
    expect(result).toContain("Watch for N+1 queries")
    expect(result).toContain("Check authentication")
  })

  it("should include ignore paths when configured", () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(`ignore_paths:
  - "**/*.generated.ts"`)

    const result = buildPrompt()

    expect(result).toContain("## Files to Skip")
    expect(result).toContain("**/*.generated.ts")
  })
})

describe("DEFAULT_PROMPT", () => {
  it("should be exported and contain expected structure", () => {
    expect(DEFAULT_PROMPT).toContain("senior staff engineer")
    expect(DEFAULT_PROMPT).toContain("### Summary")
    expect(DEFAULT_PROMPT).toContain("### Issues Found")
    expect(DEFAULT_PROMPT).toContain("### Areas Reviewed")
    expect(DEFAULT_PROMPT).toContain("### Questions for Author")
    expect(DEFAULT_PROMPT).toContain("### Verdict")
  })
})
