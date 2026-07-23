import * as fs from "fs"

import { nextOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import { nextShiftBoundaryInstant } from "./shift-boundary"

const URLS = {
  incidentHandling:
    "https://app.notion.com/p/artsy/Incident-Handling-incident-io-edition-dcacab0764a08347addf015248667808#ceecab0764a082448dac814aa0c329d3",
}

export const buildPayload = (
  mentions: string[],
  onCallScheduleUrl: string
): string => {
  // mentions can legitimately be empty even when someone does have a shift
  // starting soon — usersToMentions drops anyone without a linked Slack
  // account (incident.io supports SAML SSO and Microsoft Teams as
  // alternatives to Slack, so this isn't just a hypothetical). Warn instead
  // of staying silent, so a missing Slack link surfaces rather than swallows
  // the reminder entirely.
  const text =
    mentions.length > 0
      ? `${mentions.join(
          ", "
        )} looks like you have an on-call shift coming up! Check out the <${
          onCallScheduleUrl
        }|on-call schedule> and the <${
          URLS.incidentHandling
        }|Incident Handling doc> to prep. You've got this! :+1:`
      : `:warning: Heads up — someone's on-call shift is starting soon, but they can't be reached on Slack (no linked account). Check the <${onCallScheduleUrl}|on-call schedule>.`

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

export const main = async (): Promise<void> => {
  const apiKey = requireEnv("INCIDENT_IO_API_KEY")
  const scheduleId = requireEnv("SCHEDULE_ID")

  // The caller — one job per cron day — supplies its own literal target.
  // E.g. the Thursday job passes the real rot-na/sa boundary (Monday, 11am
  // ET) tightly; the Monday job passes a generous safety cutoff (Friday,
  // midnight ET) with no rotation significance of its own, so a delayed
  // Thursday run is still covered. This script doesn't need to know which
  // is which, or which day it's actually running on.
  const targetWeekday = requireIntEnv("NEXT_ON_CALL_TARGET_WEEKDAY", {
    min: 0,
    max: 6,
  })
  const targetHour = requireIntEnv("NEXT_ON_CALL_TARGET_HOUR", {
    min: 0,
    max: 23,
  })

  const now = new Date()
  const windowEnd = nextShiftBoundaryInstant(
    { weekday: targetWeekday, hour: targetHour },
    now
  )

  const users = await nextOnCallUsers(apiKey, scheduleId, now, windowEnd)

  if (users.length === 0) {
    console.log(
      "next-on-call: no upcoming shifts starting in this window — skipping Slack notification."
    )
    return
  }

  const mentions = usersToMentions(users)
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
