import * as fs from "fs"
import { type BiweeklySchedule } from "./biweekly"
import {
  buildPayload,
  findMeetingInstant,
  main,
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

// Real joule DATES repo var; 2026-07-16 confirmed by the user as a real
// Incident Review day, 2026-07-23/2026-07-22 confirmed off-week.
const REAL_SCHEDULE: BiweeklySchedule = {
  baseDate: "2023-04-27",
  exceptions: [],
}

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

describe("findMeetingInstant", () => {
  it("finds tomorrow's on-week Thursday meeting with a 1-day cron lookahead", () => {
    // Wednesday 2026-07-15, an on-week per the real baseDate; the cron only
    // ever needs to see 1 day ahead.
    const now = new Date("2026-07-15T14:00:00Z")

    const instant = findMeetingInstant(now, 4, 11, 30, REAL_SCHEDULE, 1)

    // 2026-07-16 is EDT (UTC-4): 11:30am ET -> 3:30pm UTC.
    expect(instant?.toISOString()).toBe("2026-07-16T15:30:00.000Z")
  })

  it("returns null on an off-week with a 1-day cron lookahead and no exception", () => {
    // Wednesday 2026-07-22, an off-week; tomorrow (2026-07-23) has no review.
    const now = new Date("2026-07-22T14:00:00Z")

    const instant = findMeetingInstant(now, 4, 11, 30, REAL_SCHEDULE, 1)

    expect(instant).toBeNull()
  })

  it("finds a Monday catch-up exception with a wider manual-trigger lookahead", () => {
    // Friday 2026-07-24, an off-week catch-up scheduled for Monday
    // 2026-07-27 (a weekday that doesn't match the regular Thursday cadence
    // at all) -- triggered 3 days ahead, within a 6-day manual lookahead.
    const now = new Date("2026-07-24T14:00:00Z")
    const schedule: BiweeklySchedule = {
      ...REAL_SCHEDULE,
      exceptions: ["2026-07-27"],
    }

    const instant = findMeetingInstant(now, 4, 11, 30, schedule, 6)

    // 2026-07-27 is still EDT: 11:30am ET -> 3:30pm UTC.
    expect(instant?.toISOString()).toBe("2026-07-27T15:30:00.000Z")
  })

  it("returns null when nothing qualifies within the lookahead window", () => {
    // Same off-week Friday, but no exception configured and the lookahead
    // stays short of reaching any on-week Thursday.
    const now = new Date("2026-07-24T14:00:00Z")

    const instant = findMeetingInstant(now, 4, 11, 30, REAL_SCHEDULE, 3)

    expect(instant).toBeNull()
  })

  it("resolves the meeting hour/minute DST-aware for the candidate's own date", () => {
    // baseDate === the candidate itself, so weeksSince = 0 (on-week),
    // isolating this test from the real production parity data.
    const winterSchedule: BiweeklySchedule = {
      baseDate: "2027-01-07", // Thursday, EST (UTC-5)
      exceptions: [],
    }
    const now = new Date("2027-01-06T14:00:00Z") // Wednesday before

    const instant = findMeetingInstant(now, 4, 11, 30, winterSchedule, 1)

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
      DATES: JSON.stringify(REAL_SCHEDULE),
      MEETING_LOOKAHEAD_DAYS: "1",
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

  it("throws when MEETING_LOOKAHEAD_DAYS is not set", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    delete process.env.MEETING_LOOKAHEAD_DAYS

    await expect(main()).rejects.toThrow(
      "MEETING_LOOKAHEAD_DAYS env var is not set."
    )
  })

  it("throws when DATES is not set", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    delete process.env.DATES

    await expect(main()).rejects.toThrow("DATES env var is not set.")
  })

  it("throws when DATES is malformed JSON", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.DATES = "not json"

    await expect(main()).rejects.toThrow("Invalid DATES env var")
  })

  it("throws when DATES is missing required fields", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.DATES = JSON.stringify({ baseDate: "2023-04-27" })

    await expect(main()).rejects.toThrow("Invalid DATES env var")
  })

  it("throws when DATES.baseDate's weekday doesn't match MEETING_WEEKDAY", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    // 2023-04-27 is a Thursday (weekday 4); configuring Wednesday (3) here
    // simulates the meeting day changing without baseDate being updated.
    process.env.MEETING_WEEKDAY = "3"

    await expect(main()).rejects.toThrow(
      'DATES.baseDate ("2023-04-27") falls on weekday 4, but MEETING_WEEKDAY is 3'
    )
  })

  it("logs and skips without writing GITHUB_OUTPUT on an off-week with no exception", async () => {
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

  it("logs the payload to stdout when GITHUB_OUTPUT is unset", async () => {
    jest.setSystemTime(new Date("2026-07-15T14:00:00Z"))
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy.mock.calls[0][0]).toContain("<@U_ALICE>")
    consoleSpy.mockRestore()
  })
})
