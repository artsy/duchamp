import * as fs from "fs"
import { currentOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import { shiftBoundaryAnchor } from "./shift-boundary"
import { buildPayload, main } from "./standup-reminder"

jest.mock("fs")
jest.mock("./incident-io")
jest.mock("./shift-boundary")

const mockFs = fs as jest.Mocked<typeof fs>
const mockCurrentOnCallUsers = currentOnCallUsers as jest.Mock
const mockUsersToMentions = usersToMentions as jest.Mock
const mockScheduleUrl = scheduleUrl as jest.Mock
const mockShiftBoundaryAnchor = shiftBoundaryAnchor as jest.Mock

const ANCHOR = new Date("2026-07-13T14:59:59.000Z")

const SCHEDULE_URL =
  "https://app.incident.io/artsy/on-call/schedules/schedule-123"

describe("buildPayload", () => {
  it("preserves the standup reminder wording with mentions joined by 'and'", () => {
    const payload = JSON.parse(
      buildPayload(["<@U_ALICE>", "<@U_BOB>"], SCHEDULE_URL)
    )

    expect(payload.blocks).toHaveLength(1)
    const text = payload.blocks[0].text.text
    expect(text).toContain("Hi <@U_ALICE> and <@U_BOB> :wave:")
    expect(text).toContain(`<${SCHEDULE_URL}|on-call schedule>`)
    expect(text).toContain(
      "you've been chosen to facilitate today's Engineering Standup at 11:45am ET."
    )
    expect(text).toContain(
      "<https://github.com/artsy/README/blob/main/events/open-standup.md|on GitHub>"
    )
    expect(text).toContain(
      "<https://www.notion.so/artsy/Standup-Notes-28a5dfe4864645788de1ef936f39687c|in Notion>"
    )
  })

  it("handles a single mention", () => {
    const payload = JSON.parse(buildPayload(["<@U_ALICE>"], SCHEDULE_URL))

    expect(payload.blocks[0].text.text).toContain("Hi <@U_ALICE> :wave:")
  })
})

describe("main", () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, GITHUB_OUTPUT: undefined }
    mockCurrentOnCallUsers.mockResolvedValue([])
    mockUsersToMentions.mockReturnValue(["<@U_ALICE>"])
    mockScheduleUrl.mockReturnValue(SCHEDULE_URL)
    mockShiftBoundaryAnchor.mockReturnValue(ANCHOR)
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

  it("logs the payload to stdout when GITHUB_OUTPUT is unset", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(mockShiftBoundaryAnchor).toHaveBeenCalledWith({
      weekday: 1,
      hour: 11,
    })
    expect(mockCurrentOnCallUsers).toHaveBeenCalledWith(
      "test-key",
      "schedule-123",
      ANCHOR
    )
    expect(mockScheduleUrl).toHaveBeenCalledWith("schedule-123")
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy.mock.calls[0][0]).toContain("<@U_ALICE>")
    expect(consoleSpy.mock.calls[0][0]).toContain(SCHEDULE_URL)
    consoleSpy.mockRestore()
  })

  it("uses STANDUP_BOUNDARY_WEEKDAY/STANDUP_BOUNDARY_HOUR when set", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.STANDUP_BOUNDARY_WEEKDAY = "3"
    process.env.STANDUP_BOUNDARY_HOUR = "9"
    jest.spyOn(console, "log").mockImplementation()

    await main()

    expect(mockShiftBoundaryAnchor).toHaveBeenCalledWith({
      weekday: 3,
      hour: 9,
    })
  })

  it("throws when STANDUP_BOUNDARY_WEEKDAY is out of range", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.STANDUP_BOUNDARY_WEEKDAY = "7"

    await expect(main()).rejects.toThrow(
      'Invalid STANDUP_BOUNDARY_WEEKDAY: "7". Must be an integer between 0 and 6.'
    )
  })

  it("throws when STANDUP_BOUNDARY_HOUR is out of range", async () => {
    process.env.INCIDENT_IO_API_KEY = "test-key"
    process.env.SCHEDULE_ID = "schedule-123"
    process.env.STANDUP_BOUNDARY_HOUR = "24"

    await expect(main()).rejects.toThrow(
      'Invalid STANDUP_BOUNDARY_HOUR: "24". Must be an integer between 0 and 23.'
    )
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
