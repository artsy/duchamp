import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import {
  assemblePrompt,
  assessChanges,
  buildPrompt,
  EXPERIMENT_INLINE_SECTION,
  EXPERIMENT_LABEL,
  formatContextSection,
  formatDelivery,
  formatDiffSection,
  formatInstructionsSection,
  formatReviewModeOutputs,
  formatSecuritySection,
  inSecurityExperiment,
  LIGHT_EFFORT,
  LIGHT_MODEL,
  loadParticipants,
  loadRepoConfig,
  loadReviewPrompt,
  MAX_INSTRUCTIONS_BYTES,
  MAX_PROMPT_BYTES,
  parseLabels,
  REVIEW_EFFORT,
  resolveModelArgs,
  resolveRelatedRepos,
  reviewRange,
  SECURITY_LABEL,
  usesRelatedRepos,
} from "./build-review-prompt"
import { MAX_DIFF_BYTES } from "./review-diff"

jest.mock("fs")
jest.mock("child_process")

const mockFs = fs as jest.Mocked<typeof fs>

const REVIEW_PROMPT = "You are a senior engineer reviewing a pull request."

/** Mock fs so only the named files exist, each returning its content. */
const mockFiles = (
  files: Record<string, string>,
  symlinks: string[] = []
): void => {
  mockFs.existsSync.mockImplementation(
    p => typeof p === "string" && path.basename(p) in files
  )
  mockFs.lstatSync.mockImplementation(((p: string) =>
    path.basename(p) in files
      ? {
          isFile: () => !symlinks.includes(path.basename(p)),
          isSymbolicLink: () => symlinks.includes(path.basename(p)),
        }
      : undefined) as unknown as typeof fs.lstatSync)
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

  it("passes the light model and effort for a light review", () => {
    expect(resolveModelArgs("claude-opus-5-5", "light")).toBe(
      `--model ${LIGHT_MODEL} --effort ${LIGHT_EFFORT}`
    )
  })
})

describe("reviewRange", () => {
  it("is the whole PR on a full review", () => {
    expect(reviewRange("main", { mode: "full", reason: "" })).toBe(
      "origin/main...HEAD"
    )
  })

  it("is the changes since the earlier review on a re-review", () => {
    const sha = "a".repeat(40)
    expect(
      reviewRange("main", {
        mode: "rereview",
        reason: "",
        previous: { sha, body: "" },
      })
    ).toBe(`${sha}..HEAD`)
  })

  it("is undefined with no base branch", () => {
    expect(reviewRange(undefined, { mode: "full", reason: "" })).toBeUndefined()
  })
})

describe("assessChanges", () => {
  const mockGit = execFileSync as jest.Mock
  const range = "origin/main...HEAD"

  beforeEach(() => {
    mockGit.mockReset()
    mockGit.mockReturnValue("2\t1\tsrc/a.ts\n")
  })

  it("is standard outside the experiment, without reading the diff", () => {
    expect(
      assessChanges(
        { experiment: false, security: false },
        "claude-opus-5-5",
        range,
        []
      )
    ).toEqual({
      tier: "standard",
      reason: "not in the review or security experiment",
      sensitive: [],
    })
    expect(mockGit).not.toHaveBeenCalled()
  })

  it("classifies the range", () => {
    expect(
      assessChanges(
        { experiment: true, security: false },
        "claude-opus-5-5",
        range,
        []
      ).tier
    ).toBe("light")
    expect(mockGit.mock.calls[0][1]).toContain(range)
  })

  it("keeps a model the caller set, and still lists sensitive files", () => {
    mockGit.mockReturnValue("1\t0\t.github/workflows/ci.yml\n")
    expect(
      assessChanges(
        { experiment: true, security: false },
        "claude-fable-5-1",
        range,
        []
      )
    ).toEqual({
      tier: "standard",
      reason: "caller set model claude-fable-5-1",
      sensitive: [".github/workflows/ci.yml"],
    })
  })

  it("lists sensitive files for the security experiment alone, on the standard tier", () => {
    mockGit.mockReturnValue("1\t0\tsrc/auth.ts\n")
    expect(
      assessChanges(
        { experiment: false, security: true },
        "claude-opus-5-5",
        range,
        []
      )
    ).toEqual({
      tier: "standard",
      reason: "not in the review experiment",
      sensitive: ["src/auth.ts"],
    })
  })

  it("is standard when git fails", () => {
    mockGit.mockImplementation(() => {
      throw new Error("bad revision")
    })
    expect(
      assessChanges(
        { experiment: true, security: false },
        "claude-opus-5-5",
        range,
        []
      )
    ).toEqual({
      tier: "standard",
      reason: "could not read the diff: bad revision",
      sensitive: [],
    })
  })

  it("is standard with no range", () => {
    expect(
      assessChanges(
        { experiment: true, security: false },
        "claude-opus-5-5",
        undefined,
        []
      ).tier
    ).toBe("standard")
    expect(mockGit).not.toHaveBeenCalled()
  })
})

