import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import {
  buildPrompt,
  EXPERIMENT_LABEL,
  loadParticipants,
  loadRepoConfig,
  loadReviewPrompt,
  parseLabels,
  REVIEW_EFFORT,
  resolveModelArgs,
  resolveRelatedRepos,
  usesRelatedRepos,
} from "./build-review-prompt"

jest.mock("fs")
jest.mock("child_process")

const mockFs = fs as jest.Mocked<typeof fs>

const REVIEW_PROMPT = "You are a senior engineer reviewing a pull request."

/** Mock fs so only the named files exist, each returning its content. */
const mockFiles = (files: Record<string, string>): void => {
  mockFs.existsSync.mockImplementation(
    p => typeof p === "string" && path.basename(p) in files
  )
  mockFs.readFileSync.mockImplementation(p => {
    const match = Object.keys(files).find(
      f => typeof p === "string" && path.basename(p) === f
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
  })

  it("returns the review prompt when no config exists", () => {
    mockFiles({ "prompt.md": REVIEW_PROMPT })

    expect(buildPrompt()).toBe(REVIEW_PROMPT)
  })

  it("uses the repo's custom prompt instead of the review prompt", () => {
    mockFiles({
      "prompt.md": REVIEW_PROMPT,
      ".claude-review.yml":
        "prompt: |\n  You are a custom security reviewer.\n  Only look for security issues.\n",
    })

    const result = buildPrompt()

    expect(result).toContain("You are a custom security reviewer.")
    expect(result).toContain("Only look for security issues.")
    expect(result).not.toContain(REVIEW_PROMPT)
  })

  it("includes repo context when configured", () => {
    mockFiles({
      "prompt.md": REVIEW_PROMPT,
      ".claude-review.yml": "context: |\n  This is a Rails API.\n",
    })

    const result = buildPrompt()

    expect(result).toContain(REVIEW_PROMPT)
    expect(result).toContain("## Repository Context")
    expect(result).toContain("This is a Rails API.")
  })

  it("includes focus areas when configured", () => {
    mockFiles({
      "prompt.md": REVIEW_PROMPT,
      ".claude-review.yml":
        'focus_areas:\n  - "Watch for N+1 queries"\n  - "Check authentication"\n',
    })

    const result = buildPrompt()

    expect(result).toContain("## Additional Focus Areas")
    expect(result).toContain("- Watch for N+1 queries")
    expect(result).toContain("- Check authentication")
  })

  it("includes ignore paths when configured", () => {
    mockFiles({
      "prompt.md": REVIEW_PROMPT,
      ".claude-review.yml": 'ignore_paths:\n  - "**/*.generated.ts"\n',
    })

    const result = buildPrompt()

    expect(result).toContain("## Files to Skip")
    expect(result).toContain("- **/*.generated.ts")
  })

  it("throws when the review prompt is missing", () => {
    mockFiles({})

    expect(() => buildPrompt()).toThrow("ENOENT")
  })
})

describe("resolveModelArgs", () => {
  it("passes the model with high effort", () => {
    expect(REVIEW_EFFORT).toBe("high")
    expect(resolveModelArgs("claude-opus-5-5")).toBe(
      "--model claude-opus-5-5 --effort high"
    )
  })
})

describe("usesRelatedRepos", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("is true for an enrolled author, case-insensitively", () => {
    mockFiles({ "participants.yml": "participants:\n  - MounirDhahri\n" })

    expect(usesRelatedRepos("mounirdhahri", [])).toBe(true)
  })

  it("is true for a labelled PR without reading participants", () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(usesRelatedRepos("someone-else", [EXPERIMENT_LABEL])).toBe(true)
    expect(mockFs.existsSync).not.toHaveBeenCalled()
  })

  it("is false for an author outside the experiment", () => {
    mockFiles({ "participants.yml": "participants:\n  - MounirDhahri\n" })

    expect(usesRelatedRepos("someone-else", ["in-progress"])).toBe(false)
  })

  it("is false with no author and no label", () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(usesRelatedRepos(undefined, [])).toBe(false)
  })
})

