import * as fs from "fs"
import { nextOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import { buildPayload, main } from "./next-on-call"
import { nextShiftBoundaryInstant, weekdayInTimeZone } from "./shift-boundary"

jest.mock("fs")
jest.mock("./incident-io")
jest.mock("./shift-boundary")

const mockFs = fs as jest.Mocked<typeof fs>
const mockNextOnCallUsers = nextOnCallUsers as jest.Mock
const mockUsersToMentions = usersToMentions as jest.Mock
const mockScheduleUrl = scheduleUrl as jest.Mock
const mockNextShiftBoundaryInstant = nextShiftBoundaryInstant as jest.Mock
const mockWeekdayInTimeZone = weekdayInTimeZone as jest.Mock

const WINDOW_END = new Date("2026-08-03T15:00:00Z")

const SCHEDULE_URL =
  "https://app.incident.io/artsy/on-call/schedules/schedule-123"

describe("buildPayload", () => {
  it("mentions everyone with an upcoming shift and links the schedule and incident handling doc", () => {
    const payload = JSON.parse(
      buildPayload(["<@U_ALICE>", "<@U_BOB>"], SCHEDULE_URL)
    )

    expect(payload.blocks).toHaveLength(1)
    const text = payload.blocks[0].text.text
    expect(text).toContain("<@U_ALICE>, <@U_BOB>")
    expect(text).toContain("on-call shift coming up")
    expect(text).toContain(`<${SCHEDULE_URL}|on-call schedule>`)
    expect(text).toContain("Incident Handling doc")
  })

  it("handles a single mention", () => {
    const payload = JSON.parse(buildPayload(["<@U_ALICE>"], SCHEDULE_URL))

    expect(payload.blocks[0].text.text).toContain("<@U_ALICE> looks like")
  })
})

describe("main", () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, GITHUB_OUTPUT: undefined }
    mockNextOnCallUsers.mockResolvedValue([])
    mockUsersToMentions.mockReturnValue(["<@U_ALICE>"])
    mockScheduleUrl.mockReturnValue(SCHEDULE_URL)
    mockNextShiftBoundaryInstant.mockReturnValue(WINDOW_END)
    mockWeekdayInTimeZone.mockReturnValue(1) // Monday by default
  })

  afterEach(() => {
    process.env = originalEnv
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

  it("on a Monday run, targets the Friday safety cutoff (default weekday 5, hour 0)", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    mockWeekdayInTimeZone.mockReturnValue(1)
    jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(mockNextShiftBoundaryInstant).toHaveBeenCalledWith(
      { weekday: 5, hour: 0 },
      expect.any(Date)
    )
    expect(mockNextOnCallUsers).toHaveBeenCalledWith(
      "test-key",
      "schedule-123",
      expect.any(Date),
      WINDOW_END
    )
  })

  it("on a Thursday run, targets the rot-na/sa rotation boundary (default weekday 1, hour 11)", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    mockWeekdayInTimeZone.mockReturnValue(4)
    jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(mockNextShiftBoundaryInstant).toHaveBeenCalledWith(
      { weekday: 1, hour: 11 },
      expect.any(Date)
    )
  })

  it("throws when run on a weekday other than Monday or Thursday", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    mockWeekdayInTimeZone.mockReturnValue(3) // Wednesday

    await expect(main()).rejects.toThrow(
      "expected to run on weekday 1 (Monday) or 4 (Thursday)"
    )
  })

  it("respects NEXT_ON_CALL_RUN_WEEKDAY_OVERRIDE for testing on a different real day", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.NEXT_ON_CALL_RUN_WEEKDAY_OVERRIDE = "4"
    mockWeekdayInTimeZone.mockReturnValue(3) // real day would otherwise throw
    jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(mockNextShiftBoundaryInstant).toHaveBeenCalledWith(
      { weekday: 1, hour: 11 },
      expect.any(Date)
    )
  })

  it("respects rotation/safety cutoff overrides", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.NEXT_ON_CALL_ROTATION_BOUNDARY_WEEKDAY = "3"
    process.env.NEXT_ON_CALL_ROTATION_BOUNDARY_HOUR = "9"
    mockWeekdayInTimeZone.mockReturnValue(4)
    jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(mockNextShiftBoundaryInstant).toHaveBeenCalledWith(
      { weekday: 3, hour: 9 },
      expect.any(Date)
    )
  })

  it("throws when NEXT_ON_CALL_ROTATION_BOUNDARY_WEEKDAY is out of range", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.NEXT_ON_CALL_ROTATION_BOUNDARY_WEEKDAY = "7"

    await expect(main()).rejects.toThrow(
      'Invalid NEXT_ON_CALL_ROTATION_BOUNDARY_WEEKDAY: "7". Must be an integer between 0 and 6.'
    )
  })

  it("logs and skips without writing GITHUB_OUTPUT when no one has an upcoming shift", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.GITHUB_OUTPUT = "/tmp/fake-output"
    mockUsersToMentions.mockReturnValue([])
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("skipping Slack notification")
    )
    expect(mockFs.appendFileSync).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("logs the payload to stdout when GITHUB_OUTPUT is unset", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy.mock.calls[0][0]).toContain("<@U_ALICE>")
    consoleSpy.mockRestore()
  })

  it("writes the payload to GITHUB_OUTPUT using the heredoc delimiter form", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.GITHUB_OUTPUT = "/tmp/fake-output"
    mockFs.appendFileSync.mockImplementation(() => undefined)

    await main()

    expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1)
    const [outputPath, contents] = mockFs.appendFileSync.mock.calls[0]
    expect(outputPath).toBe("/tmp/fake-output")
    expect(contents).toMatch(/^payload<<EOF_\d+\n/)
    expect(contents).toContain("<@U_ALICE>")
  })
})
