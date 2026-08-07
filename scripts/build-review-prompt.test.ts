import * as fs from "fs"
import {
  assemblePrompt,
  buildPrompt,
  DEFAULT_PROMPT,
  HOW_TO_WRITE,
  loadPersonalStyle,
  loadRepoConfig,
  PROMPT_CLOSING,
  PROMPT_HEADER,
  parsePersonalStyle,
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
    delete process.env.PR_AUTHOR
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

  it("applies the PR author's personal style when PR_AUTHOR is set", () => {
    process.env.PR_AUTHOR = "Amonkhouse"
    mockFs.existsSync.mockImplementation(
      p => typeof p === "string" && p.endsWith("amonkhouse.md")
    )
    mockFs.readFileSync.mockImplementation(p => {
      if (typeof p === "string" && p.endsWith("amonkhouse.md")) {
        return "Be blunt and terse."
      }
      throw new Error(`unexpected read: ${String(p)}`)
    })

    const result = buildPrompt()

    expect(result).toContain("## Reviewer Style Preferences (amonkhouse)")
    expect(result).toContain("Be blunt and terse.")
    expect(result).toContain("### Summary") // default prompt structure retained
  })

  it("ignores personal style when no PR_AUTHOR is set", () => {
    mockFs.existsSync.mockReturnValue(false)

    const result = buildPrompt()

    expect(result).not.toContain("Reviewer Style Preferences")
    expect(result).toBe(DEFAULT_PROMPT)
  })

  it("repo-level prompt override still beats a personal style", () => {
    process.env.PR_AUTHOR = "amonkhouse"
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockImplementation(p => {
      if (typeof p === "string" && p.endsWith(".claude-review.yml")) {
        return `
prompt: |
  You are a custom security reviewer.
`
      }
      return "Be blunt and terse."
    })

    const result = buildPrompt()

    expect(result).toContain("You are a custom security reviewer.")
    expect(result).not.toContain("Reviewer Style Preferences")
  })
})

describe("parsePersonalStyle", () => {
  it("defaults to augment mode with no frontmatter", () => {
    const result = parsePersonalStyle("amonkhouse", "Be blunt and terse.")

    expect(result).toEqual({
      login: "amonkhouse",
      mode: "augment",
      content: "Be blunt and terse.",
    })
  })

  it("reads mode from frontmatter", () => {
    const result = parsePersonalStyle(
      "amonkhouse",
      "---\nmode: replace_style\n---\nBe blunt and terse.\n"
    )

    expect(result.mode).toBe("replace_style")
    expect(result.content).toBe("Be blunt and terse.")
  })

  it("falls back to augment and warns on an unknown mode", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation()

    const result = parsePersonalStyle(
      "amonkhouse",
      "---\nmode: nonsense\n---\nBe blunt and terse.\n"
    )

    expect(result.mode).toBe("augment")
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown mode")
    )
    consoleSpy.mockRestore()
  })

  it("falls back to augment and warns on malformed frontmatter", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation()

    const result = parsePersonalStyle(
      "amonkhouse",
      "---\nmode: [unterminated\n---\nBe blunt and terse.\n"
    )

    expect(result.mode).toBe("augment")
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("supports override mode", () => {
    const result = parsePersonalStyle(
      "amonkhouse",
      "---\nmode: override\n---\nYou are a custom reviewer.\n"
    )

    expect(result.mode).toBe("override")
    expect(result.content).toBe("You are a custom reviewer.")
  })
})

describe("loadPersonalStyle", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns null when no author is given", () => {
    expect(loadPersonalStyle(undefined)).toBeNull()
  })

  it("returns null when no style file exists for the author", () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(loadPersonalStyle("amonkhouse")).toBeNull()
  })

  it("lowercases the login when resolving the file path", () => {
    mockFs.existsSync.mockImplementation(
      p => typeof p === "string" && p.endsWith("review-styles/amonkhouse.md")
    )
    mockFs.readFileSync.mockReturnValue("Be blunt and terse.")

    const result = loadPersonalStyle("AmonKHouse")

    expect(result?.login).toBe("amonkhouse")
    expect(result?.content).toBe("Be blunt and terse.")
  })

  it("returns null and logs a warning on read error", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation()
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("Read error")
    })

    const result = loadPersonalStyle("amonkhouse")

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read review-styles/amonkhouse.md")
    )
    consoleSpy.mockRestore()
  })
})

describe("assemblePrompt", () => {
  it("returns the default prompt when there is no repo config or personal style", () => {
    expect(assemblePrompt(null, null)).toBe(DEFAULT_PROMPT)
  })

  it("augment mode keeps the default prompt and appends a style section", () => {
    const result = assemblePrompt(null, {
      login: "amonkhouse",
      mode: "augment",
      content: "Be blunt and terse.",
    })

    expect(result).toContain(DEFAULT_PROMPT)
    expect(result).toContain("## Reviewer Style Preferences (amonkhouse)")
    expect(result).toContain("Be blunt and terse.")
    expect(result).toContain("prefer these")
  })

  it("replace_style mode keeps guardrails and format but swaps the tone block", () => {
    const result = assemblePrompt(null, {
      login: "amonkhouse",
      mode: "replace_style",
      content: "Be blunt and terse.",
    })

    expect(result).toContain(PROMPT_HEADER)
    expect(result).toContain(PROMPT_CLOSING)
    expect(result).toContain("## How to write\nBe blunt and terse.")
    expect(result).not.toContain(HOW_TO_WRITE)
    expect(result).not.toContain("Reviewer Style Preferences")
  })

  it("override mode returns only the personal content", () => {
    const result = assemblePrompt(
      { focus_areas: ["Watch for N+1 queries"] },
      {
        login: "amonkhouse",
        mode: "override",
        content: "You are a custom reviewer.",
      }
    )

    expect(result).toBe("You are a custom reviewer.")
  })

  it("augment mode still applies repo focus areas and ignore paths", () => {
    const result = assemblePrompt(
      {
        focus_areas: ["Watch for N+1 queries"],
        ignore_paths: ["**/*.generated.ts"],
      },
      { login: "amonkhouse", mode: "augment", content: "Be blunt and terse." }
    )

    expect(result).toContain("## Additional Focus Areas")
    expect(result).toContain("- Watch for N+1 queries")
    expect(result).toContain("## Files to Skip")
    expect(result).toContain("- **/*.generated.ts")
    expect(result).toContain("## Reviewer Style Preferences (amonkhouse)")
    // Style preferences should come after repo customizations
    expect(result.indexOf("## Files to Skip")).toBeLessThan(
      result.indexOf("## Reviewer Style Preferences")
    )
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