describe("inSecurityExperiment", () => {
  it("includes listed authors, in any case", () => {
    mockFiles({ "participants.yml": "participants:\n  - MounirDhahri\n" })
    expect(inSecurityExperiment("mounirdhahri", [])).toBe(true)
    expect(
      mockFs.readFileSync.mock.calls.map(([p]) => String(p))
    ).toContainEqual(
      expect.stringContaining(
        path.join("security-experiment", "participants.yml")
      )
    )
  })

  it("includes any PR with the label", () => {
    mockFiles({})
    expect(inSecurityExperiment("someone", ["Security-Review"])).toBe(true)
  })

  it("leaves out everyone else", () => {
    mockFiles({ "participants.yml": "participants:\n  - MounirDhahri\n" })
    expect(inSecurityExperiment("someone", ["bug"])).toBe(false)
    expect(inSecurityExperiment(undefined, [])).toBe(false)
  })
})

describe("formatSecuritySection", () => {
  const range = "origin/main...HEAD"

  it("is empty with no sensitive files and no label", () => {
    expect(formatSecuritySection([], false, range)).toBe("")
  })

  it("is empty with no range", () => {
    expect(formatSecuritySection(["src/auth.ts"], true, undefined)).toBe("")
  })

  it("lists the sensitive files and hands them to the subagent", () => {
    const section = formatSecuritySection(
      ["src/auth.ts", ".github/workflows/ci.yml"],
      false,
      range
    )
    expect(section).toContain("## Security Pass")
    expect(section).toContain("- `src/auth.ts`")
    expect(section).toContain("- `.github/workflows/ci.yml`")
    expect(section).toContain('`subagent_type: "security-reviewer"`')
    expect(section).toContain(`\`${range}\` and the files above`)
    expect(section).toContain("Verify Before You Claim")
  })

  it("covers every changed file when only the label asks for it", () => {
    const section = formatSecuritySection([], true, range)
    expect(section).toContain(`\`${SECURITY_LABEL}\` label`)
    expect(section).toContain("every changed file")
  })

  it("caps the file list", () => {
    const files = Array.from({ length: 35 }, (_, i) => `src/auth${i}.ts`)
    const section = formatSecuritySection(files, false, range)
    expect(section).toContain("`src/auth29.ts`")
    expect(section).not.toContain("`src/auth30.ts`")
    expect(section).toContain("- and 5 more")
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

describe("formatInstructionsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("is empty when the repo has neither file", () => {
    mockFiles({})

    expect(formatInstructionsSection()).toBe("")
  })

  it("inlines AGENTS.md", () => {
    mockFiles({ "AGENTS.md": "Use yarn." })

    const section = formatInstructionsSection()

    expect(section).toContain("## Repository Instructions")
    expect(section).toContain("```markdown\nUse yarn.\n```")
    expect(section).toContain("Do not read it again")
  })

  it("leaves out AGENTS.md when CLAUDE.md imports it, since the action loads both", () => {
    mockFiles({ "AGENTS.md": "Use yarn.", "CLAUDE.md": "@AGENTS.md" })

    expect(formatInstructionsSection()).toBe("")
  })

  it("never inlines CLAUDE.md, which the action loads itself", () => {
    mockFiles({ "CLAUDE.md": "Use npm." })

    expect(formatInstructionsSection()).toBe("")
  })

  it("leaves out AGENTS.md when CLAUDE.md is a symlink to it", () => {
    mockFiles({ "AGENTS.md": "Use yarn.", "CLAUDE.md": "" }, ["CLAUDE.md"])
    mockFs.readlinkSync.mockReturnValue("AGENTS.md")

    expect(formatInstructionsSection()).toBe("")
  })

  it("skips a symlinked AGENTS.md, which could point at the runner's environment", () => {
    mockFiles({ "AGENTS.md": "RELATED_REPOS_TOKEN=secret" }, ["AGENTS.md"])

    expect(formatInstructionsSection()).toBe("")
    expect(mockFs.readFileSync).not.toHaveBeenCalled()
  })

  it("uses a fence longer than any backtick run in the file", () => {
    mockFiles({ "AGENTS.md": "Example:\n```ts\nconst a = 1\n```" })

    expect(formatInstructionsSection()).toContain("````markdown\nExample:")
  })

  it("leaves a file over the cap for the reviewer to read", () => {
    mockFiles({ "AGENTS.md": "x".repeat(MAX_INSTRUCTIONS_BYTES + 1) })

    const section = formatInstructionsSection()

    expect(section).not.toContain("xxxx")
    expect(section).toContain("Read `AGENTS.md` in the repo root first")
  })
})

describe("formatDiffSection", () => {
  const mockGit = execFileSync as jest.Mock

  /** Answer `git diff` by its flags: --name-only lists left-out files. */
  const mockGitDiff = (answers: {
    diff?: string
    leftOut?: string
    numstat?: string
  }): void => {
    mockGit.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("--name-only")) return answers.leftOut ?? ""
      if (args.includes("--numstat")) return answers.numstat ?? ""
      return answers.diff ?? ""
    })
  }

  const gitCalls = (): string[][] =>
    mockGit.mock.calls.map(([, args]) => args as string[])

  beforeEach(() => {
    jest.clearAllMocks()
    mockGit.mockReset()
  })

  it("is empty without a base ref", () => {
    expect(formatDiffSection(undefined, [])).toBe("")
    expect(mockGit).not.toHaveBeenCalled()
  })

  it("inlines the diff and tells the reviewer not to fetch it again", () => {
    mockGitDiff({ diff: "diff --git a/x.ts b/x.ts\n+const x = 1\n" })

    const section = formatDiffSection("main", [])

    expect(section).toContain("```diff\ndiff --git a/x.ts b/x.ts")
    expect(section).toContain("Do not run git diff for it again")
    expect(section).not.toContain("left out")
    expect(gitCalls()[0].slice(0, 3)).toEqual([
      "diff",
      "origin/main...HEAD",
      "--",
    ])
  })

  it("leaves out lockfiles and the repo's ignore_paths", () => {
    mockGitDiff({})

    formatDiffSection("main", ["**/*.generated.ts", "vendor"])

    const args = gitCalls()[0]
    expect(args).toContain(":(exclude,glob)**/yarn.lock")
    expect(args).toContain(":(exclude,glob)**/*.generated.ts")
    expect(args).toContain(":(exclude,glob)**/vendor/**")
  })

  it("names the lockfiles and ignored files it left out", () => {
    mockGitDiff({ leftOut: "yarn.lock\n" })

    const section = formatDiffSection("main", [])

    expect(section).toContain("No changes outside lockfiles and ignored paths.")
    expect(section).toContain(
      "Also changed, but left out as lockfiles or ignored paths:\n\n```\nyarn.lock\n```"
    )
    const nameOnly = gitCalls().find(args => args.includes("--name-only"))
    expect(nameOnly).toContain(":(glob)**/yarn.lock")
  })

  it("lists the changed files when the diff is over the cap", () => {
    mockGitDiff({
      diff: "+".repeat(MAX_DIFF_BYTES + 1),
      numstat: "1\t1\tsrc/app/Scenes/Insights/Components/Foo.tsx\n",
    })

    const section = formatDiffSection("main", [])

    expect(section).toContain("too large to include")
    expect(section).toContain(
      "1\t1\tsrc/app/Scenes/Insights/Components/Foo.tsx"
    )
    expect(section).not.toContain("++++")
  })

  it("cuts the file list when it is over the cap too", () => {
    mockGitDiff({
      diff: "+".repeat(MAX_DIFF_BYTES + 1),
      numstat: Array(5_000)
        .fill("1\t1\tsome/long/path/to/a/file.ts")
        .join("\n"),
    })

    const section = formatDiffSection("main", [])

    expect(Buffer.byteLength(section)).toBeLessThan(MAX_DIFF_BYTES + 1_000)
    expect(section).toMatch(/\.\.\. \d+ more lines/)
  })

  it("asks the reviewer to run git diff when there is no room left", () => {
    expect(formatDiffSection("main", [], 0)).toContain(
      "Run `git diff origin/main...HEAD` to see the changes."
    )
    expect(mockGit).not.toHaveBeenCalled()
  })

  it("falls back to asking the reviewer to run git diff when git fails", () => {
    jest.spyOn(console, "error").mockImplementation()
    mockGit.mockImplementation(() => {
      throw new Error("fatal: bad revision")
    })

    expect(formatDiffSection("main", [])).toContain(
      "Run `git diff origin/main...HEAD` to see the changes."
    )
  })
})

