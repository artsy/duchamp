import * as fs from "fs"

import { currentOnCallUsers, scheduleUrl, usersToMentions } from "./incident-io"
import { shiftBoundaryAnchor } from "./shift-boundary"

const DEFAULT_BOUNDARY_WEEKDAY = 1 // Monday
const DEFAULT_BOUNDARY_HOUR = 11 // 11am ET

const URLS = {
  standup: "https://github.com/artsy/README/blob/main/events/open-standup.md",
  notes:
    "https://www.notion.so/artsy/Standup-Notes-28a5dfe4864645788de1ef936f39687c",
}

export const buildPayload = (
  mentions: string[],
  onCallScheduleUrl: string
): string =>
  JSON.stringify({
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hi ${mentions.join(" and ")} :wave:\n\nBased on our <${
            onCallScheduleUrl
          }|on-call schedule>, you've been chosen to facilitate today's Engineering Standup at 11:45am ET. Please refer to the docs <${
            URLS.standup
          }|on GitHub> and add new standup notes <${URLS.notes}|in Notion>.`,
        },
      },
    ],
  })

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
  const boundaryWeekday = readIntEnv(
    "STANDUP_BOUNDARY_WEEKDAY",
    DEFAULT_BOUNDARY_WEEKDAY,
    { min: 0, max: 6 }
  )
  const boundaryHour = readIntEnv(
    "STANDUP_BOUNDARY_HOUR",
    DEFAULT_BOUNDARY_HOUR,
    {
      min: 0,
      max: 23,
    }
  )

  const anchor = shiftBoundaryAnchor({
    weekday: boundaryWeekday,
    hour: boundaryHour,
  })
  const users = await currentOnCallUsers(apiKey, scheduleId, anchor)
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
