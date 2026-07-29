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

// Catch-ups are a near-term, days-to-weeks-out scenario — never months away —
// so this also catches a hand-typed year typo (e.g. 2027 instead of 2026)
// that the past-date check alone can't, since a typo in the future direction
// still passes that check but would silently leave the real, near-term
// meeting without a facilitator.
const MAX_OVERRIDE_DAYS_AHEAD = 60

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

// Validates a hand-typed YYYY-MM-DD env var, shared by MEETING_OVERRIDE_DATE
// and MEETING_BASE_DATE since both are hand-typed the same way and deserve
// the same failure mode. Date.UTC silently rolls over out-of-range values
// (e.g. Feb 31 becomes Mar 3) instead of rejecting them — round-tripping
// back to a string catches a typo the regex above can't.
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

// Resolves the instant to query on-call at.
//
// If `overrideDate` is supplied (a rare manual catch-up run), targets that
// date directly — an explicit override always means "run now," bypassing
// the biweekly on/off-week check entirely. Throws if it resolves to an
// instant that isn't strictly in the future, since a past override would
// otherwise silently query on-call for, and post a facilitator notice about,
// a meeting that's already happened. Also throws if it's more than
// `MAX_OVERRIDE_DAYS_AHEAD` out, since a hand-typed year typo in the future
// direction (e.g. 2027 instead of 2026) would otherwise pass the past-date
// check but still leave the real, near-term meeting without a facilitator.
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

// Validates MEETING_BASE_DATE's format (the same hand-typed YYYY-MM-DD check
// as MEETING_OVERRIDE_DATE — without it, a malformed value like "2026-02-31"
// produces a confusing "falls on weekday NaN" error instead of a clear
// format complaint) and returns the canonical (trimmed) string to use
// downstream.
//
// isOffWeek's parity math assumes `baseDate` and any date it's compared
// against fall on the same weekday, so they're always an exact multiple of
// 7 days apart (see the comment on isOffWeek in biweekly.ts). That's only
// actually true if baseDate falls on MEETING_WEEKDAY — an assumption that
// meeting-weekday and base-date, as independent workflow inputs, don't
// enforce on their own. Fail loudly here rather than silently computing the
// wrong on/off-week parity if the meeting day ever changes without updating
// baseDate to match.
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
  // Only set for a rare manual catch-up run — see resolveMeetingInstant.
  // Trimmed before the truthiness check so a whitespace-only value (e.g. a
  // blank workflow_dispatch input) falls through to the routine path
  // instead of being treated as "an override is set."
  const overrideDate = process.env.MEETING_OVERRIDE_DATE?.trim() || undefined
  // MEETING_BASE_DATE is still required to be present either way, but its
  // format/weekday validity only matters on the routine path — the override
  // path never touches baseDate at all (resolveMeetingInstant skips the
  // biweekly parity check entirely once overrideDate is set), so a
  // base-date/weekday drift shouldn't block an otherwise-valid manual
  // catch-up run.
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
