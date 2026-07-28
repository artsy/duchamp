import * as fs from "fs"
import {
  buildPayload,
  main,
  resolveMeetingInstant,
} from "./facilitate-incident-review"
import { currentOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"

jest.mock("fs")
jest.mock("./incident-io")

const mockFs = fs as jest.Mocked<typeof fs>
const mockCurrentOnCallUsers = currentOnCallUsers as jest.Mock
const mockUsersToMentions = usersToMentions as jest.Mock
const mockScheduleUrl = scheduleUrl as jest.Mock

const SCHEDULE_URL =
  "https://app.incident.io/artsy/on-call/schedules/schedule-123"

// A real joule repo var (2023-04-27); 2026-07-16 is a real Incident Review
// day (168 weeks out — even, so on-week); 2026-07-23/2026-07-22 are 169
// weeks out (odd, so off-week).
const BASE_DATE = "2023-04-27"

describe("buildPayload", () => {
  it("mentions the chosen facilitator and links the schedule + review doc", () => {
    const payload = JSON.parse(buildPayload("<@U_ALICE>", SCHEDULE_URL))

    expect(payload.blocks).toHaveLength(1)
    const text = payload.blocks[0].text.text
    expect(text).toContain("<@U_ALICE> :wave:")
    expect(text).toContain(`<${SCHEDULE_URL}|on-call schedule>`)
    expect(text).toContain("facilitate_ the upcoming Incident Review meeting")
    expect(text).toContain("Incident Review Schedule")
  })

  it("posts a warning instead of an empty mention when nobody is mentionable", () => {
    const payload = JSON.parse(buildPayload(undefined, SCHEDULE_URL))

    expect(payload.blocks).toHaveLength(1)
    const text = payload.blocks[0].text.text
    expect(text).toContain(":warning:")
    expect(text).toContain("can be reached on Slack")
    expect(text).toContain(`<${SCHEDULE_URL}|on-call schedule>`)
  })
})

describe("resolveMeetingInstant", () => {
  it("targets tomorrow when it's an on-week occurrence of meetingWeekday", () => {
    // Wednesday 2026-07-15, an on-week per the real base date; tomorrow
    // (Thursday 2026-07-16) is the routine cron's target.
    const now = new Date("2026-07-15T14:00:00Z")

    const instant = resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, undefined)

    // 2026-07-16 is EDT (UTC-4): 11:30am ET -> 3:30pm UTC.
    expect(instant?.toISOString()).toBe("2026-07-16T15:30:00.000Z")
  })

  it("returns null when tomorrow is an off-week", () => {
    // Wednesday 2026-07-22, an off-week; tomorrow (2026-07-23) has no review.
    const now = new Date("2026-07-22T14:00:00Z")

    const instant = resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, undefined)

    expect(instant).toBeNull()
  })

  it("throws when tomorrow isn't meetingWeekday at all", () => {
    // Any day where tomorrow isn't Thursday -- a real misconfiguration
    // (cron/meetingWeekday mismatch), not the legitimate off-week case. The
    // message also points at MEETING_OVERRIDE_DATE, since this can equally
    // fire during a manual workflow_dispatch test run where "check the cron
    // schedule" isn't useful advice.
    const now = new Date("2026-07-16T14:00:00Z") // tomorrow is Friday

    expect(() =>
      resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, undefined)
    ).toThrow(
      "resolveMeetingInstant expected tomorrow (in America/New_York) to be weekday 4, but it's 5. Check the cron schedule against MEETING_WEEKDAY, or set MEETING_OVERRIDE_DATE to target a specific date directly."
    )
  })

  it("computes tomorrow in ET civil time, not raw UTC, for a cron that fires just after UTC midnight", () => {
    // A cron meant for "Wednesday evening ET" has to fire at 2am UTC
    // Thursday -- its UTC calendar date is already Thursday, but in ET civil
    // time (EDT, UTC-4) it's still 10pm Wednesday. Naive UTC+1-day arithmetic
    // would land on UTC-Friday and never match meetingWeekday=4 (Thursday);
    // civil-day arithmetic correctly resolves tomorrow as ET-Thursday.
    const now = new Date("2026-07-16T02:00:00Z")

    const instant = resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, undefined)

    expect(instant?.toISOString()).toBe("2026-07-16T15:30:00.000Z")
  })

  it("targets the override date directly, bypassing the on/off-week check", () => {
    // 2026-07-23 is an off-week Thursday; an override should still target it.
    const now = new Date("2026-07-20T14:00:00Z")

    const instant = resolveMeetingInstant(
      now,
      4,
      11,
      30,
      BASE_DATE,
      "2026-07-23"
    )

    expect(instant?.toISOString()).toBe("2026-07-23T15:30:00.000Z")
  })

  it("targets an override date on any weekday, not just meetingWeekday", () => {
    // Monday catch-up, doesn't match meetingWeekday (Thursday) at all.
    const now = new Date("2026-07-24T14:00:00Z")

    const instant = resolveMeetingInstant(
      now,
      4,
      11,
      30,
      BASE_DATE,
      "2026-07-27"
    )

    expect(instant?.toISOString()).toBe("2026-07-27T15:30:00.000Z")
  })

  it("throws when the override date is in the past", () => {
    const now = new Date("2026-07-24T14:00:00Z")

    expect(() =>
      resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, "2026-07-20")
    ).toThrow(
      'MEETING_OVERRIDE_DATE "2026-07-20" resolves to 2026-07-20T15:30:00.000Z, which is not after now (2026-07-24T14:00:00.000Z). The override must target a future meeting.'
    )
  })

  it("throws when the override date resolves to exactly now", () => {
    // 2026-07-23 at 11:30am ET (EDT) is exactly 2026-07-23T15:30:00Z.
    const now = new Date("2026-07-23T15:30:00.000Z")

    expect(() =>
      resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, "2026-07-23")
    ).toThrow("is not after now")
  })

  it("throws on a malformed override date", () => {
    const now = new Date("2026-07-24T14:00:00Z")

    expect(() =>
      resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, "07/27/2026")
    ).toThrow(
      'Invalid MEETING_OVERRIDE_DATE: "07/27/2026". Must be YYYY-MM-DD.'
    )
  })

  it("tolerates leading/trailing whitespace in a hand-typed override date", () => {
    const now = new Date("2026-07-24T14:00:00Z")

    const instant = resolveMeetingInstant(
      now,
      4,
      11,
      30,
      BASE_DATE,
      " 2026-07-27 "
    )

    expect(instant?.toISOString()).toBe("2026-07-27T15:30:00.000Z")
  })

  it("throws on an override date that doesn't exist on the calendar", () => {
    // Date.UTC would silently roll this over to 2026-03-03.
    const now = new Date("2026-02-01T14:00:00Z")

    expect(() =>
      resolveMeetingInstant(now, 4, 11, 30, BASE_DATE, "2026-02-31")
    ).toThrow(
      'Invalid MEETING_OVERRIDE_DATE: "2026-02-31" is not a real calendar date.'
    )
  })

  it("resolves the meeting hour/minute DST-aware", () => {
    // baseDate === tomorrow itself, so weeksSince = 0 (on-week), isolating
    // this test from the real production parity data.
    const now = new Date("2027-01-06T14:00:00Z") // Wednesday before
    const winterBaseDate = "2027-01-07" // Thursday, EST (UTC-5)

    const instant = resolveMeetingInstant(
      now,
      4,
      11,
      30,
      winterBaseDate,
      undefined
    )

    // 11:30am ET during EST (UTC-5) -> 4:30pm UTC, not the 3:30pm EDT would give.
    expect(instant?.toISOString()).toBe("2027-01-07T16:30:00.000Z")
  })
})

