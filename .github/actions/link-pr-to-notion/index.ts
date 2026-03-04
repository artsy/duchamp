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

async function linkPrToTask(
  notion: Client,
  shortId: string,
  tasksDbId: string,
  prUrl: string,
  uniqueIdProperty: string,
  prLinksProperty: string
): Promise<void> {
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
    return
  }

  const page = pages[0]
  const prLinksProp = page.properties[prLinksProperty]
  const existingLinks: string[] = []

  if (prLinksProp?.type === "rich_text") {
    const allText = prLinksProp.rich_text.map(rt => rt.plain_text).join("")
    existingLinks.push(...allText.split("\n").filter(l => l.trim() !== ""))
  }

  if (existingLinks.includes(prUrl)) {
    core.info(`${shortId}: PR URL already linked. Skipping.`)
    return
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

    const githubToken = core.getInput("github-token", { required: true })
    const octokit = github.getOctokit(githubToken)
    const { owner, repo } = github.context.repo
    const commitMessages = await getPrCommitMessages(
      octokit,
      owner,
      repo,
      prNumber
    )
    const searchText = `${pr.title}\n${pr.body ?? ""}\n${commitMessages}`

    const notion = new Client({ auth: notionToken })
    core.info("Discovering teams...")
    const teams = await discoverTeams(notion, rootPageId)
    const prefixMap = await buildPrefixMap(notion, teams, uniqueIdProperty)

    const shortIds = [
      ...new Set(searchText.match(/\b([A-Z]{1,10}-\d+)\b/g) ?? []),
    ]
    if (shortIds.length === 0) {
      core.info(
        "No short IDs found in PR title, body, or commits. Nothing to do."
      )
      return
    }
    core.info(`Found short IDs: ${shortIds.join(", ")}`)

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
        await linkPrToTask(
          notion,
          shortId,
          tasksDbId,
          prUrl,
          uniqueIdProperty,
          prLinksProperty
        )
      } catch (err) {
        core.warning(`Failed to update task ${shortId}: ${err}`)
      }
    }
  } catch (err) {
    core.warning(`Action encountered an error: ${err}`)
  }
}

run()
