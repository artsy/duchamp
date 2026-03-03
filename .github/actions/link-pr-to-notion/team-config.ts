/**
 * Team Configuration Types
 *
 * Defines the structure for multi-team support in the Notion task linking system.
 * Teams are organized hierarchically: Root Page → Team Pages → Databases
 */

export interface TeamConfiguration {
  /** Display name of the team (e.g., "Diamond", "Engineering") */
  teamName: string

  /** Notion page ID of the team's parent page */
  teamPageId: string

  /** Notion database ID for the Tasks database */
  tasksDbId: string
}

/**
 * Database identification result from discovery process
 */
export interface DiscoveredDatabase {
  id: string
  title: string
  type: "Tasks" | "Unknown"
}
