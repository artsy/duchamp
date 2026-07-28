import * as fs from "fs"

import { type BiweeklySchedule, isOffWeek } from "./biweekly"
import { currentOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import { zonedTimeToUtc } from "./shift-boundary"

const DEFAULT_TIME_ZONE = "America/New_York"
const DEFAULT_MEETING_WEEKDAY = 4 // Thursday
const DEFAULT_MEETING_HOUR = 11 // 11:30am ET (DST-aware via zonedTimeToUtc)
const DEFAULT_MEETING_MINUTE = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

const URLS = {
  incidentReviewSchedule:
    "https://www.notion.so/artsy/Incident-Reviews-725052225efc49e78532b13e166ba3c7",
}

export const buildPayload = (
  mention: string | undefined,
  onCallScheduleUrl: string
): string => {
  // currentOnCallUsers/usersToMentions can legitimately return nobody
  // mentionable (a schedule gap, or every on-call participant missing a
  // linked Slack account) — post an explicit notice instead of staying
  // silent.
  const text = mention
    ? `${mention} :wave:, based on the <${onCallScheduleUrl}|on-call schedule> you've been selected to _prepare for and facilitate_ the upcoming Incident Review meeting! :tada:\nCheck out the <${URLS.incidentReviewSchedule}|Incident Review Schedule> for more information and the next steps.`
    : `:warning: A facilitator should be picked for the upcoming Incident Review meeting, but nobody on the <${onCallScheduleUrl}|on-call schedule> can be reached on Slack (no linked account).`

  return JSON.stringify({
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
    ],
  })
}

interface CivilDate {
  year: number
  month: number // 1-12
  day: number
  weekday: number // 0 (Sun) - 6 (Sat), Date#getUTCDay convention
}

// Steps forward in UTC calendar days, not the meeting's actual ET civil day
// — a deliberate simplification, not an oversight. It's safe because the
// real triggers (14:00 UTC cron, or a manual run during business hours) are
// always mid-morning ET or later, nowhere near the UTC/ET day boundary, so
// the two calendars never disagree here.
const civilDatePlusDays = (now: Date, days: number): CivilDate => {
  const shifted = new Date(now.getTime() + days * MS_PER_DAY)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  }
}

const civilDateString = (date: CivilDate): string =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(
    date.day
  ).padStart(2, "0")}`

// Scans offset = 1..lookaheadDays days ahead of `now` (the meeting is always
// at least a day out from when this runs, whether by cron or manual
// dispatch) for the next date that either matches the regular biweekly
// on-week cadence of `meetingWeekday`, or is listed in `schedule.exceptions`
// (a deliberate catch-up review, any weekday). Returns the meeting's UTC
// instant — DST-aware via `zonedTimeToUtc` — or null if nothing qualifies
// within the window.
export const findMeetingInstant = (
  now: Date,
  meetingWeekday: number,
  meetingHour: number,
  meetingMinute: number,
  schedule: BiweeklySchedule,
  lookaheadDays: number,
  timeZone: string = DEFAULT_TIME_ZONE
): Date | null => {
  for (let offset = 1; offset <= lookaheadDays; offset++) {
    const candidate = civilDatePlusDays(now, offset)
    const dateString = civilDateString(candidate)
    const candidateMidnightUtc = new Date(
      Date.UTC(candidate.year, candidate.month - 1, candidate.day)
    )

    const isException = schedule.exceptions.includes(dateString)
    const isRegularOnWeekMeetingDay =
      candidate.weekday === meetingWeekday &&
      !isOffWeek(schedule, candidateMidnightUtc)

    if (isException || isRegularOnWeekMeetingDay) {
      return zonedTimeToUtc(
        candidate.year,
        candidate.month,
        candidate.day,
        meetingHour,
        meetingMinute,
        0,
        timeZone
      )
    }
  }

  return null
}

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} env var is not set.`)
  }
  return value
}

const readIntEnv = (
  name: string,
  defaultValue: number,
  range: { min: number; max: number }
): number => {
  const raw = process.env[name]
  const value = raw ? Number.parseInt(raw, 10) : defaultValue

  if (Number.isNaN(value) || value < range.min || value > range.max) {
    throw new Error(
      `Invalid ${name}: "${raw}". Must be an integer between ${range.min} and ${range.max}.`
    )
  }

  return value
}

