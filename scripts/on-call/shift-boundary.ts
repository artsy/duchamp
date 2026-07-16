// Anchors "who was on-call as of a shift-change boundary" to a fixed instant
// derived from that boundary's calendar day, rather than the literal
// execution time of the caller. GitHub's `schedule` trigger can fire a few
// minutes late; without this, a late-firing job could cross the boundary and
// pick up the incoming shift instead of the outgoing one it's meant to report.
//
// Boundaries are defined in local wall-clock time (e.g. "11am ET"), but the
// API this feeds only understands UTC instants, so this file also converts
// between the two — DST included — using `Intl`, with no external dependency.

const DEFAULT_TIME_ZONE = "America/New_York"

// How far before a shift-change boundary to anchor, so that an exact-instant
// match resolves to the outgoing shift rather than the incoming one.
const BOUNDARY_SAFETY_MARGIN_MS = 1_000

export interface ShiftBoundary {
  weekday: number // 0 (Sun) - 6 (Sat), Date#getDay convention
  hour: number // 0-23, local time in `timeZone`
  timeZone?: string // IANA name, default "America/New_York"
}

interface CivilDateTime {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
  second: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const civilDateTimeIn = (timeZone: string, instant: Date): CivilDateTime => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_INDEX[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

// Returns the UTC offset (in minutes) that `timeZone` observes at `instant`.
// e.g. America/New_York is -240 in summer (EDT) and -300 in winter (EST) —
// `Intl` resolves which one applies for this exact date from the IANA
// timezone database, so this is DST-aware without a lookup table.
const utcOffsetMinutes = (timeZone: string, instant: Date): number => {
  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(instant)
      .find(part => part.type === "timeZoneName")?.value ?? "GMT"

  // "GMT-4" -> -240, "GMT+5:30" -> 330, "GMT" -> 0
  const match = offsetName.match(/GMT(?:([+-])(\d+)(?::(\d+))?)?/)
  const [, sign, hours = "0", minutes = "0"] = match ?? []
  const magnitude = Number(hours) * 60 + Number(minutes)
  return sign === "-" ? -magnitude : magnitude
}

// Converts a wall-clock time in `timeZone` to the UTC instant it represents.
const zonedTimeToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date => {
  // A same-day guess is enough to know which offset applies (e.g. EDT vs
  // EST) — it doesn't need to be exact.
  const roughGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset = utcOffsetMinutes(timeZone, new Date(roughGuess))
  // Local time = UTC time + offset, so UTC time = local time - offset.
  return new Date(roughGuess - offset * 60_000)
}

// Deterministic anchor for "who was on-call up to this boundary" — independent
// of how late the caller actually happens to run relative to the boundary.
// Only `now`'s calendar day (in `timeZone`) is used; the target hour is fixed,
// so a job running a few minutes early or late on the right day still anchors
// to the same instant.
export const shiftBoundaryAnchor = (
  boundary: ShiftBoundary,
  now: Date = new Date()
): Date => {
  const timeZone = boundary.timeZone ?? DEFAULT_TIME_ZONE
  const civil = civilDateTimeIn(timeZone, now)

  if (civil.weekday !== boundary.weekday) {
    throw new Error(
      `shiftBoundaryAnchor expected today to be weekday ${boundary.weekday} in ${timeZone}, but it's ${civil.weekday}.`
    )
  }

  const boundaryInstant = zonedTimeToUtc(
    civil.year,
    civil.month,
    civil.day,
    boundary.hour,
    0,
    0,
    timeZone
  )

  return new Date(boundaryInstant.getTime() - BOUNDARY_SAFETY_MARGIN_MS)
}
