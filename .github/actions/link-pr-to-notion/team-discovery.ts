import type { Client } from "@notionhq/client"
import { REQUIRED_TASKS_PROPERTIES } from "./database-constants"
import type { DiscoveredDatabase, TeamConfiguration } from "./team-config"

/**
 * Discover all teams under the root page
 * @param client - Notion client instance
 * @param rootPageId - ID of the root page containing team pages
 * @returns Array of TeamConfiguration objects
 */
export async function discoverTeams(
  client: Client,
  rootPageId: string
): Promise<TeamConfiguration[]> {
  try {
    // Query children of root page to find team pages
    const response = await client.blocks.children.list({
      block_id: rootPageId,
    })

    const teams: TeamConfiguration[] = []

    // Filter for child pages (teams) and narrow type
    const teamPages = response.results.filter(
      (block): block is Extract<typeof block, { type: "child_page" }> =>
        "type" in block && block.type === "child_page"
    )

    // For each team page, discover its databases
    for (const teamBlock of teamPages) {
      const teamPageId = teamBlock.id
      const teamName = teamBlock.child_page.title

      // Discover databases for this team
      const databases = await discoverTeamDatabases(client, teamPageId)

      const tasksDb = databases.find(db => db.type === "Tasks")

      if (tasksDb) {
        teams.push({
          teamName,
          teamPageId,
          tasksDbId: tasksDb.id,
        })
      } else {
        console.warn(
          `Warning: Team "${teamName}" has no Tasks database. Skipping.`
        )
      }
    }

    return teams
  } catch (error) {
    throw new Error(
      `Failed to discover teams: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Discover databases under a team page
 * @param client - Notion client instance
 * @param teamPageId - ID of the team page
 * @returns Array of discovered databases with identified types
 */
export async function discoverTeamDatabases(
  client: Client,
  teamPageId: string
): Promise<DiscoveredDatabase[]> {
  try {
    const response = await client.blocks.children.list({
      block_id: teamPageId,
    })

    const discoveredDatabases: DiscoveredDatabase[] = []

    // Filter for child databases and narrow type
    const databaseBlocks = response.results.filter(
      (block): block is Extract<typeof block, { type: "child_database" }> =>
        "type" in block && block.type === "child_database"
    )

    for (const dbBlock of databaseBlocks) {
      const dbId = dbBlock.id
      const dbTitle = dbBlock.child_database.title

      const type = identifyDatabaseType(dbTitle)

      discoveredDatabases.push({
        id: dbId,
        title: dbTitle,
        type,
      })
    }

    return discoveredDatabases
  } catch (error) {
    throw new Error(
      `Failed to discover databases for team page ${teamPageId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Identify database type by title matching
 * @param title - Database title from Notion
 * @returns Database type or 'Unknown'
 */
export function identifyDatabaseType(title: string): "Tasks" | "Unknown" {
  const normalizedTitle = title.toLowerCase().trim()

  if (normalizedTitle === "tasks" || normalizedTitle.includes("task")) {
    return "Tasks"
  }

  return "Unknown"
}

/**
 * Validate database schema has required properties
 * @param client - Notion client instance
 * @param databaseId - Database ID to validate
 * @param expectedType - Expected database type
 * @returns True if database has required properties
 */
export async function validateDatabaseSchema(
  client: Client,
  databaseId: string,
  expectedType: "Tasks" | "Unknown"
): Promise<boolean> {
  if (expectedType === "Unknown") return false

  try {
    const database = await client.databases.retrieve({
      database_id: databaseId,
    })

    const propertyNames = Object.keys(database.properties)
    const hasAllRequired = REQUIRED_TASKS_PROPERTIES.every(prop =>
      propertyNames.includes(prop)
    )

    if (!hasAllRequired) {
      const missingProps = REQUIRED_TASKS_PROPERTIES.filter(
        prop => !propertyNames.includes(prop)
      )
      console.warn(
        `Database ${databaseId} (Tasks) is missing properties: ${missingProps.join(", ")}`
      )
    }

    return hasAllRequired
  } catch (error) {
    console.error(
      `Failed to validate database ${databaseId}:`,
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}

/**
 * Get a specific team configuration by name
 * @param client - Notion client instance
 * @param rootPageId - ID of the root page
 * @param teamName - Name of the team to find
 * @returns TeamConfiguration or null if not found
 */
export async function getTeamByName(
  client: Client,
  rootPageId: string,
  teamName: string
): Promise<TeamConfiguration | null> {
  const teams = await discoverTeams(client, rootPageId)
  return (
    teams.find(
      team => team.teamName.toLowerCase() === teamName.toLowerCase()
    ) || null
  )
}
