import { execSync } from "child_process"
import * as fs from "fs"
import * as yaml from "js-yaml"
import { buildPrompt, fetchShippedPrs } from "./deploy-notification"

/**
 * Local dry-run for the deploy Slack notification: fetches the shipped PRs
 * of a real deploy PR and prints the prompt that would be sent to Claude.
 * Nothing is sent to the Claude or Slack APIs, so no API keys are needed.
 *
 * GitHub auth comes from the gh CLI (`gh auth login`), or optionally a
 * GITHUB_TOKEN env var.
 *
 * Usage:
 *   npx ts-node scripts/test-deploy-notification.ts <owner/repo> <deploy-pr-number>
 *
 * Example:
 *   npx ts-node scripts/test-deploy-notification.ts artsy/volt 11796
 */

interface Config {
  subscriptions?: Record<string, { channels: string[]; context?: string }>
}

const githubToken = (): string => {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim()
  } catch {
    console.error(
      "No GitHub auth found. Run `gh auth login` or set GITHUB_TOKEN."
    )
    process.exit(1)
  }
}

const main = async (): Promise<void> => {
  const [repo, prArg] = process.argv.slice(2)
  const deployPrNumber = Number(prArg)
  if (!repo || !repo.includes("/") || !Number.isInteger(deployPrNumber)) {
    console.error(
      "Usage: npx ts-node scripts/test-deploy-notification.ts <owner/repo> <deploy-pr-number>"
    )
    process.exit(1)
  }

  const config = yaml.load(
    fs.readFileSync(`${__dirname}/../deploy-notifications.yml`, "utf8")
  ) as Config
  const subscription = config.subscriptions?.[repo]
  if (subscription) {
    console.error(`Subscribed channels: ${subscription.channels.join(", ")}`)
  } else {
    console.error(
      `Note: ${repo} is not in deploy-notifications.yml — using no repo context.`
    )
  }

  console.error(`Fetching shipped PRs for ${repo}#${deployPrNumber}...`)
  const shippedPrs = await fetchShippedPrs(repo, deployPrNumber, githubToken())
  if (shippedPrs.length === 0) {
    console.error("No shipped PRs found in this deploy PR.")
    process.exit(1)
  }
  console.error(
    `Found ${shippedPrs.length} shipped PRs: ${shippedPrs.map(pr => `#${pr.number}`).join(", ")}\n`
  )

  const prompt = buildPrompt({
    repo,
    deployPrUrl: `https://github.com/${repo}/pull/${deployPrNumber}`,
    repoContext: subscription?.context,
    shippedPrs,
  })

  // Prompt goes to stdout so it can be piped (status output goes to stderr)
  console.log(prompt)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
