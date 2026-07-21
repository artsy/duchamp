import { shiftBoundaryAnchor } from "./shift-boundary"

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
