// Incident Reviews run every other week. `baseDate` anchors a date known to
// fall on an on-week; parity alternates every 7 days from there via exact
// day-level integer arithmetic, so it never drifts no matter how old
// `baseDate` gets (unlike wall-clock/float-based approaches).

export interface BiweeklySchedule {
  baseDate: string // UTC YYYY-MM-DD, a date when a review SHOULD happen
  exceptions: string[] // UTC YYYY-MM-DD dates that force an on-week regardless of parity
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const toUtcDateOnly = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

const toUtcDateString = (date: Date): string => date.toISOString().slice(0, 10)

// Whether `at` (its UTC calendar date) falls on an off-week. A date listed in
// `exceptions` always forces an on-week — e.g. a deliberate catch-up review
// scheduled during what would otherwise be an off-week to clear backlogged
// postmortems.
//
// Assumes `at` falls on the same weekday as `baseDate` (both are meeting
// days, not the day-before notification day) — callers only invoke this for
// dates that already matched the configured meeting weekday, so `target` and
// `base` are always an exact multiple of 7 days apart. `baseDate` is itself
// defined as an on-week occurrence, so `weeksSince === 0` (and any even
// multiple of it) must resolve to on-week — verified against a real
// confirmed review day (2026-07-16, `weeksSince` 168, even).
export const isOffWeek = (schedule: BiweeklySchedule, at: Date): boolean => {
  const atDateString = toUtcDateString(at)
  if (schedule.exceptions.includes(atDateString)) {
    return false
  }

  const base = toUtcDateOnly(new Date(`${schedule.baseDate}T00:00:00Z`))
  const target = toUtcDateOnly(at)
  const weeksSince = Math.floor((target - base) / MS_PER_DAY / 7)

  return weeksSince % 2 !== 0
}
