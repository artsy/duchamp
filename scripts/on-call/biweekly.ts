// Incident Reviews run every other week. `baseDate` anchors a date known to
// fall on an on-week; parity alternates every 7 days from there via exact
// day-level integer arithmetic, so it never drifts no matter how old
// `baseDate` gets (unlike wall-clock/float-based approaches).

const MS_PER_DAY = 24 * 60 * 60 * 1000

const toUtcDateOnly = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

// Whether `at` (its UTC calendar date) falls on an off-week.
//
// Assumes `at` falls on the same weekday as `baseDate` (both are meeting
// days) — callers only invoke this for dates that already matched the
// configured meeting weekday, so `target` and `base` are always an exact
// multiple of 7 days apart. `baseDate` is itself defined as an on-week
// occurrence, so `weeksSince === 0` (and any even multiple of it) must
// resolve to on-week — verified against a real confirmed review day
// (2026-07-16, `weeksSince` 168, even).
export const isOffWeek = (baseDate: string, at: Date): boolean => {
  const base = toUtcDateOnly(new Date(`${baseDate}T00:00:00Z`))
  const target = toUtcDateOnly(at)
  const weeksSince = Math.floor((target - base) / MS_PER_DAY / 7)

  return weeksSince % 2 !== 0
}
