/**
 * Helpers for text that came from outside: Datadog error payloads and the fix agent's
 * own output. Nothing here makes text safe to obey; it only makes it shorter, visible
 * and inert in Markdown.
 */

/** Zero-width, bidi, tag and variation-selector characters, plus C0/C1 controls other than tab and newline. */
const HIDDEN_RANGES: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
]

const isHidden = (codePoint: number): boolean =>
  HIDDEN_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)

export const stripHidden = (text: string): string =>
  Array.from(text)
    .filter(char => !isHidden(char.codePointAt(0)!))
    .join("")

/** Cut to `max` characters, marking the cut. */
export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`

/** Hidden characters out, runs of whitespace collapsed, then cut. For one-line fields. */
export const oneLine = (text: string, max: number): string =>
  clip(stripHidden(text).replace(/\s+/g, " ").trim(), max)

/** A fenced block that the text inside cannot close early. */
export const fence = (text: string, info = "text"): string => {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map(run => run.length)
  )
  const marks = "`".repeat(Math.max(3, longest + 1))
  return `${marks}${info}\n${text}\n${marks}`
}

/** Datadog issue ids are UUIDs. Anything else is refused before it reaches a path, branch or shell. */
export const DD_ISSUE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

export const isDdIssueId = (id: unknown): id is string =>
  typeof id === "string" && DD_ISSUE_ID.test(id)