describe("main", () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    process.env = {
      ...originalEnv,
      GITHUB_OUTPUT: undefined,
      MEETING_BASE_DATE: BASE_DATE,
    }
    mockCurrentOnCallUsers.mockResolvedValue([{ id: "user-1" }])
    mockUsersToMentions.mockReturnValue(["<@U_ALICE>"])
    mockScheduleUrl.mockReturnValue(SCHEDULE_URL)
  })

  afterEach(() => {
    process.env = originalEnv
    jest.useRealTimers()
  })

  it("throws when INCIDENT_IO_API_KEY is not set", async () => {
    delete process.env.INCIDENT_IO_API_KEY
    process.env.SCHEDULE_ID = "schedule-123"

    await expect(main()).rejects.toThrow(
      "INCIDENT_IO_API_KEY env var is not set."
    )
  })

  it("throws when SCHEDULE_ID is not set", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    delete process.env.SCHEDULE_ID

    await expect(main()).rejects.toThrow("SCHEDULE_ID env var is not set.")
  })

  it("throws when MEETING_BASE_DATE is not set", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    delete process.env.MEETING_BASE_DATE

    await expect(main()).rejects.toThrow(
      "MEETING_BASE_DATE env var is not set."
    )
  })

  it("throws when MEETING_BASE_DATE's weekday doesn't match MEETING_WEEKDAY", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    // 2023-04-27 is a Thursday (weekday 4); configuring Wednesday (3) here
    // simulates the meeting day changing without baseDate being updated.
    process.env.MEETING_WEEKDAY = "3"

    await expect(main()).rejects.toThrow(
      'MEETING_BASE_DATE ("2023-04-27") falls on weekday 4, but MEETING_WEEKDAY is 3'
    )
  })

  it("logs and skips without writing GITHUB_OUTPUT on an off-week with no override", async () => {
    jest.setSystemTime(new Date("2026-07-22T14:00:00Z")) // off-week Wednesday
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.GITHUB_OUTPUT = "/tmp/fake-output"
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("skipping"))
    expect(mockFs.appendFileSync).not.toHaveBeenCalled()
    expect(mockCurrentOnCallUsers).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("queries on-call at the meeting instant and posts the facilitator payload", async () => {
    jest.setSystemTime(new Date("2026-07-15T14:00:00Z")) // on-week Wednesday
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.GITHUB_OUTPUT = "/tmp/fake-output"
    mockFs.appendFileSync.mockImplementation(() => undefined)

    await main()

    expect(mockCurrentOnCallUsers).toHaveBeenCalledWith(
      "test-key",
      "schedule-123",
      new Date("2026-07-16T15:30:00.000Z")
    )
    const [, contents] = mockFs.appendFileSync.mock.calls[0]
    expect(contents).toContain("<@U_ALICE>")
  })

  it("uses MEETING_OVERRIDE_DATE for a manual catch-up run on an off-week", async () => {
    jest.setSystemTime(new Date("2026-07-20T14:00:00Z")) // well before the catch-up
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.GITHUB_OUTPUT = "/tmp/fake-output"
    process.env.MEETING_OVERRIDE_DATE = "2026-07-23" // an off-week Thursday
    mockFs.appendFileSync.mockImplementation(() => undefined)

    await main()

    expect(mockCurrentOnCallUsers).toHaveBeenCalledWith(
      "test-key",
      "schedule-123",
      new Date("2026-07-23T15:30:00.000Z")
    )
  })

  it("still posts a warning payload when nobody on-call is mentionable", async () => {
    jest.setSystemTime(new Date("2026-07-15T14:00:00Z"))
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.GITHUB_OUTPUT = "/tmp/fake-output"
    mockUsersToMentions.mockReturnValue([])
    mockFs.appendFileSync.mockImplementation(() => undefined)

    await main()

    expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1)
    const [, contents] = mockFs.appendFileSync.mock.calls[0]
    expect(contents).toContain(":warning:")
  })

  it("logs the candidate pool before picking, and the payload to stdout when GITHUB_OUTPUT is unset", async () => {
    jest.setSystemTime(new Date("2026-07-15T14:00:00Z"))
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    mockUsersToMentions.mockReturnValue(["<@U_ALICE>", "<@U_BOB>"])
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(consoleSpy).toHaveBeenCalledTimes(2)
    expect(consoleSpy.mock.calls[0][0]).toBe(
      "facilitate-incident-review: choosing a facilitator from 2 on-call participant(s): <@U_ALICE>, <@U_BOB>"
    )
    expect(consoleSpy.mock.calls[1][0]).toMatch(/<@U_ALICE>|<@U_BOB>/)
    consoleSpy.mockRestore()
  })
})
