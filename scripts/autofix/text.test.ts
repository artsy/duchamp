import { clip, fence, isDdIssueId, oneLine, stripHidden } from "./text"

describe("stripHidden", () => {
  it("removes zero-width, bidi, tag and control characters", () => {
    const hidden = [0x200b, 0x202e, 0xe0041, 0xfeff, 0x07]
      .map(code => String.fromCodePoint(code))
      .join("")
    expect(stripHidden(`a${hidden}b`)).toBe("ab")
  })

  it("keeps tabs, newlines and ordinary Unicode", () => {
    expect(stripHidden("a\tb\nc é 🎨")).toBe("a\tb\nc é 🎨")
  })
})

it("clips with a marker", () => {
  expect(clip("abcdef", 4)).toBe("abc…")
  expect(clip("abc", 4)).toBe("abc")
})

it("collapses one-line fields", () => {
  expect(oneLine("  a\n\n b  ", 10)).toBe("a b")
})

it("fences text with a fence longer than any backtick run inside", () => {
  expect(fence("x ```` y")).toBe("`````text\nx ```` y\n`````")
  expect(fence("plain")).toBe("```text\nplain\n```")
})

it.each([
  ["0b7e7c2a-1111-4c1d-9a00-000000000001", true],
  ["abc", true],
  ["../x", false],
  ["a b", false],
  ["-a", false],
  [123, false],
])("isDdIssueId(%p) is %p", (id, expected) => {
  expect(isDdIssueId(id)).toBe(expected)
})
