import * as fs from "fs"

import { isOffWeek } from "./biweekly"
import { readIntEnv, requireEnv } from "./env"
import { currentOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import {
  civilDatePlusDays,
  civilDateTimeIn,
  zonedTimeToUtc,
} from "./shift-boundary"

const DEFAULT_TIME_ZONE = "America/New_York"
const DEFAULT_MEETING_WEEKDAY = 4 // Thursday
const DEFAULT_MEETING_HOUR = 11 // 11:30am ET (DST-aware via zonedTimeToUtc)
const DEFAULT_MEETING_MINUTE = 30

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

const OVERRIDE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const parseOverrideDate = (
  raw: string
): { year: number; month: number; day: number } => {
  if (!OVERRIDE_DATE_PATTERN.test(raw)) {
    throw new Error(
      `Invalid MEETING_OVERRIDE_DATE: "${raw}". Must be YYYY-MM-DD.`
    )
  }
  const [year, month, day] = raw.split("-").map(Number)

  // Date.UTC silently rolls over out-of-range values (e.g. Feb 31 becomes
  // Mar 3) instead of rejecting them — round-tripping back to a string
  // catches a typo in this hand-typed, workflow_dispatch-entered value that
  // the regex above can't.
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  const roundTripString = `${roundTrip.getUTCFullYear()}-${String(
    roundTrip.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(roundTrip.getUTCDate()).padStart(2, "0")}`
  if (roundTripString !== raw) {
    throw new Error(
      `Invalid MEETING_OVERRIDE_DATE: "${raw}" is not a real calendar date.`
    )
  }

  return { year, month, day }
}

// Resolves the instant to query on-call at.
//
// If `overrideDate` is supplied (a rare manual catch-up run), targets that
// date directly — an explicit override always means "run now," bypassing
// the biweekly on/off-week check entirely.
//
// Otherwise, this is the routine cron path: it always runs the day before
// the meeting, in `timeZone` civil time. "Tomorrow" is computed via
// `civilDateTimeIn`/`civilDatePlusDays` rather than raw UTC arithmetic,
// because a cron's UTC firing instant can already be on a different UTC
// calendar date than its `timeZone` civil date (e.g. a cron meant for
// "Wednesday evening ET" fires at 2am UTC Thursday) — naive UTC-day-plus-one
// would compound that offset instead of correcting for it. Throws if
// tomorrow isn't `meetingWeekday` at all — the same class of misconfigured
// cron-vs-boundary mismatch `shiftBoundaryAnchor` guards against — but
// returns null (skip) for the legitimate, expected case of an off-week. It
// deliberately doesn't search further ahead; if this week is off, next
// week's cron run checks again on its own.
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
    const { year, month, day } = parseOverrideDate(overrideDate)
    return zonedTimeToUtc(
      year,
      month,
      day,
      meetingHour,
      meetingMinute,
      0,
      timeZone
    )
  }

  const today = civilDateTimeIn(timeZone, now)
  const tomorrow = civilDatePlusDays(timeZone, today, 1)

  if (tomorrow.weekday !== meetingWeekday) {
    throw new Error(
      `resolveMeetingInstant expected tomorrow (in ${timeZone}) to be weekday ${meetingWeekday}, but it's ${tomorrow.weekday}. Check the cron schedule against MEETING_WEEKDAY.`
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

// isOffWeek's parity math assumes `baseDate` and any date it's compared
// against fall on the same weekday, so they're always an exact multiple of
// 7 days apart (see the comment on isOffWeek in biweekly.ts). That's only
// actually true if baseDate falls on MEETING_WEEKDAY — an assumption that
// meeting-weekday and base-date, as independent workflow inputs, don't
// enforce on their own. Fail loudly here rather than silently computing the
// wrong on/off-week parity if the meeting day ever changes without updating
// baseDate to match.
const requireBaseDateMatchesMeetingWeekday = (
  baseDate: string,
  meetingWeekday: number
): void => {
  const baseDateWeekday = new Date(`${baseDate}T00:00:00Z`).getUTCDay()

  if (baseDateWeekday !== meetingWeekday) {
    throw new Error(
      `MEETING_BASE_DATE ("${baseDate}") falls on weekday ${baseDateWeekday}, but MEETING_WEEKDAY is ${meetingWeekday}. baseDate must fall on the same weekday as the configured meeting day — if the meeting day changed, update baseDate to a date on the new weekday too.`
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
  const baseDate = requireEnv("MEETING_BASE_DATE")
  requireBaseDateMatchesMeetingWeekday(baseDate, meetingWeekday)
  // Only set for a rare manual catch-up run — see resolveMeetingInstant.
  const overrideDate = process.env.MEETING_OVERRIDE_DATE || undefined

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
