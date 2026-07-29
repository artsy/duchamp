import { isOffWeek } from "./biweekly"

// A real joule repo var (2023-04-27); 2026-07-16 is a real Incident Review
// day (168 weeks out from base date — even, so on-week), notified the prior
// day (2026-07-15).
const BASE_DATE = "2023-04-27"

describe("isOffWeek", () => {
  it("treats baseDate itself as an on-week (it's defined as a review day)", () => {
    expect(isOffWeek(BASE_DATE, new Date("2023-04-27T18:00:00Z"))).toBe(false)
  })

  it("treats the confirmed real review day as an on-week", () => {
    expect(isOffWeek(BASE_DATE, new Date("2026-07-16T18:00:00Z"))).toBe(false)
  })

  it("treats the following Thursday (no review) as an off-week", () => {
    expect(isOffWeek(BASE_DATE, new Date("2026-07-23T18:00:00Z"))).toBe(true)
  })

  it("treats the Thursday after that as an on-week again", () => {
    expect(isOffWeek(BASE_DATE, new Date("2026-07-30T18:00:00Z"))).toBe(false)
  })

  it("ignores time-of-day, only the UTC calendar date matters", () => {
    expect(isOffWeek(BASE_DATE, new Date("2026-07-23T00:00:01Z"))).toBe(true)
    expect(isOffWeek(BASE_DATE, new Date("2026-07-23T23:59:59Z"))).toBe(true)
  })
})
