import * as fs from "fs"

import { nextOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import { nextShiftBoundaryInstant, weekdayInTimeZone } from "./shift-boundary"

const DEFAULT_TIME_ZONE = "America/New_York"

// Which weekday (0-6) the joule cron's two firings correspond to. These are
// tied to the workflow's own cron schedule (`MON,THU`) rather than exposed as
// inputs — changing which days this runs on would require code changes here
// regardless (the target boundaries below are specific to the rotation
// cadence, not just "whichever two days the cron happens to use").
const MONDAY_RUN_WEEKDAY = 1
const THURSDAY_RUN_WEEKDAY = 4

// The rot-na/sa weekly handoff — the actual shift-change boundary. The
// Thursday run targets this directly (tight, since it's the real boundary).
const DEFAULT_ROTATION_BOUNDARY_WEEKDAY = 1 // Monday
const DEFAULT_ROTATION_BOUNDARY_HOUR = 11 // 11am ET

// A generous cutoff with no rotation significance of its own. The Monday run
// targets this instead of the rot-eu/uk Wednesday boundary directly, so that
// it still covers anything starting right up to (and a bit past) when the
// Thursday run is due to fire, even if that run ends up delayed.
const DEFAULT_SAFETY_CUTOFF_WEEKDAY = 5 // Friday
const DEFAULT_SAFETY_CUTOFF_HOUR = 0 // midnight ET (start of Friday)

const URLS = {
  incidentHandling:
    "https://app.notion.com/p/artsy/Incident-Handling-incident-io-edition-dcacab0764a08347addf015248667808#ceecab0764a082448dac814aa0c329d3",
}

export const buildPayload = (
  mentions: string[],
  onCallScheduleUrl: string
): string => {
  const text = `${mentions.join(
    ", "
  )} looks like you have an on-call shift coming up! Check out the <${
    onCallScheduleUrl
  }|on-call schedule> and the <${
    URLS.incidentHandling
  }|Incident Handling doc> to prep. You've got this! :+1:`

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

export const main = async (): Promise<void> => {
  const apiKey = requireEnv("INCIDENT_IO_API_KEY")
  const scheduleId = requireEnv("SCHEDULE_ID")

  const rotationBoundaryWeekday = readIntEnv(
    "NEXT_ON_CALL_ROTATION_BOUNDARY_WEEKDAY",
    DEFAULT_ROTATION_BOUNDARY_WEEKDAY,
    { min: 0, max: 6 }
  )
  const rotationBoundaryHour = readIntEnv(
    "NEXT_ON_CALL_ROTATION_BOUNDARY_HOUR",
    DEFAULT_ROTATION_BOUNDARY_HOUR,
    { min: 0, max: 23 }
  )
  const safetyCutoffWeekday = readIntEnv(
    "NEXT_ON_CALL_SAFETY_CUTOFF_WEEKDAY",
    DEFAULT_SAFETY_CUTOFF_WEEKDAY,
    { min: 0, max: 6 }
  )
  const safetyCutoffHour = readIntEnv(
    "NEXT_ON_CALL_SAFETY_CUTOFF_HOUR",
    DEFAULT_SAFETY_CUTOFF_HOUR,
    { min: 0, max: 23 }
  )

  const now = new Date()

  // Overridable for local/manual testing on a day other than the real
  // Monday/Thursday cron firings (mirrors STANDUP_BOUNDARY_WEEKDAY's role in
  // standup-reminder.ts).
  const runWeekday = readIntEnv(
    "NEXT_ON_CALL_RUN_WEEKDAY_OVERRIDE",
    weekdayInTimeZone(DEFAULT_TIME_ZONE, now),
    { min: 0, max: 6 }
  )

  let windowEnd: Date
  if (runWeekday === MONDAY_RUN_WEEKDAY) {
    windowEnd = nextShiftBoundaryInstant(
      { weekday: safetyCutoffWeekday, hour: safetyCutoffHour },
      now
    )
  } else if (runWeekday === THURSDAY_RUN_WEEKDAY) {
    windowEnd = nextShiftBoundaryInstant(
      { weekday: rotationBoundaryWeekday, hour: rotationBoundaryHour },
      now
    )
  } else {
    throw new Error(
      `next-on-call expected to run on weekday ${MONDAY_RUN_WEEKDAY} (Monday) or ${THURSDAY_RUN_WEEKDAY} (Thursday) in ${DEFAULT_TIME_ZONE}, but it's ${runWeekday}. Set NEXT_ON_CALL_RUN_WEEKDAY_OVERRIDE to test on a different day.`
    )
  }

  const users = await nextOnCallUsers(apiKey, scheduleId, now, windowEnd)
  const mentions = usersToMentions(users)

  if (mentions.length === 0) {
    console.log(
      "next-on-call: no upcoming shifts starting in this window — skipping Slack notification."
    )
    return
  }

  const payload = buildPayload(mentions, scheduleUrl(scheduleId))

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
