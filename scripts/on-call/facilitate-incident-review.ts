import * as fs from "fs"

import { isOffWeek } from "./biweekly"
import { readIntEnv, requireEnv } from "./env"
import { currentOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import {
  civilDatePlusDays,
  civilDateTimeIn,
  MS_PER_DAY,
  zonedTimeToUtc,
} from "./shift-boundary"

const DEFAULT_TIME_ZONE = "America/New_York"
const DEFAULT_MEETING_WEEKDAY = 4 // Thursday
const DEFAULT_MEETING_HOUR = 11 // 11:30am ET (DST-aware via zonedTimeToUtc)
const DEFAULT_MEETING_MINUTE = 30

// Catches a future-direction year typo (e.g. 2027 for 2026) that the
// past-date check alone can't.
const MAX_OVERRIDE_DAYS_AHEAD = 60

const URLS = {
  incidentReviewSchedule:
    "https://www.notion.so/artsy/Incident-Reviews-725052225efc49e78532b13e166ba3c7",
}

export const buildPayload = (
  mention: string | undefined,
  onCallScheduleUrl: string
): string => {
  // A schedule gap or missing Slack links can mean nobody's mentionable —
  // post an explicit notice instead of staying silent.
  const text = mention
    ? `${mention} :wave:, based on the <${onCallScheduleUrl}|on-call schedule> you've been selected to _prepare for and facilitate_ the upcoming Incident Review meeting! :tada:\nCheck out the <${URLS.incidentReviewSchedule}|Incident Review Schedule> for more information and the next steps.`
    : `:warning: No one appears to be reachable on Slack according to our <${onCallScheduleUrl}|on-call schedule> — please make sure someone facilitates the upcoming Incident Review meeting.`

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

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Shared by MEETING_OVERRIDE_DATE and MEETING_BASE_DATE. Round-trips through
// Date.UTC to catch calendar-invalid dates (e.g. Feb 31) the regex alone
// would miss.
const parseCalendarDate = (
  envVarName: string,
  raw: string
): { year: number; month: number; day: number; canonical: string } => {
  const trimmed = raw.trim()
  if (!CALENDAR_DATE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid ${envVarName}: "${raw}". Must be YYYY-MM-DD.`)
  }
  const [year, month, day] = trimmed.split("-").map(Number)

  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  const roundTripString = `${roundTrip.getUTCFullYear()}-${String(
    roundTrip.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(roundTrip.getUTCDate()).padStart(2, "0")}`
  if (roundTripString !== trimmed) {
    throw new Error(
      `Invalid ${envVarName}: "${raw}" is not a real calendar date.`
    )
  }

  return { year, month, day, canonical: trimmed }
}

// Resolves the instant to query on-call at. An override (rare manual
// catch-up) always wins, bypassing the biweekly on/off-week check; it must
// resolve to a future instant within MAX_OVERRIDE_DAYS_AHEAD. Otherwise this
// is the routine cron path: it runs the day before the meeting, computing
// "tomorrow" via `civilDateTimeIn`/`civilDatePlusDays` rather than raw UTC
// arithmetic, since a cron's UTC firing instant can land on a different
// calendar day than its `timeZone` civil date. Returns null (skip) on an
// off-week; doesn't search further ahead since next week's cron run checks
// again on its own.
export const resolveMeetingInstant = (
  now: Date,
  meetingWeekday: number,
  meetingHour: number,
  meetingMinute: number,
  baseDate: string,
  overrideDate: string | undefined,
  timeZone: string = DEFAULT_TIME_ZONE
): Date | null => {
  if (overrideDate) {
    const { year, month, day } = parseCalendarDate(
      "MEETING_OVERRIDE_DATE",
      overrideDate
    )
    const overrideInstant = zonedTimeToUtc(
      year,
      month,
      day,
      meetingHour,
      meetingMinute,
      0,
      timeZone
    )

    if (overrideInstant.getTime() <= now.getTime()) {
      throw new Error(
        `MEETING_OVERRIDE_DATE "${overrideDate}" resolves to ${overrideInstant.toISOString()}, which is not after now (${now.toISOString()}). The override must target a future meeting.`
      )
    }

    const maxOverrideInstant = new Date(
      now.getTime() + MAX_OVERRIDE_DAYS_AHEAD * MS_PER_DAY
    )
    if (overrideInstant.getTime() > maxOverrideInstant.getTime()) {
      throw new Error(
        `MEETING_OVERRIDE_DATE "${overrideDate}" resolves to ${overrideInstant.toISOString()}, which is more than ${MAX_OVERRIDE_DAYS_AHEAD} days from now (${now.toISOString()}). Double-check the year — this is meant for a near-term catch-up, not a far-future date.`
      )
    }

    return overrideInstant
  }

  const today = civilDateTimeIn(timeZone, now)
  const tomorrow = civilDatePlusDays(timeZone, today, 1)

  if (tomorrow.weekday !== meetingWeekday) {
    throw new Error(
      `resolveMeetingInstant expected tomorrow (in ${timeZone}) to be weekday ${meetingWeekday}, but it's ${tomorrow.weekday}. Check the cron schedule against MEETING_WEEKDAY, or set MEETING_OVERRIDE_DATE to target a specific date directly.`
    )
  }

  const midnightUtc = new Date(
    Date.UTC(tomorrow.year, tomorrow.month - 1, tomorrow.day)
  )

  if (isOffWeek(baseDate, midnightUtc)) {
    return null
  }

  return zonedTimeToUtc(
    tomorrow.year,
    tomorrow.month,
    tomorrow.day,
    meetingHour,
    meetingMinute,
    0,
    timeZone
  )
}

// isOffWeek's parity math (biweekly.ts) assumes baseDate falls on
// meetingWeekday — an invariant these two independent inputs don't enforce
// on their own, so fail loudly here instead of silently computing the wrong
// parity.
const requireValidBaseDate = (
  rawBaseDate: string,
  meetingWeekday: number
): string => {
  const { year, month, day, canonical } = parseCalendarDate(
    "MEETING_BASE_DATE",
    rawBaseDate
  )
  const baseDateWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  if (baseDateWeekday !== meetingWeekday) {
    throw new Error(
      `MEETING_BASE_DATE ("${canonical}") falls on weekday ${baseDateWeekday}, but MEETING_WEEKDAY is ${meetingWeekday}. baseDate must fall on the same weekday as the configured meeting day — if the meeting day changed, update baseDate to a date on the new weekday too.`
    )
  }

  return canonical
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
  const rawBaseDate = requireEnv("MEETING_BASE_DATE")
  // Trimmed so a blank workflow_dispatch input doesn't count as "set."
  const overrideDate = process.env.MEETING_OVERRIDE_DATE?.trim() || undefined
  // The override path never touches baseDate, so a base-date/weekday drift
  // shouldn't block an otherwise-valid manual catch-up run.
  const baseDate = overrideDate
    ? rawBaseDate
    : requireValidBaseDate(rawBaseDate, meetingWeekday)

  const meetingInstant = resolveMeetingInstant(
    new Date(),
    meetingWeekday,
    meetingHour,
    meetingMinute,
    baseDate,
    overrideDate
  )

  if (!meetingInstant) {
    console.log(
      "facilitate-incident-review: no qualifying Incident Review — skipping."
    )
    return
  }

  const users = await currentOnCallUsers(apiKey, scheduleId, meetingInstant)
  const mentions = usersToMentions(users)
  console.log(
    `facilitate-incident-review: choosing a facilitator from ${mentions.length} on-call participant(s): ${mentions.join(", ") || "none"}`
  )
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
