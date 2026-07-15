import type { EnrichedDeployChange } from "./enrich-changes"

export interface SlackDeployMessages {
  mainMessage: string
  threadMessage: string
}

function formatLinks(change: EnrichedDeployChange): string {
  const links: string[] = []

  if (change.prUrl) {
    links.push(`<${change.prUrl}|PR>`)
  }
  if (change.ticketUrl && change.ticketLabel) {
    links.push(`<${change.ticketUrl}|${change.ticketLabel}>`)
  }
  if (change.featureFlag) {
    if (change.featureFlag.url) {
      links.push(`<${change.featureFlag.url}|${change.featureFlag.name}>`)
    } else {
      links.push(change.featureFlag.name)
    }
  }

  return links.length > 0 ? ` (${links.join(" · ")})` : ""
}

function formatChangeLine(change: EnrichedDeployChange): string {
  const boldTitle = `*${change.title}*`
  const prefix = change.area ? `${change.area}: ${boldTitle}` : boldTitle
  return `${prefix} — ${change.description}${formatLinks(change)}`
}

function formatSection(
  header: string,
  changes: EnrichedDeployChange[]
): string | undefined {
  if (changes.length === 0) return undefined

  return [header, "", ...changes.map(formatChangeLine)].join("\n")
}

export function formatSlackMessages(
  projectName: string,
  deployPrUrl: string,
  changes: EnrichedDeployChange[]
): SlackDeployMessages {
  const features = changes.filter(change => change.category === "features")
  const fixes = changes.filter(change => change.category === "fixes")
  const improvements = changes.filter(
    change => change.category === "improvements-and-maintenance"
  )

  const mainLines = [
    `:rocket: A new batch of ${projectName} changes just went live (<${deployPrUrl}|PR>)!`,
    "",
  ]

  if (features.length > 0) {
    mainLines.push("New Features", "")
    for (const feature of features) {
      mainLines.push(formatChangeLine(feature))
    }
    mainLines.push("", "")
  }

  mainLines.push("Check the thread for fixes and improvements :thread:")

  const threadSections = [
    formatSection("Fixes", fixes),
    formatSection("Improvements & Maintenance", improvements),
  ].filter((section): section is string => section !== undefined)

  return {
    mainMessage: mainLines.join("\n").trim(),
    threadMessage: threadSections.join("\n\n\n").trim(),
  }
}
