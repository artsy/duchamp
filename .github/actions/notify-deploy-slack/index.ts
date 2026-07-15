import * as core from "@actions/core"
import * as github from "@actions/github"
import {
  type EnrichedDeployChange,
  enrichFromCommit,
  enrichFromPullRequest,
} from "./enrich-changes"
import { formatSlackMessages } from "./format-slack-message"
import { parseDeployChanges } from "./parse-commits"
import {
  loadDeploySlackConfig,
  resolveSubscription,
} from "./resolve-subscription"
import { postSlackMessage } from "./slack-api"
import { toFileUrl, writeDryRunPreview } from "./write-dry-run-preview"

const DEFAULT_CONFIG_PATH = "config/notify-deploy-slack.yml"

async function getPrCommitHeadlines(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string[]> {
  const { data: commits } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
  })

  return commits.map(commit => {
    const headline = commit.commit.message.split("\n")[0]?.trim()
    return headline ?? ""
  })
}

async function enrichDeployChanges(
  changes: ReturnType<typeof parseDeployChanges>,
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string
): Promise<EnrichedDeployChange[]> {
  const enriched: EnrichedDeployChange[] = []

  for (const change of changes) {
    if (change.prNumber !== undefined) {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: change.prNumber,
      })

      enriched.push(
        enrichFromPullRequest(change, {
          title: pr.title,
          body: pr.body ?? "",
          html_url: pr.html_url,
        })
      )
      continue
    }

    enriched.push(enrichFromCommit(change))
  }

  return enriched
}

async function run(): Promise<void> {
  try {
    const dryRun = core.getBooleanInput("dry-run")
    const slackBotToken = core.getInput("slack-bot-token", {
      required: !dryRun,
    })
    const configPath = core.getInput("config-path") || DEFAULT_CONFIG_PATH
    const slackChannelOverride = core.getInput("slack-channel")
    const projectNameOverride = core.getInput("project-name")
    const deployPrTitle = core.getInput("deploy-pr-title") || "Deploy"

    if (slackBotToken) {
      core.setSecret(slackBotToken)
    }

    const pr = github.context.payload.pull_request
    if (!pr) {
      core.warning("Not triggered from a pull_request event. Skipping.")
      return
    }

    if (!pr.merged) {
      core.info("Pull request was closed without merging. Skipping.")
      return
    }

    if (pr.title !== deployPrTitle) {
      core.info(
        `Pull request title "${pr.title}" does not match deploy title "${deployPrTitle}". Skipping.`
      )
      return
    }

    const githubToken = core.getInput("github-token", { required: true })
    const octokit = github.getOctokit(githubToken)
    const { owner, repo } = github.context.repo
    const repository = `${owner}/${repo}`
    const prNumber = pr.number as number

    const config = loadDeploySlackConfig(configPath)
    const subscription = resolveSubscription(config, repository)

    const slackChannel =
      slackChannelOverride ||
      subscription?.["slack-channel"] ||
      "(not configured)"
    if (!dryRun && !slackChannelOverride && !subscription?.["slack-channel"]) {
      core.info(
        `No Slack subscription configured for ${repository}. Add it to ${configPath} to enable deploy notifications.`
      )
      return
    }

    const resolvedProjectName =
      projectNameOverride || subscription?.["project-name"] || repo

    core.info(
      dryRun
        ? `[dry-run] Processing deploy PR #${prNumber} for ${resolvedProjectName}...`
        : `Processing deploy PR #${prNumber} for ${resolvedProjectName} → ${slackChannel}...`
    )

    const commitHeadlines = await getPrCommitHeadlines(
      octokit,
      owner,
      repo,
      prNumber
    )
    const changes = parseDeployChanges(commitHeadlines)
    const enrichedChanges = await enrichDeployChanges(
      changes,
      octokit,
      owner,
      repo
    )
    const messages = formatSlackMessages(
      resolvedProjectName,
      pr.html_url as string,
      enrichedChanges
    )

    if (dryRun) {
      const outputPath =
        core.getInput("dry-run-output") ||
        `tmp/deploy-slack-preview-${owner}-${repo}-${prNumber}.md`
      const previewPath = writeDryRunPreview({
        projectName: resolvedProjectName,
        deployPrUrl: pr.html_url as string,
        deployPrNumber: prNumber,
        slackChannel,
        changeCount: enrichedChanges.length,
        messages,
        outputPath,
      })
      const previewUrl = toFileUrl(previewPath)
      core.info(`[dry-run] Preview written to ${previewUrl}`)
      console.log(previewUrl)
      return
    }

    core.info(
      `Posting deploy summary with ${enrichedChanges.length} change(s) to Slack...`
    )

    const threadTs = await postSlackMessage(
      slackBotToken,
      slackChannel,
      messages.mainMessage
    )

    if (messages.threadMessage.length > 0) {
      await postSlackMessage(
        slackBotToken,
        slackChannel,
        messages.threadMessage,
        threadTs
      )
    }

    core.info("Deploy notification sent to Slack.")
  } catch (err) {
    core.setFailed(`Failed to notify Slack about deploy: ${err}`)
  }
}

run()
