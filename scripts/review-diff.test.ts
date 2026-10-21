import { fenced, toGitGlobs, truncateLines } from "./review-diff"

describe("truncateLines", () => {
  it("returns text under the cap unchanged", () => {
    expect(truncateLines("a\nb", 10)).toBe("a\nb")
  })

  it("keeps whole lines and counts the rest", () => {
    expect(truncateLines("aaaa\nbbbb\ncccc", 10)).toBe(
      "aaaa\nbbbb\n... 1 more lines"
    )
  })
})

describe("fenced", () => {
  it("uses three backticks for plain content", () => {
    expect(fenced("a\n", "diff")).toBe("```diff\na\n```")
  })

  it("outgrows the longest backtick run in the content", () => {
    expect(fenced("x ```` y", "")).toBe("`````\nx ```` y\n`````")
  })
})

describe("toGitGlobs", () => {
  it("matches a pattern without a slash at any depth, and what's under it", () => {
    expect(toGitGlobs("*.snap")).toEqual(["**/*.snap", "**/*.snap/**"])
    expect(toGitGlobs("vendor")).toEqual(["**/vendor", "**/vendor/**"])
  })

  it("anchors a pattern with a leading or middle slash to the root", () => {
    expect(toGitGlobs("/vendor")).toEqual(["vendor", "vendor/**"])
    expect(toGitGlobs("src/gen/*.ts")).toEqual([
      "src/gen/*.ts",
      "src/gen/*.ts/**",
    ])
  })

  it("matches a directory pattern at any depth, unless anchored", () => {
    expect(toGitGlobs("generated/")).toEqual(["**/generated/**"])
    expect(toGitGlobs("/generated/")).toEqual(["generated/**"])
  })
})
