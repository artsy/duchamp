import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as yaml from "js-yaml"

export interface DeploySlackSubscription {
  "slack-channel": string
  "project-name"?: string
}

export interface DeploySlackConfig {
  subscriptions: Record<string, DeploySlackSubscription>
}

export function parseDeploySlackConfig(content: string): DeploySlackConfig {
  const parsed = yaml.load(content)

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("subscriptions" in parsed) ||
    typeof (parsed as DeploySlackConfig).subscriptions !== "object" ||
    (parsed as DeploySlackConfig).subscriptions === null
  ) {
    throw new Error(
      "Invalid deploy Slack config: expected a top-level 'subscriptions' object"
    )
  }

  return parsed as DeploySlackConfig
}

export function loadDeploySlackConfig(configPath: string): DeploySlackConfig {
  const absolutePath = resolve(configPath)
  const content = readFileSync(absolutePath, "utf8")
  return parseDeploySlackConfig(content)
}

export function resolveSubscription(
  config: DeploySlackConfig,
  repository: string
): DeploySlackSubscription | undefined {
  return config.subscriptions[repository]
}
