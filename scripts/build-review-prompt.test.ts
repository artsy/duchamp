import * as fs from "fs"
import {
  buildFinderPrompt,
  buildPrompt,
  DEFAULT_PROMPT,
  FINDER_PROMPT,
  loadRepoConfig,
  pass1FindingsPath,
} from "./build-review-prompt"

jest.mock("fs")

const mockFs = fs as jest.Mocked<typeof fs>

describe("loadRepoConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns null when config file does not exist", () => {
    mockFs.existsSync.mockReturnValue(false)

    const result = loadRepoConfig()

    expect(result).toBeNull()
  })

  it("parses config when file exists", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
focus_areas:
  - "Watch for N+1 queries"
  - "Check authentication"
`)

    const result = loadRepoConfig()

    expect(result?.focus_areas).toEqual([
      "Watch for N+1 queries",
      "Check authentication",
    ])
  })

  it("parses ignore_paths array", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
ignore_paths:
  - "**/*.generated.ts"
  - "**/migrations/**"
`)

    const result = loadRepoConfig()

    expect(result?.ignore_paths).toEqual([
      "**/*.generated.ts",
      "**/migrations/**",
    ])
  })

  it("parses multiline context", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
context: |
  This is a Ruby on Rails API.
  We use GraphQL with graphql-ruby.
`)

    const result = loadRepoConfig()

    expect(result?.context).toBe(
      "This is a Ruby on Rails API.\nWe use GraphQL with graphql-ruby.\n"
    )
  })

  it("parses multiline prompt for complete override", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
prompt: |
  You are a custom reviewer.
  Focus only on security.
`)

    const result = loadRepoConfig()

    expect(result?.prompt).toBe(
      "You are a custom reviewer.\nFocus only on security.\n"
    )
  })

  it("returns null and logs warning on parse error", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation()
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockImplementation(() => {
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

  it("returns default prompt when no config exists", () => {
    mockFs.existsSync.mockReturnValue(false)

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
  })

  it("uses custom prompt when provided", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
prompt: |
  You are a custom security reviewer.
  Only look for security issues.
`)

    const result = buildPrompt()

    expect(result).toContain("You are a custom security reviewer.")
    expect(result).toContain("Only look for security issues.")
    expect(result).not.toContain("### Summary")
  })

  it("includes repo context when configured", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
context: |
  This is a Rails API.
`)

    const result = buildPrompt()

    expect(result).toContain("## Repository Context")
    expect(result).toContain("This is a Rails API.")
  })

  it("includes focus areas when configured", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
focus_areas:
  - "Watch for N+1 queries"
  - "Check authentication"
`)

    const result = buildPrompt()

    expect(result).toContain("## Additional Focus Areas")
    expect(result).toContain("- Watch for N+1 queries")
    expect(result).toContain("- Check authentication")
  })

  it("includes ignore paths when configured", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
ignore_paths:
  - "**/*.generated.ts"
`)

    const result = buildPrompt()

    expect(result).toContain("## Files to Skip")
    expect(result).toContain("- **/*.generated.ts")
  })
})