describe("formatContextSection", () => {
  const mockGit = execFileSync as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockGit.mockReset()
  })

  it("replaces the workflow's read and diff steps with the inlined context", () => {
    mockFiles({ "AGENTS.md": "Use yarn." })
    mockGit.mockImplementation((_cmd: string, args: string[]) =>
      args.includes("--name-only") ? "" : "diff --git a/x.ts b/x.ts\n"
    )

    const { section } = formatContextSection("main", [])

    expect(section).toContain(
      "Skip the steps above to read AGENTS.md or CLAUDE.md and run `git diff`"
    )
    expect(section).toContain("read them all in one turn")
    expect(section).toContain("Use yarn.")
    expect(section).toContain("```diff\ndiff --git a/x.ts b/x.ts")
  })

  it("shrinks the diff to keep the whole prompt under the cap", () => {
    mockFiles({})
    mockGit.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("--name-only")) return ""
      if (args.includes("--numstat")) return "1\t1\tx.ts\n"
      return "+".repeat(30_000)
    })

    const { section } = formatContextSection(
      "main",
      [],
      MAX_PROMPT_BYTES - 20_000
    )

    expect(section).toContain("too large to include")
    expect(section).not.toContain("++++")
  })

  const REREVIEW = {
    mode: "rereview",
    reason: "",
    previous: { sha: "a".repeat(40), body: "## Code Review" },
  } as const

  it("builds on the earlier review for re-reviews", () => {
    mockFiles({})
    mockGit.mockReturnValue("diff --git a/x.ts b/x.ts\n")

    const { section, reviewMode } = formatContextSection(
      "main",
      [],
      0,
      REREVIEW
    )

    expect(section).toContain("## Re-review")
    expect(section).not.toContain("## The Diff")
    expect(reviewMode.mode).toBe("rereview")
  })

  it("reports a full review when the re-review falls back to the full diff", () => {
    jest.spyOn(console, "error").mockImplementation()
    mockFiles({})
    mockGit.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "log") {
        throw new Error("fatal: bad revision")
      }
      return args.includes("--name-only") ? "" : "diff --git a/x.ts b/x.ts\n"
    })

    const { section, reviewMode } = formatContextSection(
      "main",
      [],
      0,
      REREVIEW
    )

    expect(section).toContain("## The Diff")
    expect(reviewMode.mode).toBe("full")
  })
})

