import { type BiweeklySchedule, isOffWeek } from "./biweekly"

// baseDate is a real joule repo var (`DATES`); 2026-07-16 was confirmed by
// the user as a real Incident Review day, notified the prior day (2026-07-15).
const SCHEDULE: BiweeklySchedule = {
  baseDate: "2023-04-27",
  exceptions: [],
}

describe("isOffWeek", () => {
  it("treats baseDate itself as an on-week (it's defined as a review day)", () => {
    expect(isOffWeek(SCHEDULE, new Date("2023-04-27T18:00:00Z"))).toBe(false)
  })

  it("treats the confirmed real review day as an on-week", () => {
    expect(isOffWeek(SCHEDULE, new Date("2026-07-16T18:00:00Z"))).toBe(false)
  })

  it("treats the following Thursday (no review) as an off-week", () => {
    expect(isOffWeek(SCHEDULE, new Date("2026-07-23T18:00:00Z"))).toBe(true)
  })

  it("treats the Thursday after that as an on-week again", () => {
    expect(isOffWeek(SCHEDULE, new Date("2026-07-30T18:00:00Z"))).toBe(false)
  })

  it("ignores time-of-day, only the UTC calendar date matters", () => {
    expect(isOffWeek(SCHEDULE, new Date("2026-07-23T00:00:01Z"))).toBe(true)
    expect(isOffWeek(SCHEDULE, new Date("2026-07-23T23:59:59Z"))).toBe(true)
  })

  it("force-flips an off-week to on-week when the date is listed in exceptions", () => {
    const withCatchUp: BiweeklySchedule = {
      ...SCHEDULE,
      exceptions: ["2026-07-23"],
    }

    expect(isOffWeek(withCatchUp, new Date("2026-07-23T18:00:00Z"))).toBe(
      false
    )
  })

  it("does not affect a date not listed in exceptions", () => {
    const withCatchUp: BiweeklySchedule = {
      ...SCHEDULE,
      exceptions: ["2026-08-06"],
    }

    expect(isOffWeek(withCatchUp, new Date("2026-07-23T18:00:00Z"))).toBe(
      true
    )
  })
})