describe("buildPrompt with pass1Findings", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFs.existsSync.mockReturnValue(false)
  })

  it("omits the pass-1 section when no findings are passed", () => {
    const result = buildPrompt()

    expect(result).not.toContain("Pass 1 Candidate Findings")
  })

  it("omits the pass-1 section when findings are empty or whitespace-only", () => {
    expect(buildPrompt("")).not.toContain("Pass 1 Candidate Findings")
    expect(buildPrompt("   \n  ")).not.toContain("Pass 1 Candidate Findings")
  })

  it("omits the pass-1 section when pass 1 reported NONE", () => {
    expect(buildPrompt("NONE")).not.toContain("Pass 1 Candidate Findings")
    // FINDER_PROMPT tells the model to output this verbatim - tolerate surrounding whitespace
    expect(buildPrompt("  NONE  \n")).not.toContain("Pass 1 Candidate Findings")
  })

  it("prepends pass-1 findings ahead of the default prompt", () => {
    const result = buildPrompt(
      "[confidence: high] [severity: minor] foo.ts:12 does not handle null"
    )

    expect(result).toContain("Pass 1 Candidate Findings")
    expect(result).toContain(
      "[confidence: high] [severity: minor] foo.ts:12 does not handle null"
    )
    expect(result).toContain("senior staff engineer")
    // findings section comes before the review prompt itself
    expect(result.indexOf("Pass 1 Candidate Findings")).toBeLessThan(
      result.indexOf("senior staff engineer")
    )
  })

  it("still prepends pass-1 findings when a custom prompt is configured", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
prompt: |
  You are a custom security reviewer.
`)

    const result = buildPrompt("[confidence: med] [severity: nit] some finding")

    expect(result).toContain("Pass 1 Candidate Findings")
    expect(result).toContain("some finding")
    expect(result).toContain("You are a custom security reviewer.")
  })
})

describe("buildFinderPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns the finder prompt when no config exists", () => {
    mockFs.existsSync.mockReturnValue(false)

    const result = buildFinderPrompt()

    expect(result).toContain("PASS 1")
    expect(result).toContain("NONE")
    expect(result).toContain(pass1FindingsPath())
  })

  it("does not include the filter pass's review format", () => {
    mockFs.existsSync.mockReturnValue(false)

    const result = buildFinderPrompt()

    expect(result).not.toContain("### Summary")
    expect(result).not.toContain("🔴 **Blocking**")
  })

  it("still applies repo focus areas and ignore paths", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
focus_areas:
  - "Watch for N+1 queries"
ignore_paths:
  - "**/*.generated.ts"
`)

    const result = buildFinderPrompt()

    expect(result).toContain("## Additional Focus Areas")
    expect(result).toContain("- Watch for N+1 queries")
    expect(result).toContain("## Files to Skip")
    expect(result).toContain("- **/*.generated.ts")
  })

  it("does not honor a full custom prompt override (finder is always generic)", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`
prompt: |
  You are a custom security reviewer.
`)

    const result = buildFinderPrompt()

    expect(result).toContain("PASS 1")
    expect(result).not.toContain("You are a custom security reviewer.")
  })
})

describe("FINDER_PROMPT", () => {
  it("instructs no-posting behavior, without overclaiming read-only", () => {
    expect(FINDER_PROMPT).toContain("Do not post anything to GitHub")
    expect(FINDER_PROMPT).toContain("cannot comment on the PR")
    expect(FINDER_PROMPT).toContain("Do not modify any files")
  })

  it("tells the model where to write its findings", () => {
    expect(FINDER_PROMPT).toContain(pass1FindingsPath())
    expect(FINDER_PROMPT).toContain("Write tool")
  })
})

describe("pass1FindingsPath", () => {
  const originalRunnerTemp = process.env.RUNNER_TEMP

  afterEach(() => {
    if (originalRunnerTemp === undefined) {
      delete process.env.RUNNER_TEMP
    } else {
      process.env.RUNNER_TEMP = originalRunnerTemp
    }
  })

  it("uses RUNNER_TEMP when set", () => {
    process.env.RUNNER_TEMP = "/runner/temp"

    expect(pass1FindingsPath()).toBe("/runner/temp/pass1-findings.md")
  })

  it("falls back to /tmp when RUNNER_TEMP is unset", () => {
    delete process.env.RUNNER_TEMP

    expect(pass1FindingsPath()).toBe("/tmp/pass1-findings.md")
  })
})

describe("DEFAULT_PROMPT", () => {
  it("contains expected structure", () => {
    expect(DEFAULT_PROMPT).toContain("senior staff engineer")
    expect(DEFAULT_PROMPT).toContain("### Summary")
    expect(DEFAULT_PROMPT).toContain("### Issues Found")
    expect(DEFAULT_PROMPT).toContain("### Areas Reviewed")
    expect(DEFAULT_PROMPT).toContain("### Questions for Author")
  })
})
