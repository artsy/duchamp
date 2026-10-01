import {
  buildPrompt,
  extractPrNumbers,
  parseDigest,
} from "./deploy-notification"

describe("extractPrNumbers", () => {
  it("extracts numbers from squash-merge commit subjects", () => {
    expect(
      extractPrNumbers([
        "fix: correct dimension unit switching (#11800)",
        "chore(deps): bump aws-sdk-s3 (#11795)",
      ])
    ).toEqual([11795, 11800])
  })

  it("extracts numbers from merge commits", () => {
    expect(
      extractPrNumbers([
        "Merge pull request #11786 from artsy/feature-branch\n\nStudio links",
      ])
    ).toEqual([11786])
  })

  it("ignores issue references in commit bodies and mid-subject", () => {
    expect(
      extractPrNumbers([
        "fix: something\n\nCloses #99",
        "revert #123 behavior for safety",
      ])
    ).toEqual([])
  })

  it("deduplicates and sorts", () => {
    expect(extractPrNumbers(["a (#5)", "b (#3)", "c (#5)"])).toEqual([3, 5])
  })
})

describe("parseDigest", () => {
  it("parses plain JSON", () => {
    expect(
      parseDigest('{"top_message": "hi", "thread_message": "there"}')
    ).toEqual({
      top_message: "hi",
      thread_message: "there",
    })
  })

  it("parses JSON wrapped in code fences", () => {
    expect(
      parseDigest('```json\n{"top_message": "hi", "thread_message": null}\n```')
    ).toEqual({
      top_message: "hi",
      thread_message: null,
    })
  })

  it("throws when top_message is missing", () => {
    expect(() => parseDigest('{"thread_message": "x"}')).toThrow(
      "missing top_message"
    )
  })
})

describe("buildPrompt", () => {
  it("includes repo context, deploy PR url, and shipped PRs", () => {
    const prompt = buildPrompt({
      repo: "artsy/volt",
      deployPrUrl: "https://github.com/artsy/volt/pull/11796",
      repoContext: "ArtOS is the partner CMS.",
      shippedPrs: [
        {
          number: 11800,
          title: "fix: dimension units",
          body: "Fixes AMBER-2021",
          url: "https://github.com/artsy/volt/pull/11800",
          author: "ole",
        },
      ],
    })
    expect(prompt).toContain("ArtOS is the partner CMS.")
    expect(prompt).toContain("https://github.com/artsy/volt/pull/11796")
    expect(prompt).toContain("PR #11800: fix: dimension units")
  })

  it("omits the context section when no context is configured", () => {
    const prompt = buildPrompt({
      repo: "artsy/volt",
      deployPrUrl: "https://github.com/artsy/volt/pull/1",
      shippedPrs: [],
    })
    expect(prompt).not.toContain("## Repository context")
  })
})
