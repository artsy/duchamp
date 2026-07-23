import { nextShiftBoundaryInstant, shiftBoundaryAnchor } from "./shift-boundary"

describe("shiftBoundaryAnchor", () => {
  it("anchors 1 second before the boundary during EDT (UTC-4)", () => {
    // Monday 2026-07-13, 11:00am ET is EDT (UTC-4) -> 2026-07-13T15:00:00Z
    const now = new Date("2026-07-13T15:04:00Z")

    const anchor = shiftBoundaryAnchor({ weekday: 1, hour: 11 }, now)

    expect(anchor.toISOString()).toBe("2026-07-13T14:59:59.000Z")
  })

  it("anchors 1 second before the boundary during EST (UTC-5)", () => {
    // Monday 2026-01-12, 11:00am ET is EST (UTC-5) -> 2026-01-12T16:00:00Z
    const now = new Date("2026-01-12T16:04:00Z")

    const anchor = shiftBoundaryAnchor({ weekday: 1, hour: 11 }, now)

    expect(anchor.toISOString()).toBe("2026-01-12T15:59:59.000Z")
  })

  it("anchors to the same boundary whether the job runs early or late", () => {
    const runningEarly = new Date("2026-07-13T14:58:00Z") // 10:58am ET
    const runningLate = new Date("2026-07-13T15:04:00Z") // 11:04am ET

    const boundary = { weekday: 1, hour: 11 }

    expect(shiftBoundaryAnchor(boundary, runningEarly).toISOString()).toBe(
      shiftBoundaryAnchor(boundary, runningLate).toISOString()
    )
  })

  it("throws when now's weekday (in the target timezone) doesn't match", () => {
    const wednesday = new Date("2026-07-15T15:04:00Z")

    expect(() =>
      shiftBoundaryAnchor({ weekday: 1, hour: 11 }, wednesday)
    ).toThrow("expected today to be weekday 1")
  })

  it("supports a custom timezone with a half-hour UTC offset", () => {
    // Monday 2026-07-13, 11:00am IST (UTC+5:30) -> 2026-07-13T05:30:00Z
    const now = new Date("2026-07-13T05:34:00Z")

    const anchor = shiftBoundaryAnchor(
      { weekday: 1, hour: 11, timeZone: "Asia/Kolkata" },
      now
    )

    expect(anchor.toISOString()).toBe("2026-07-13T05:29:59.000Z")
  })
})

describe("nextShiftBoundaryInstant", () => {
  it("returns today's boundary when its hour hasn't passed yet", () => {
    // Monday 2026-07-27, 10:00am EDT -- boundary is 11am ET, later today.
    const now = new Date("2026-07-27T14:00:00Z")

    const instant = nextShiftBoundaryInstant({ weekday: 1, hour: 11 }, now)

    expect(instant.toISOString()).toBe("2026-07-27T15:00:00.000Z")
  })

  it("rolls forward a full week when today's boundary hour already passed", () => {
    // Monday 2026-07-27, 12:00pm EDT -- boundary (11am ET) already passed.
    const now = new Date("2026-07-27T16:00:00Z")

    const instant = nextShiftBoundaryInstant({ weekday: 1, hour: 11 }, now)

    expect(instant.toISOString()).toBe("2026-08-03T15:00:00.000Z")
  })

  it("projects forward to a later weekday within the same week", () => {
    // Thursday 2026-07-30, 11:00am EDT -> next Monday 11am ET boundary.
    // Matches real schedule_entries data validated against production.
    const now = new Date("2026-07-30T15:00:00Z")

    const instant = nextShiftBoundaryInstant({ weekday: 1, hour: 11 }, now)

    expect(instant.toISOString()).toBe("2026-08-03T15:00:00.000Z")
  })

  it("projects forward to Friday midnight ET from a Monday", () => {
    // Monday 2026-07-27, 11:00am EDT -> Friday 2026-07-31, midnight ET.
    const now = new Date("2026-07-27T15:00:00Z")

    const instant = nextShiftBoundaryInstant({ weekday: 5, hour: 0 }, now)

    expect(instant.toISOString()).toBe("2026-07-31T04:00:00.000Z")
  })

  it("resolves the offset for the target date, not now's date, across a DST fall-back", () => {
    // Thursday 2026-10-29 is EDT (UTC-4); the next Monday, 2026-11-02, is
    // after the Nov 1 fall-back and is EST (UTC-5).
    const now = new Date("2026-10-29T15:00:00Z")

    const instant = nextShiftBoundaryInstant({ weekday: 1, hour: 11 }, now)

    expect(instant.toISOString()).toBe("2026-11-02T16:00:00.000Z")
  })

  it("rolls across a year boundary correctly", () => {
    // Monday 2026-12-28, 12:30pm EST -- boundary (11am ET) already passed;
    // next Monday is 2027-01-04.
    const now = new Date("2026-12-28T17:30:00Z")

    const instant = nextShiftBoundaryInstant({ weekday: 1, hour: 11 }, now)

    expect(instant.toISOString()).toBe("2027-01-04T16:00:00.000Z")
  })
})