describe("formatReviewModeOutputs", () => {
  it("passes the earlier review's short SHA on a re-review", () => {
    expect(
      formatReviewModeOutputs({
        mode: "rereview",
        reason: "",
        previous: { sha: "a".repeat(40), body: "" },
      })
    ).toBe("review_mode=rereview\nreviewed_since=aaaaaaa\n")
  })

  it("leaves reviewed_since empty on a full review", () => {
    expect(formatReviewModeOutputs({ mode: "full", reason: "" })).toBe(
      "review_mode=full\nreviewed_since=\n"
    )
  })
})

describe("formatDelivery", () => {
  it("has experiment reviews return the summary as structured output", () => {
    const { toolArgs, section } = formatDelivery(true, "42")

    expect(toolArgs).toContain("--json-schema")
    expect(toolArgs).not.toContain("gh pr comment")
    expect(section).toContain("`summary` field of your structured output")
  })

  it("has other reviews post the summary themselves", () => {
    const { toolArgs, section } = formatDelivery(false, "42")

    expect(toolArgs).toMatch(/^--allowedTools "Bash\(gh pr comment:\*\),Read,/)
    expect(toolArgs).not.toContain("--json-schema")
    expect(section).toContain("`gh pr comment 42`")
  })

  it("allows the Agent tool only for the security pass", () => {
    expect(formatDelivery(true, "42").toolArgs).not.toContain("Agent")
    expect(formatDelivery(true, "42", true).toolArgs).toMatch(/,Agent"/)
    expect(formatDelivery(false, "42", true).toolArgs).toMatch(/,Agent"$/)
  })
})

describe("EXPERIMENT_INLINE_SECTION", () => {
  it("keeps nits and most questions out of inline comments", () => {
    expect(EXPERIMENT_INLINE_SECTION).toContain("Nits never go inline")
    expect(EXPERIMENT_INLINE_SECTION).toContain("at most three")
    expect(EXPERIMENT_INLINE_SECTION).toContain(
      "Questions go inline only when the answer decides"
    )
  })

  it("moves required findings scoring below 6 to Suggestions", () => {
    expect(EXPERIMENT_INLINE_SECTION).toContain("from 1 (rare edge case) to 5")
    expect(EXPERIMENT_INLINE_SECTION).toContain(
      "If the product is below 6, the finding is not required"
    )
    expect(EXPERIMENT_INLINE_SECTION).toContain(
      "Blocking findings are not scored"
    )
  })
})

describe("assemblePrompt", () => {
  const parts = { head: "HEAD", context: "CONTEXT", delivery: "DELIVERY" }

  it("puts the inline rules before delivery for experiment reviews", () => {
    expect(assemblePrompt(parts, true)).toBe(
      `HEADCONTEXT${EXPERIMENT_INLINE_SECTION}DELIVERY`
    )
  })

  it("leaves them out of standard reviews", () => {
    expect(assemblePrompt(parts, false)).toBe("HEADCONTEXTDELIVERY")
  })
})
