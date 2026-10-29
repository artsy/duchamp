import * as fs from "fs"
import * as yaml from "js-yaml"

/**
 * Post an AI-generated deploy digest to Slack when a Deploy PR is merged.
 *
 * Reads channel subscriptions from deploy-notifications.yml (in duchamp),
 * collects the PRs shipped in the deploy PR via the GitHub API, asks Claude
 * to write a Slack digest (features in the top-level message, everything
 * else in a thread reply), and posts it via the Slack API.
 *
 * Required env vars:
 *   GITHUB_REPOSITORY   e.g. "artsy/volt"
 *   DEPLOY_PR_NUMBER    number of the merged deploy PR
 *   DEPLOY_PR_URL       html url of the deploy PR
 *   GITHUB_TOKEN        token with read access to the repo's PRs
 *   ANTHROPIC_API_KEY   Claude API key
 *   SLACK_BOT_TOKEN     Slack bot token with chat:write
 * Optional:
 *   CONFIG_PATH         path to deploy-notifications.yml (default: ./deploy-notifications.yml)
 *   CLAUDE_MODEL        model id (default: claude-opus-4-8)
 */

interface RepoSubscription {
  channels: string[]
  context?: string
}

interface Config {
  subscriptions?: Record<string, RepoSubscription>
}

export interface ShippedPr {
  number: number
  title: string
  body: string
  url: string
  author: string
}

export interface DigestMessages {
  top_message: string
  thread_message: string | null
}

/**
 * Extract PR numbers referenced by the commits contained in a deploy PR.
 * Handles squash merges ("Some change (#123)") and merge commits
 * ("Merge pull request #123 from ...").
 */