describe("resolveRelatedRepos", () => {
  const config = 'related_repos:\n  - "artsy/metaphysics"\n'
  const mockGit = execFileSync as jest.Mock

  /** Answer `git show` with the default branch config and `git clone` with success. */
  const mockBaseConfig = (
    baseConfig: string | null,
    clone: (args: string[]) => void = () => {}
  ): void => {
    mockGit.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "show") {
        if (baseConfig === null) {
          throw new Error("fatal: path does not exist")
        }
        return baseConfig
      }
      clone(args)
      return ""
    })
  }

  const cloneCalls = (): string[][] =>
    mockGit.mock.calls
      .map(([, args]) => args as string[])
      .filter(args => args[0] !== "show")

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, "log").mockImplementation()
    process.env.GITHUB_REPOSITORY = "artsy/eigen"
    process.env.RUNNER_TEMP = "/runner/tmp"
    process.env.DEFAULT_BRANCH = "main"
    delete process.env.RELATED_REPOS_TOKEN
  })

  afterEach(() => {
    jest.restoreAllMocks()
    mockGit.mockReset()
    delete process.env.GITHUB_REPOSITORY
    delete process.env.RUNNER_TEMP
    delete process.env.DEFAULT_BRANCH
    delete process.env.BASE_REF
  })

  it("clones the related repos the default branch lists", () => {
    mockBaseConfig(config)

    expect(resolveRelatedRepos(true)).toEqual([
      {
        repo: "artsy/metaphysics",
        path: "/runner/tmp/related/metaphysics",
        private: false,
      },
    ])
    expect(mockGit).toHaveBeenCalledWith(
      "git",
      ["show", "origin/main:.claude-review.yml"],
      expect.anything()
    )
    expect(cloneCalls()).toHaveLength(1)
  })

  it("ignores related repos that only the PR head lists", () => {
    mockFiles({
      ".claude-review.yml": 'related_repos:\n  - "artsy/gravity"\n',
    })
    mockBaseConfig("context: Rails\n")

    expect(resolveRelatedRepos(true)).toEqual([])
    expect(cloneCalls()).toHaveLength(0)
  })

  it("does nothing when the default branch has no config", () => {
    mockBaseConfig(null)

    expect(resolveRelatedRepos(true)).toEqual([])
    expect(cloneCalls()).toHaveLength(0)
  })

  it("reads the default branch even when the PR targets another branch", () => {
    process.env.BASE_REF = "foo"
    mockBaseConfig(config)

    resolveRelatedRepos(true)

    expect(mockGit).toHaveBeenCalledWith(
      "git",
      ["show", "origin/main:.claude-review.yml"],
      expect.anything()
    )
    expect(mockGit).not.toHaveBeenCalledWith(
      "git",
      ["show", "origin/foo:.claude-review.yml"],
      expect.anything()
    )
  })

  it("does nothing without a default branch", () => {
    delete process.env.DEFAULT_BRANCH
    mockBaseConfig(config)

    expect(resolveRelatedRepos(true)).toEqual([])
    expect(mockGit).not.toHaveBeenCalled()
  })

  it("skips them outside the experiment", () => {
    mockBaseConfig(config)

    expect(resolveRelatedRepos(false)).toEqual([])
    expect(cloneCalls()).toHaveLength(0)
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring related_repos")
    )
  })

  it("passes the token on so a private repo can be cloned", () => {
    process.env.RELATED_REPOS_TOKEN = "secret-token"
    mockBaseConfig(config, args => {
      if (args[0] === "clone") {
        throw new Error("could not read Username")
      }
    })

    expect(resolveRelatedRepos(true)).toEqual([
      {
        repo: "artsy/metaphysics",
        path: "/runner/tmp/related/metaphysics",
        private: true,
      },
    ])
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
    mockFiles({
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
    mockFiles({ "participants.yml": "participants: [unterminated\n" })

    expect(loadParticipants()).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse participants.yml")
    )
    consoleSpy.mockRestore()
  })
})

describe("loadReviewPrompt", () => {
  it("reads the real review prompt", () => {
    const actualFs = jest.requireActual<typeof fs>("fs")
    mockFs.readFileSync.mockImplementation(actualFs.readFileSync)

    const prompt = loadReviewPrompt()

    expect(prompt).toContain("## Verify Before You Claim")
    expect(prompt).toContain("🔴 **blocking:**")
    expect(prompt).toContain("### Verdict")
  })
})
