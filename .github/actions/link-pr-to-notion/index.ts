import * as core from "@actions/core"
import * as github from "@actions/github"
import { Client } from "@notionhq/client"
import type {
  DatabaseObjectResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints"
import type { TeamConfiguration } from "./team-config"
import { discoverTeams } from "./team-discovery"

async function getPrCommitMessages(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const { data: commits } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
  })
  return commits.map(c => c.commit.message).join("\n")
}

async function buildPrefixMap(
  notion: Client,
  teams: TeamConfiguration[],
  uniqueIdProperty: string
): Promise<Map<string, string>> {
  const prefixMap = new Map<string, string>()
  for (const team of teams) {
    try {
      const db = await notion.databases.retrieve({
        database_id: team.tasksDbId,
      })
      if (!("properties" in db)) continue
      const idProp = (db as DatabaseObjectResponse).properties[uniqueIdProperty]
      if (idProp?.type === "unique_id") {
        const prefix = idProp.unique_id.prefix
        if (prefix && prefix.trim() !== "") {
          prefixMap.set(prefix.toUpperCase(), team.tasksDbId)
          core.info(`Registered prefix "${prefix}" → ${team.teamName}`)
        }
      }
    } catch (err) {
      core.warning(`Could not read schema for team "${team.teamName}": ${err}`)
    }
  }
  return prefixMap
}

