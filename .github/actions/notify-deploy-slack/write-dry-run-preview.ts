import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { SlackDeployMessages } from "./format-slack-message"

export interface DryRunPreviewOptions {
  projectName: string
  deployPrUrl: string
  deployPrNumber: number
  slackChannel: string
  changeCount: number
  messages: SlackDeployMessages
  outputPath: string
}

export function formatDryRunMarkdown(options: DryRunPreviewOptions): string {
  const {
    projectName,
    deployPrUrl,
    deployPrNumber,
    slackChannel,
    changeCount,
    messages,
  } = options

  const sections = [
    `# ${projectName} deploy Slack preview`,
    "",
    `- **Deploy PR:** [#${deployPrNumber}](${deployPrUrl})`,
    `- **Channel:** ${slackChannel}`,
    `- **Changes:** ${changeCount}`,
    "",
    "## Main message",
    "",
    messages.mainMessage,
  ]

  if (messages.threadMessage.length > 0) {
    sections.push("", "## Thread reply", "", messages.threadMessage)
  }

  return `${sections.join("\n")}\n`
}

export function writeDryRunPreview(options: DryRunPreviewOptions): string {
  const absolutePath = resolve(options.outputPath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, formatDryRunMarkdown(options), "utf8")
  return absolutePath
}

export function toFileUrl(absolutePath: string): string {
  return `file://${absolutePath}`
}