const requireIntEnv = (
  name: string,
  range: { min: number; max: number }
): number => {
  const raw = requireEnv(name)
  const value = Number.parseInt(raw, 10)

  if (Number.isNaN(value) || value < range.min || value > range.max) {
    throw new Error(
      `Invalid ${name}: "${raw}". Must be an integer between ${range.min} and ${range.max}.`
    )
  }

  return value
}

const parseDates = (raw: string): BiweeklySchedule => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid DATES env var: ${error}`)
  }

  const { baseDate, exceptions } = (parsed ?? {}) as Partial<BiweeklySchedule>
  if (typeof baseDate !== "string" || !Array.isArray(exceptions)) {
    throw new Error(
      "Invalid DATES env var: expected JSON { baseDate: string, exceptions: string[] }."
    )
  }

  return { baseDate, exceptions }
}

// isOffWeek's parity math assumes `baseDate` and any date it's compared
// against fall on the same weekday, so they're always an exact multiple of
// 7 days apart (see the comment on isOffWeek in biweekly.ts). That's only
// actually true if baseDate falls on MEETING_WEEKDAY — an assumption that
// meeting-weekday and DATES, as independent workflow inputs, don't enforce
// on their own. Fail loudly here rather than silently computing the wrong
// on/off-week parity if the meeting day ever changes without updating
// baseDate to match.
const requireBaseDateMatchesMeetingWeekday = (
  schedule: BiweeklySchedule,
  meetingWeekday: number
): void => {
  const baseDateWeekday = new Date(
    `${schedule.baseDate}T00:00:00Z`
  ).getUTCDay()

  if (baseDateWeekday !== meetingWeekday) {
    throw new Error(
      `DATES.baseDate ("${schedule.baseDate}") falls on weekday ${baseDateWeekday}, but MEETING_WEEKDAY is ${meetingWeekday}. baseDate must fall on the same weekday as the configured meeting day — if the meeting day changed, update baseDate to a date on the new weekday too.`
    )
  }
}

export const main = async (): Promise<void> => {
  const apiKey = requireEnv("INCIDENT_IO_API_KEY")
  const scheduleId = requireEnv("SCHEDULE_ID")
  const meetingWeekday = readIntEnv(
    "MEETING_WEEKDAY",
    DEFAULT_MEETING_WEEKDAY,
    { min: 0, max: 6 }
  )
  const meetingHour = readIntEnv("MEETING_HOUR", DEFAULT_MEETING_HOUR, {
    min: 0,
    max: 23,
  })
  const meetingMinute = readIntEnv("MEETING_MINUTE", DEFAULT_MEETING_MINUTE, {
    min: 0,
    max: 59,
  })
  // Cron and manual-dispatch runs pass their own literal value here — cron
  // only ever needs to see 1 day ahead (the regular day-before-meeting
  // check); a rare manual catch-up run needs enough slack to reach an
  // off-week exception date on any weekday (e.g. triggered the Friday
  // before a Monday catch-up).
  const lookaheadDays = requireIntEnv("MEETING_LOOKAHEAD_DAYS", {
    min: 1,
    max: 13,
  })
  const schedule = parseDates(requireEnv("DATES"))
  requireBaseDateMatchesMeetingWeekday(schedule, meetingWeekday)

  const meetingInstant = findMeetingInstant(
    new Date(),
    meetingWeekday,
    meetingHour,
    meetingMinute,
    schedule,
    lookaheadDays
  )

  if (!meetingInstant) {
    console.log(
      "facilitate-incident-review: no qualifying Incident Review within the lookahead window — skipping."
    )
    return
  }

  const users = await currentOnCallUsers(apiKey, scheduleId, meetingInstant)
  const mentions = usersToMentions(users)
  const facilitatorMention =
    mentions.length > 0
      ? mentions[Math.floor(Math.random() * mentions.length)]
      : undefined

  const payload = buildPayload(facilitatorMention, scheduleUrl(scheduleId))

  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath) {
    const delimiter = `EOF_${Date.now()}`
    fs.appendFileSync(
      outputPath,
      `payload<<${delimiter}\n${payload}\n${delimiter}\n`
    )
  } else {
    console.log(payload)
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