export const extractPrNumbers = (commitMessages: string[]): number[] => {
  const numbers = new Set<number>()
  for (const message of commitMessages) {
    const subject = message.split("\n")[0]
    const mergeMatch = subject.match(/^Merge pull request #(\d+)/)
    if (mergeMatch) {
      numbers.add(Number(mergeMatch[1]))
      continue
    }
    const squashMatch = subject.match(/\(#(\d+)\)\s*$/)
    if (squashMatch) {
      numbers.add(Number(squashMatch[1]))
    }
  }
  return [...numbers].sort((a, b) => a - b)
}

/**
 * Parse Claude's response into the two Slack messages. Tolerates markdown
 * code fences around the JSON.
 */
export const parseDigest = (text: string): DigestMessages => {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
  const parsed = JSON.parse(stripped)
  if (typeof parsed.top_message !== "string" || parsed.top_message === "") {
    throw new Error("Claude response is missing top_message")
  }
  return {
    top_message: parsed.top_message,
    thread_message:
      typeof parsed.thread_message === "string" && parsed.thread_message !== ""
        ? parsed.thread_message
        : null,
  }
}

export const buildPrompt = (options: {
  repo: string
  deployPrUrl: string
  repoContext?: string
  shippedPrs: ShippedPr[]
}): string => {
  const prList = options.shippedPrs
    .map(
      pr =>
        `### PR #${pr.number}: ${pr.title}\nURL: ${pr.url}\nAuthor: ${pr.author}\nBody:\n${pr.body || "(no description)"}`
    )
    .join("\n\n")

  return `You are writing a Slack deploy notification for the repository ${options.repo}.
A Deploy PR just merged (${options.deployPrUrl}), shipping the pull requests listed below.

${options.repoContext ? `## Repository context\n${options.repoContext}\n` : ""}
## Task
Write two Slack messages:

1. **top_message** — starts with "🚀 A new batch of ${options.repo.split("/")[1]} changes just went live (<${options.deployPrUrl}|PR>)!". If any shipped PRs are genuinely new user-facing features, list them here under a "*New Features*" heading and end with "Check the thread for fixes and improvements 🧵". If there are no new features, instead end with "No new features this time — check the thread for fixes and improvements 🧵" (and no feature list). If there is nothing at all for the thread either, end with no thread reference.

2. **thread_message** — everything that is not a new user-facing feature (bug fixes, chores, dependency bumps, test/tooling work), split into a "*Fixes*" group and an "*Improvements & Maintenance*" group. Omit an empty group. If nothing belongs in the thread, use null.

For each item:
- Give it a short plain-language title in bold, prefixed with the product area it touches, then an em dash and a one-sentence description a non-engineer can understand.
- Link the PR, plus its Jira/Notion ticket and feature flag if the PR body mentions one.
- Example item: "• *Artworks: Correct Dimension Unit Switching* — switching units now immediately shows converted values instead of stale ones (<https://github.com/artsy/volt/pull/11800|PR> · <https://artsyproduct.atlassian.net/browse/AMBER-2021|Jira>)"

Formatting rules:
- Use Slack mrkdwn, NOT standard markdown: *bold*, <url|text> links, "•" for bullets.
- Be accurate: only call something a new feature if the PR clearly introduces new user-facing functionality.
- Keep descriptions honest and plain; routine dependency updates get "routine dependency update ... with no visible changes".

## Shipped pull requests
${prList}

## Output
Respond with ONLY a JSON object, no other text:
{"top_message": "...", "thread_message": "..." or null}`
}

const githubFetch = async (path: string, token: string): Promise<any> => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  })
  if (!response.ok) {
    throw new Error(
      `GitHub API ${path} failed: ${response.status} ${await response.text()}`
    )
  }
  return response.json()
}

export const fetchShippedPrs = async (
  repo: string,
  deployPrNumber: number,
  token: string
): Promise<ShippedPr[]> => {
  const messages: string[] = []
  for (let page = 1; page <= 3; page++) {
    const commits = await githubFetch(
      `/repos/${repo}/pulls/${deployPrNumber}/commits?per_page=100&page=${page}`,
      token
    )
    messages.push(...commits.map((c: any) => c.commit.message))
    if (commits.length < 100) break
  }

  const numbers = extractPrNumbers(messages).filter(n => n !== deployPrNumber)
  const limited = numbers.slice(0, 50)
  if (numbers.length > limited.length) {
    console.warn(
      `Deploy contains ${numbers.length} PRs; summarizing the first ${limited.length}.`
    )
  }

  const prs: ShippedPr[] = []
  for (const number of limited) {
    try {
      const pr = await githubFetch(`/repos/${repo}/pulls/${number}`, token)
      prs.push({
        number,
        title: pr.title,
        body: (pr.body || "").slice(0, 1500),
        url: pr.html_url,
        author: pr.user?.login || "unknown",
      })
    } catch (error) {
      console.warn(`Skipping PR #${number}: ${error}`)
    }
  }
  return prs
}

const askClaude = async (
  prompt: string,
  apiKey: string,
  model: string
): Promise<DigestMessages> => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Claude API failed: ${response.status} ${await response.text()}`
    )
  }
  const data = await response.json()
  const text = data.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("")
  return parseDigest(text)
}

const postToSlack = async (
  channel: string,
  digest: DigestMessages,
  token: string
): Promise<void> => {
  const post = async (text: string, threadTs?: string): Promise<string> => {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text,
        unfurl_links: false,
        unfurl_media: false,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      throw new Error(
        `Slack chat.postMessage to ${channel} failed: ${data.error}`
      )
    }
    return data.ts
  }

  const ts = await post(digest.top_message)
  if (digest.thread_message) {
    await post(digest.thread_message, ts)
  }
  console.log(`Posted deploy notification to ${channel}`)
}

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

const main = async (): Promise<void> => {
  const repo = requireEnv("GITHUB_REPOSITORY")
  const deployPrNumber = Number(requireEnv("DEPLOY_PR_NUMBER"))
  const deployPrUrl = requireEnv("DEPLOY_PR_URL")
  const githubToken = requireEnv("GITHUB_TOKEN")
  const configPath = process.env.CONFIG_PATH || "deploy-notifications.yml"
  const model = process.env.CLAUDE_MODEL || "claude-opus-4-8"

  const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Config
  const subscription = config.subscriptions?.[repo]
  if (!subscription || subscription.channels.length === 0) {
    console.log(`No Slack channels subscribed to ${repo}. Nothing to do.`)
    return
  }

  const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY")
  const slackToken = requireEnv("SLACK_BOT_TOKEN")

  const shippedPrs = await fetchShippedPrs(repo, deployPrNumber, githubToken)
  if (shippedPrs.length === 0) {
    console.log("No shipped PRs found in the deploy PR. Nothing to announce.")
    return
  }
  console.log(
    `Found ${shippedPrs.length} shipped PRs. Generating digest with ${model}...`
  )

  const prompt = buildPrompt({
    repo,
    deployPrUrl,
    repoContext: subscription.context,
    shippedPrs,
  })
  const digest = await askClaude(prompt, anthropicApiKey, model)

  for (const channel of subscription.channels) {
    await postToSlack(channel, digest, slackToken)
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
