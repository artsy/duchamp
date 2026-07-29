// Incident Reviews run every other week. `baseDate` anchors a known on-week;
// parity alternates every 7 days via exact day-level integer arithmetic, so
// it never drifts no matter how old `baseDate` gets.

import { MS_PER_DAY } from "./shift-boundary"

const toUtcDateOnly = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

// Whether `at` falls on an off-week. Assumes `at` and `baseDate` share the
// same weekday — callers only pass dates that already matched the meeting
// weekday, so they're always a whole number of weeks apart — and that
// `baseDate` itself is an on-week, so an even weeksSince means on-week.
export const isOffWeek = (baseDate: string, at: Date): boolean => {
  const base = toUtcDateOnly(new Date(`${baseDate}T00:00:00Z`))
  const target = toUtcDateOnly(at)
  const weeksSince = Math.floor((target - base) / MS_PER_DAY / 7)

  return weeksSince % 2 !== 0
}
