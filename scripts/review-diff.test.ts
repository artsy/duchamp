import { fenced, truncateLines } from "./review-diff"

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
