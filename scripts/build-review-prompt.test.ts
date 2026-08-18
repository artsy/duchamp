import * as fs from "fs"
import {
  buildPrompt,
  DEFAULT_PROMPT,
  EXPERIMENT_LABEL,
  isExperimentPR,
  loadParticipants,
  loadRepoConfig,
  parseLabels,
  resolveBasePrompt,
} from "./build-review-prompt"

jest.mock("fs")

const mockFs = fs as jest.Mocked<typeof fs>

const EXPERIMENT_PROMPT = "You are a senior engineer reviewing a pull request."

/** Mock fs so only the named experiment files exist, each returning its content. */
const mockExperimentFiles = (files: Record<string, string>): void => {
  mockFs.existsSync.mockImplementation(
    p => typeof p === "string" && Object.keys(files).some(f => p.endsWith(f))
  )
  mockFs.readFileSync.mockImplementation(p => {
    const match = Object.keys(files).find(
      f => typeof p === "string" && p.endsWith(f)
    )
    if (!match) {
      throw new Error(`ENOENT: ${String(p)}`)
    }
    return files[match]
  })
}

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
    delete process.env.PR_LABELS
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

  it("uses the experiment prompt for an enrolled author", () => {
    process.env.PR_AUTHOR = "MounirDhahri"
    mockExperimentFiles({
      "participants.yml": "participants:\n  - MounirDhahri\n",
      "prompt.md": EXPERIMENT_PROMPT,
    })

    const result = buildPrompt()

    expect(result).toContain(EXPERIMENT_PROMPT)
    expect(result).not.toContain("senior staff engineer")
  })

  it("uses the experiment prompt for a labelled PR by any author", () => {
    process.env.PR_AUTHOR = "someone-else"
    process.env.PR_LABELS = JSON.stringify([EXPERIMENT_LABEL])
    mockExperimentFiles({
      "participants.yml": "participants: []\n",
      "prompt.md": EXPERIMENT_PROMPT,
    })

    const result = buildPrompt()

    expect(result).toContain(EXPERIMENT_PROMPT)
  })

  it("uses the default prompt for an author outside the experiment", () => {
    process.env.PR_AUTHOR = "someone-else"
    mockExperimentFiles({
      "participants.yml": "participants:\n  - MounirDhahri\n",
      "prompt.md": EXPERIMENT_PROMPT,
    })

    const result = buildPrompt()

    expect(result).toBe(DEFAULT_PROMPT)
  })

  it("lets a repo prompt override beat the experiment prompt", () => {
    process.env.PR_AUTHOR = "MounirDhahri"
    mockExperimentFiles({
      ".claude-review.yml":
        "prompt: |\n  You are a custom security reviewer.\n",
      "participants.yml": "participants:\n  - MounirDhahri\n",
      "prompt.md": EXPERIMENT_PROMPT,
    })

    const result = buildPrompt()

    expect(result).toContain("You are a custom security reviewer.")
    expect(result).not.toContain(EXPERIMENT_PROMPT)
  })

  it("still applies repo focus areas and ignore paths in the experiment", () => {
    process.env.PR_AUTHOR = "MounirDhahri"
    mockExperimentFiles({
      ".claude-review.yml":
        'focus_areas:\n  - "Watch for N+1 queries"\nignore_paths:\n  - "**/*.generated.ts"\n',
      "participants.yml": "participants:\n  - MounirDhahri\n",
      "prompt.md": EXPERIMENT_PROMPT,
    })

    const result = buildPrompt()

    expect(result).toContain(EXPERIMENT_PROMPT)
    expect(result).toContain("- Watch for N+1 queries")
    expect(result).toContain("- **/*.generated.ts")
  })
})

describe("parseLabels", () => {
  it("returns an empty list when unset", () => {
    expect(parseLabels(undefined)).toEqual([])
    expect(parseLabels("")).toEqual([])
  })

  it("parses the JSON array the workflow passes", () => {
    expect(parseLabels('["in-progress","ai-review-experiment"]')).toEqual([
      "in-progress",
      "ai-review-experiment",
    ])
  })

  it("falls back to a comma-separated list", () => {
    expect(parseLabels("in-progress, ai-review-experiment")).toEqual([
      "in-progress",
      "ai-review-experiment",
    ])
  })
})

describe("loadParticipants", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns lowercased logins", () => {
    mockExperimentFiles({
      "participants.yml": "participants:\n  - MounirDhahri\n  - AmonKHouse\n",
    })

    expect(loadParticipants()).toEqual(["mounirdhahri", "amonkhouse"])
  })

  it("returns an empty list when the file is missing", () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(loadParticipants()).toEqual([])
  })

  it("warns and returns an empty list on malformed yaml", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation()
    mockExperimentFiles({ "participants.yml": "participants: [unterminated\n" })

    expect(loadParticipants()).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse participants.yml")
    )
    consoleSpy.mockRestore()
  })
})

describe("isExperimentPR", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("matches an enrolled login case-insensitively", () => {
    mockExperimentFiles({
      "participants.yml": "participants:\n  - MounirDhahri\n",
    })

    expect(isExperimentPR("mounirdhahri", [])).toBe(true)
  })

  it("matches the experiment label without reading participants", () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(isExperimentPR(undefined, [EXPERIMENT_LABEL])).toBe(true)
    expect(mockFs.existsSync).not.toHaveBeenCalled()
  })

  it("is false with no author and no label", () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(isExperimentPR(undefined, ["in-progress"])).toBe(false)
  })
})

describe("resolveBasePrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("falls back to the default prompt when prompt.md is unreadable", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation()
    mockExperimentFiles({
      "participants.yml": "participants:\n  - MounirDhahri\n",
    })

    expect(resolveBasePrompt("MounirDhahri", [])).toBe(DEFAULT_PROMPT)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read review-experiment/prompt.md")
    )
    consoleSpy.mockRestore()
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
