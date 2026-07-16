import {
  currentOnCallUsers,
  fetchScheduleEntries,
  type IncidentIoUser,
  type ScheduleEntry,
  scheduleUrl,
  usersToMentions,
} from "./incident-io"

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Error",
  json: async () => body,
})

const user = (overrides: Partial<IncidentIoUser> = {}): IncidentIoUser => ({
  id: "user-1",
  name: "Alice",
  email: "alice@artsy.net",
  slack_user_id: "U_ALICE",
  ...overrides,
})

const entry = (overrides: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  entry_id: "entry-1",
  fingerprint: "fingerprint-1",
  start_at: "2026-07-15T14:00:00Z",
  end_at: "2026-07-15T15:00:00Z",
  user: user(),
  ...overrides,
})

describe("fetchScheduleEntries", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it("requests the schedule_entries endpoint with schedule_id and an explicit window", async () => {
    const mockFetch = global.fetch as jest.Mock
    mockFetch.mockResolvedValue(
      jsonResponse({
        schedule_entries: { scheduled: [], overrides: [], final: [entry()] },
      })
    )

    const start = new Date("2026-07-15T14:00:00Z")
    const end = new Date("2026-07-15T14:01:00Z")
    const result = await fetchScheduleEntries(
      "test-api-key",
      "schedule-123",
      start,
      end
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    const requestUrl = new URL(url)
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.incident.io/v2/schedule_entries"
    )
    expect(requestUrl.searchParams.get("schedule_id")).toBe("schedule-123")
    expect(requestUrl.searchParams.get("entry_window_start")).toBe(
      start.toISOString()
    )
    expect(requestUrl.searchParams.get("entry_window_end")).toBe(
      end.toISOString()
    )
    expect(options.headers.Authorization).toBe("Bearer test-api-key")
    expect(result).toEqual([entry()])
  })

  it("throws when the response is not ok", async () => {
    const mockFetch = global.fetch as jest.Mock
    mockFetch.mockResolvedValue(jsonResponse({}, false, 401))

    await expect(
      fetchScheduleEntries("bad-key", "schedule-123", new Date(), new Date())
    ).rejects.toThrow("incident.io schedule_entries request failed: 401")
  })
})

describe("currentOnCallUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it("returns only entries whose window actually contains now", async () => {
    const now = new Date("2026-07-15T14:30:00Z")
    const active = entry({
      start_at: "2026-07-15T14:00:00Z",
      end_at: "2026-07-15T15:00:00Z",
      user: user({ id: "active-user" }),
    })
    const notYetStarted = entry({
      start_at: "2026-07-15T15:00:00Z",
      end_at: "2026-07-15T16:00:00Z",
      user: user({ id: "future-user" }),
    })
    const mockFetch = global.fetch as jest.Mock
    mockFetch.mockResolvedValue(
      jsonResponse({
        schedule_entries: {
          scheduled: [],
          overrides: [],
          final: [active, notYetStarted],
        },
      })
    )

    const result = await currentOnCallUsers("api-key", "schedule-123", now)

    expect(result).toEqual([active.user])
  })

  it("dedupes users appearing in multiple concurrent entries", async () => {
    const now = new Date("2026-07-15T14:30:00Z")
    const sharedUser = user({ id: "shared-user" })
    const mockFetch = global.fetch as jest.Mock
    mockFetch.mockResolvedValue(
      jsonResponse({
        schedule_entries: {
          scheduled: [],
          overrides: [],
          final: [
            entry({ entry_id: "a", layer_id: "layer-1", user: sharedUser }),
            entry({ entry_id: "b", layer_id: "layer-2", user: sharedUser }),
          ],
        },
      })
    )

    const result = await currentOnCallUsers("api-key", "schedule-123", now)

    expect(result).toEqual([sharedUser])
  })
})

describe("scheduleUrl", () => {
  it("builds the incident.io schedule URL from a schedule ID", () => {
    expect(scheduleUrl("01K9G0DQWFHCVQTHZ3FAYEV2VH")).toBe(
      "https://app.incident.io/artsy/on-call/schedules/01K9G0DQWFHCVQTHZ3FAYEV2VH"
    )
  })
})

describe("usersToMentions", () => {
  it("maps users with a slack_user_id to Slack mention syntax", () => {
    const result = usersToMentions([
      user({ slack_user_id: "U_ALICE" }),
      user({ id: "user-2", slack_user_id: "U_BOB" }),
    ])

    expect(result).toEqual(["<@U_ALICE>", "<@U_BOB>"])
  })

  it("skips users without a slack_user_id", () => {
    const result = usersToMentions([
      user({ slack_user_id: undefined }),
      user({ id: "user-2", slack_user_id: "U_BOB" }),
    ])

    expect(result).toEqual(["<@U_BOB>"])
  })
})
