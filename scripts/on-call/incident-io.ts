const INCIDENT_IO_BASE_URL = "https://api.incident.io/v2"
const INCIDENT_IO_APP_SCHEDULES_URL =
  "https://app.incident.io/artsy/on-call/schedules"

// A gap this small around "now" absorbs clock skew/request latency without
// risking that the window drifts into the next shift.
const CURRENT_SHIFT_WINDOW_PADDING_MS = 60_000

// incident.io's entry_window_end appears to be exclusive at the exact
// instant: an entry whose start_at lands precisely on entry_window_end was
// observed missing from `final` in a real query against production schedule
// data. This small forward margin ensures a caller's intended boundary
// instant is still captured.
const NEXT_SHIFT_LOOKAHEAD_PADDING_MS = 60_000

export interface IncidentIoUser {
  id: string
  name: string
  email: string
  slack_user_id?: string
}

export interface ScheduleEntry {
  entry_id: string
  fingerprint: string
  rotation_id?: string
  layer_id?: string
  start_at: string
  end_at: string
  user: IncidentIoUser
}

interface ScheduleEntriesResponse {
  schedule_entries: {
    scheduled: ScheduleEntry[]
    overrides: ScheduleEntry[]
    final: ScheduleEntry[]
  }
}

export const fetchScheduleEntries = async (
  apiKey: string,
  scheduleId: string,
  entryWindowStart: Date,
  entryWindowEnd: Date
): Promise<ScheduleEntry[]> => {
  const url = new URL(`${INCIDENT_IO_BASE_URL}/schedule_entries`)
  url.searchParams.set("schedule_id", scheduleId)
  url.searchParams.set("entry_window_start", entryWindowStart.toISOString())
  url.searchParams.set("entry_window_end", entryWindowEnd.toISOString())

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  })

  if (!response.ok) {
    throw new Error(
      `incident.io schedule_entries request failed: ${response.status} ${response.statusText}`
    )
  }

  const body = (await response.json()) as ScheduleEntriesResponse
  return body.schedule_entries.final
}

const dedupeUsersById = (users: IncidentIoUser[]): IncidentIoUser[] => {
  const byId = new Map(users.map(user => [user.id, user]))
  return Array.from(byId.values())
}

// incident.io has no "who's on call right now" endpoint: the `final` array for
// an omitted/wide window can include entries that aren't active at the moment
// of the request. So we ask for a tight window straddling `now` and then
// filter to entries whose [start_at, end_at) actually contains `now`.
export const currentOnCallUsers = async (
  apiKey: string,
  scheduleId: string,
  now: Date = new Date()
): Promise<IncidentIoUser[]> => {
  const windowEnd = new Date(now.getTime() + CURRENT_SHIFT_WINDOW_PADDING_MS)
  const entries = await fetchScheduleEntries(apiKey, scheduleId, now, windowEnd)

  const active = entries.filter(entry => {
    const startsBeforeOrAtNow = Date.parse(entry.start_at) <= now.getTime()
    const endsAfterNow = now.getTime() < Date.parse(entry.end_at)
    return startsBeforeOrAtNow && endsAfterNow
  })

  return dedupeUsersById(active.map(entry => entry.user))
}

// Entries whose shift has not yet started as of `now` — i.e. upcoming shifts
// someone should get a heads-up about, whether regularly scheduled or an
// override. `windowEnd` is the caller's intended boundary instant (e.g. from
// `nextShiftBoundaryInstant`); a small forward margin is added internally so
// an entry starting exactly at that instant is still included.
export const nextOnCallUsers = async (
  apiKey: string,
  scheduleId: string,
  now: Date,
  windowEnd: Date
): Promise<IncidentIoUser[]> => {
  const paddedWindowEnd = new Date(
    windowEnd.getTime() + NEXT_SHIFT_LOOKAHEAD_PADDING_MS
  )
  const entries = await fetchScheduleEntries(
    apiKey,
    scheduleId,
    now,
    paddedWindowEnd
  )

  const upcoming = entries.filter(
    entry => now.getTime() < Date.parse(entry.start_at)
  )

  return dedupeUsersById(upcoming.map(entry => entry.user))
}

export const scheduleUrl = (scheduleId: string): string =>
  `${INCIDENT_IO_APP_SCHEDULES_URL}/${scheduleId}`

export const usersToMentions = (users: IncidentIoUser[]): string[] =>
  users
    .filter((user): user is IncidentIoUser & { slack_user_id: string } =>
      Boolean(user.slack_user_id)
    )
    .map(user => `<@${user.slack_user_id}>`)
