import { execFileSync } from "child_process"
import { reviewMarker } from "./post-review-summary"
import { MAX_DIFF_BYTES } from "./review-diff"
import {
  decideReviewMode,
  fetchBotCommentBodies,
  findPreviousReview,
  formatRereviewSection,
  MAX_DELTA_DIFF_BYTES,
  resolveReviewMode,
  stripReviewFooter,
} from "./review-mode"

jest.mock("child_process")

const mockExec = execFileSync as jest.Mock

const SHA = "a".repeat(40)
const OTHER_SHA = "b".repeat(40)
const PREVIOUS = {
  sha: SHA,
  body: `## Code Review\n\n1. Bug.\n\n<!-- ai-review-footer -->\n<details>\n<summary>Review stats · $0.50</summary>\n\n| Cost | $0.50 |\n\n</details>\n\n${reviewMarker(SHA)}`,
}

type Answer = string | Error

/** Answer git by subcommand and gh with one canned output. */
const mockCommands = (git: Record<string, Answer>, gh: Answer = ""): void => {
  mockExec.mockImplementation((cmd: string, args: string[]) => {
    const answer = cmd === "gh" ? gh : git[args[0]]
    if (answer instanceof Error) {
      throw answer
    }
    return answer ?? ""
  })
}

const gitCalls = (subcommand: string): string[][] =>
  mockExec.mock.calls
    .filter(([cmd, args]) => cmd === "git" && args[0] === subcommand)
    .map(([, args]) => args as string[])

beforeEach(() => {
  mockExec.mockReset()
})

describe("findPreviousReview", () => {
  it("returns null when no comment has a marker", () => {
    expect(findPreviousReview(["## Code Review\n\nLooks fine."])).toBeNull()
  })

  it("takes the latest comment with a marker", () => {
    const later = `Later.\n${reviewMarker(OTHER_SHA)}`

    expect(findPreviousReview([PREVIOUS.body, later])).toEqual({
      sha: OTHER_SHA,
      body: later,
    })
  })

  it("takes the last marker in a summary that quotes one", () => {
    const quoting = `Markers look like \`${reviewMarker(OTHER_SHA)}\`.\n\n${reviewMarker(SHA)}`

    expect(findPreviousReview([quoting])).toMatchObject({ sha: SHA })
  })

  it("ignores a marker without a full SHA", () => {
    expect(findPreviousReview(["<!-- ai-review-sha: abc123 -->"])).toBeNull()
  })
})

describe("fetchBotCommentBodies", () => {
  it("keeps only the review bot's comments", () => {
    mockCommands({}, '"first"\n"second\\nline"\n')

    expect(fetchBotCommentBodies("artsy/eigen", "42")).toEqual([
      "first",
      "second\nline",
    ])
    const [, args] = mockExec.mock.calls[0]
    expect(args).toContain("repos/artsy/eigen/issues/42/comments")
    expect(args.join(" ")).toContain(
      'select(.user.type == "Bot" and .user.login == "github-actions[bot]")'
    )
  })
})

describe("stripReviewFooter", () => {
  it("cuts the stats block and the marker", () => {
    expect(stripReviewFooter(PREVIOUS.body)).toBe("## Code Review\n\n1. Bug.")
  })

  it("cuts a footer without a stats block", () => {
    expect(
      stripReviewFooter(
        `Summary.\n\n<!-- ai-review-footer -->\n${reviewMarker(SHA)}`
      )
    ).toBe("Summary.")
  })

  it("leaves a body without a footer alone", () => {
    expect(stripReviewFooter("Summary.\n")).toBe("Summary.")
  })
})