function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`
}

// Returns the Notion page URL if the task was found (whether or not the PR was
// newly linked), or null if the task could not be found.
async function linkPrToTask(
  notion: Client,
  shortId: string,
  tasksDbId: string,
  prUrl: string,
  uniqueIdProperty: string,
  prLinksProperty: string
): Promise<string | null> {
  const dashIdx = shortId.lastIndexOf("-")
  const number = parseInt(shortId.substring(dashIdx + 1), 10)

  const queryResponse = await notion.databases.query({
    database_id: tasksDbId,
    // unique_id filter may not be in older @notionhq/client typedefs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter: {
      property: uniqueIdProperty,
      unique_id: { equals: number },
    } as any,
  })

  const pages = queryResponse.results.filter(
    (p): p is PageObjectResponse => "properties" in p
  )

  if (pages.length === 0) {
    core.warning(`No task found for ${shortId}. Skipping.`)
    return null
  }

  const page = pages[0]
  const pageUrl = notionPageUrl(page.id)
  const prLinksProp = page.properties[prLinksProperty]
  const existingLinks: string[] = []

  if (prLinksProp?.type === "rich_text") {
    const allText = prLinksProp.rich_text.map(rt => rt.plain_text).join("")
    existingLinks.push(...allText.split("\n").filter(l => l.trim() !== ""))
  }

  if (existingLinks.includes(prUrl)) {
    core.info(`${shortId}: PR URL already linked. Skipping.`)
    return pageUrl
  }

  const newLinks = [...existingLinks, prUrl]
  const richText = newLinks.flatMap((url, i) => {
    const entry = { text: { content: url, link: { url } } }
    return i < newLinks.length - 1
      ? [entry, { text: { content: "\n" } }]
      : [entry]
  })
  await notion.pages.update({
    page_id: page.id,
    properties: {
      [prLinksProperty]: { rich_text: richText },
    },
  })

  core.info(`${shortId}: Appended PR URL to "${prLinksProperty}".`)
  return pageUrl
}

// Resolves a Notion page ID (from a URL in the PR body) to a task shortId,
// links the PR to that task, and returns the shortId + page URL.
async function linkNotionUrlToTask(
  notion: Client,
  pageId: string,
  prUrl: string,
  uniqueIdProperty: string,
  prLinksProperty: string,
  prefixMap: Map<string, string>
): Promise<{ shortId: string; pageUrl: string } | null> {
  const page = (await notion.pages.retrieve({
    page_id: pageId,
  })) as PageObjectResponse
  if (!("properties" in page)) return null

  const idProp = page.properties[uniqueIdProperty]
  if (idProp?.type !== "unique_id") return null

  const prefix = idProp.unique_id.prefix
  const number = idProp.unique_id.number
  if (!prefix || !number) return null

  const shortId = `${prefix}-${number}`
  const tasksDbId = prefixMap.get(prefix.toUpperCase())
  if (!tasksDbId) {
    core.warning(
      `No team found for prefix "${prefix}" (from Notion URL). Skipping.`
    )
    return null
  }

  const pageUrl = await linkPrToTask(
    notion,
    shortId,
    tasksDbId,
    prUrl,
    uniqueIdProperty,
    prLinksProperty
  )
  if (!pageUrl) return null

  return { shortId, pageUrl }
}

// Extracts Notion page IDs from any notion.so URLs present in the given text.
function extractNotionPageIds(text: string): string[] {
  const pattern =
    /https?:\/\/(?:www\.)?notion\.so\/\S*?([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/gi
  const ids = new Set<string>()
  for (const match of text.matchAll(pattern)) {
    const raw = match[1].replace(/-/g, "")
    const id = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
    ids.add(id)
  }
  return [...ids]
}

// Updates the PR description to include a link back to the Notion task.
// - If the shortId is already a markdown link (any URL), or the Notion URL is present, skips.
// - If the shortId appears bracketed but not linked ([TEAM-123]), appends the URL in-place.
// - If the shortId appears as bare text, it is linkified in-place.
// - Otherwise, a "related to" line is appended to the bottom.
// Returns the (possibly updated) body.
function buildUpdatedBody(
  body: string,
  shortId: string,
  pageUrl: string
): string | null {
  // Skip if already linked: Notion URL present, or shortId already has a markdown link
  const alreadyLinkedPattern = new RegExp(`\\[${shortId}\\]\\(`)
  if (body.includes(pageUrl) || alreadyLinkedPattern.test(body)) {
    core.info(`${shortId}: Already linked in PR description. Skipping.`)
    return null
  }

  // Linkify bracketed-but-not-linked: [TEAM-123] → [TEAM-123](url)
  // Safe to use includes() here since [TEAM-123]( was already ruled out above.
  if (body.includes(`[${shortId}]`)) {
    core.info(`${shortId}: Linkifying bracketed mention in PR description.`)
    return body.replace(`[${shortId}]`, `[${shortId}](${pageUrl})`)
  }

  // Linkify bare ID — [TEAM-123] case is already handled above, so \b is sufficient
  const bareIdPattern = new RegExp(`\\b${shortId}\\b`)
  if (bareIdPattern.test(body)) {
    core.info(`${shortId}: Linkifying mention in PR description.`)
    return body.replace(bareIdPattern, `[${shortId}](${pageUrl})`)
  }

  // Not in the body — append a "related to" line
  core.info(`${shortId}: Appending Notion link to PR description.`)
  return `${body}\n\n> This change is related to [${shortId}](${pageUrl})`
}

async function run(): Promise<void> {
  try {
    const notionToken = core.getInput("notion-token", { required: true })
    const rootPageId = core.getInput("root-page-id", { required: true })
    const uniqueIdProperty = core.getInput("unique-id-property") || "ID"
    const prLinksProperty = core.getInput("pr-links-property") || "PR Links"

    // Mask secrets so they never appear in logs
    core.setSecret(notionToken)
    core.setSecret(rootPageId)

    const pr = github.context.payload.pull_request
    if (!pr) {
      core.warning("Not triggered from a pull_request event. Skipping.")
      return
    }

    const prUrl = pr.html_url as string
    const prNumber = pr.number as number
    const prBody = pr.body ?? ""

    const githubToken = core.getInput("github-token", { required: true })
    const octokit = github.getOctokit(githubToken)
    const { owner, repo } = github.context.repo
    const commitMessages = await getPrCommitMessages(
      octokit,
      owner,
      repo,
      prNumber
    )
    const searchText = `${pr.title}\n${prBody}\n${commitMessages}`

    const notion = new Client({ auth: notionToken })
    core.info("Discovering teams...")
    const teams = await discoverTeams(notion, rootPageId)
    const prefixMap = await buildPrefixMap(notion, teams, uniqueIdProperty)

    // Track handled shortIds to avoid touching the same task twice
    const handledIds = new Set<string>()
    // Thread the body through so multiple IDs are batched into one update
    let currentBody = prBody

    // --- Path 1: short IDs found in title, body, or commits ---
    const shortIds = [
      ...new Set(searchText.match(/\b([A-Z]{1,10}-\d+)\b/g) ?? []),
    ]
    if (shortIds.length > 0) {
      core.info(`Found short IDs: ${shortIds.join(", ")}`)
    }

    for (const shortId of shortIds) {
      const prefix = shortId
        .substring(0, shortId.lastIndexOf("-"))
        .toUpperCase()
      const tasksDbId = prefixMap.get(prefix)
      if (!tasksDbId) {
        core.warning(
          `No team found with prefix "${prefix}". Skipping ${shortId}.`
        )
        continue
      }
      try {
        const pageUrl = await linkPrToTask(
          notion,
          shortId,
          tasksDbId,
          prUrl,
          uniqueIdProperty,
          prLinksProperty
        )
        if (pageUrl) {
          handledIds.add(shortId)
          const updated = buildUpdatedBody(currentBody, shortId, pageUrl)
          if (updated !== null) currentBody = updated
        }
      } catch (err) {
        core.warning(`Failed to update task ${shortId}: ${err}`)
      }
    }

    // --- Path 2: Notion URLs in the PR body ---
    const notionPageIds = extractNotionPageIds(prBody)
    if (notionPageIds.length > 0) {
      core.info(`Found Notion URLs with page IDs: ${notionPageIds.join(", ")}`)
    }

    for (const pageId of notionPageIds) {
      try {
        const result = await linkNotionUrlToTask(
          notion,
          pageId,
          prUrl,
          uniqueIdProperty,
          prLinksProperty,
          prefixMap
        )
        if (result && !handledIds.has(result.shortId)) {
          handledIds.add(result.shortId)
          const updated = buildUpdatedBody(
            currentBody,
            result.shortId,
            result.pageUrl
          )
          if (updated !== null) currentBody = updated
        }
      } catch (err) {
        core.warning(`Failed to process Notion URL for page ${pageId}: ${err}`)
      }
    }

    // Flush description update if anything changed
    if (currentBody !== prBody) {
      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        body: currentBody,
      })
      core.info("Updated PR description with Notion task link(s).")
    }

    if (
      handledIds.size === 0 &&
      shortIds.length === 0 &&
      notionPageIds.length === 0
    ) {
      core.info(
        "No short IDs or Notion URLs found in PR title, body, or commits. Nothing to do."
      )
    }
  } catch (err) {
    core.warning(`Action encountered an error: ${err}`)
  }
}

run()