describe("decideReviewMode", () => {
  it("reviews in full without an earlier review", () => {
    expect(decideReviewMode(null, []).mode).toBe("full")
    expect(mockExec).not.toHaveBeenCalled()
  })

  it("reviews in full when the earlier commit left the history", () => {
    mockCommands({ "merge-base": new Error("exit 1") })

    expect(decideReviewMode(PREVIOUS, []).mode).toBe("full")
  })

  it("reviews in full when a merge brought in other changes since", () => {
    mockCommands({ "rev-list": `${OTHER_SHA}\n`, diff: "src/app.ts\n" })

    expect(decideReviewMode(PREVIOUS, [])).toMatchObject({
      mode: "full",
      reason: "a merge since earlier review at aaaaaaa",
    })
    expect(gitCalls("rev-list")[0]).toEqual([
      "rev-list",
      "--merges",
      `${SHA}..HEAD`,
    ])
    expect(gitCalls("diff")).toHaveLength(0)
  })

  it("skips when only lockfiles or ignored paths changed", () => {
    mockCommands({ diff: "\n" })

    const result = decideReviewMode(PREVIOUS, ["**/*.generated.ts"])

    expect(result.mode).toBe("skip")
    const args = gitCalls("diff")[0]
    expect(args).toContain(`${SHA}..HEAD`)
    expect(args).not.toContain(":(exclude,glob)**/*.md")
    expect(args).toContain(":(exclude,glob)**/yarn.lock")
    expect(args).toContain(":(exclude,glob)**/*.generated.ts")
  })

  it("re-reviews when code changed", () => {
    mockCommands({ diff: "src/app.ts\n" })

    expect(decideReviewMode(PREVIOUS, [])).toEqual({
      mode: "rereview",
      reason: "changes since earlier review at aaaaaaa",
      previous: PREVIOUS,
    })
  })
})

describe("resolveReviewMode", () => {
  it("reviews in full without a PR number", () => {
    expect(resolveReviewMode("artsy/eigen", undefined, [], true).mode).toBe(
      "full"
    )
    expect(mockExec).not.toHaveBeenCalled()
  })

  it("reviews in full when the comment lookup fails", () => {
    mockCommands({}, new Error("HTTP 403"))

    const result = resolveReviewMode("artsy/eigen", "42", [], true)

    expect(result.mode).toBe("full")
    expect(result.reason).toContain("HTTP 403")
  })

  it("reviews in full outside the experiment without looking anything up", () => {
    expect(resolveReviewMode("artsy/eigen", "42", [], false).mode).toBe("full")
    expect(mockExec).not.toHaveBeenCalled()
  })

  it("skips when the bot's marker names the current commit", () => {
    mockCommands({ diff: "" }, `${JSON.stringify(PREVIOUS.body)}\n`)

    expect(resolveReviewMode("artsy/eigen", "42", [], true).mode).toBe("skip")
  })
})

describe("formatRereviewSection", () => {
  it("includes the earlier summary, new commits, delta diff and PR files", () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "log") return "bbbbbbb fix the bug\n"
      if (args.includes("--numstat")) return "2\t2\tsrc/app.ts\n"
      return "diff --git a/src/app.ts b/src/app.ts\n-bug\n+fix\n"
    })

    const section = formatRereviewSection(PREVIOUS, "main", [])

    expect(section).toContain("You reviewed this PR before, at `aaaaaaa`")
    expect(section).toContain("1. Bug.")
    expect(section).not.toContain("ai-review-sha")
    expect(section).toContain("bbbbbbb fix the bug")
    expect(section).toContain("```diff\ndiff --git a/src/app.ts")
    expect(section).toContain("2\t2\tsrc/app.ts")
    expect(gitCalls("diff")[0]).toContain(`${SHA}..HEAD`)
    expect(
      gitCalls("diff").some(args => args.includes("origin/main...HEAD"))
    ).toBe(true)
  })

  it("lists files instead of a delta diff over its cap", () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "log") return "bbbbbbb big change\n"
      if (args.includes("--numstat")) return "9000\t0\tbig.ts\n"
      return "+".repeat(MAX_DELTA_DIFF_BYTES + 1)
    })

    const section = formatRereviewSection(PREVIOUS, "main", [])

    expect(section).toContain("too large to include")
    expect(section).not.toContain("++++++++")
  })

  it("shrinks the delta diff when the prompt has less room", () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "log") return "bbbbbbb change\n"
      if (args.includes("--numstat")) return "1\t0\tx.ts\n"
      return "+".repeat(MAX_DELTA_DIFF_BYTES - 10_000)
    })

    const section = formatRereviewSection(
      PREVIOUS,
      "main",
      [],
      MAX_DIFF_BYTES - 20_000
    )

    expect(section).toContain("too large to include")
  })
})
