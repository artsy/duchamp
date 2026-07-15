import type { EnrichedDeployChange } from "./enrich-changes"
import type { DeployCategory } from "./parse-commits"

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001"

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const ANTHROPIC_VERSION = "2023-06-01"
const MAX_PR_BODY_LENGTH = 2000
const MAX_DESCRIPTION_LENGTH = 120

export interface ClaudeSummaryInput {
  prNumber: number
  prTitle: string
  prBody: string
  category: DeployCategory
  area?: string
}

export interface ClaudeSummaryResult {
  prNumber: number
  title: string
  description: string
  area?: string
}

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>
}

function truncateBody(body: string): string {
  const trimmed = body.trim()
  if (trimmed.length <= MAX_PR_BODY_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_PR_BODY_LENGTH - 1).trimEnd()}…`
}

function categoryLabel(category: DeployCategory): string {
  switch (category) {
    case "features":
      return "New feature"
    case "fixes":
      return "Bug fix"
    default:
      return "Improvement or maintenance"
  }
}

export function buildClaudePrompt(inputs: ClaudeSummaryInput[]): string {
  const prBlocks = inputs
    .map(input => {
      const lines = [
        `PR #${input.prNumber}`,
        `Category: ${categoryLabel(input.category)} (do not change)`,
        input.area ? `Suggested area: ${input.area}` : undefined,
        `Title: ${input.prTitle}`,
        `Body:\n${truncateBody(input.prBody)}`,
      ].filter((line): line is string => line !== undefined)

      return lines.join("\n")
    })
    .join("\n\n---\n\n")

  return `You write product-friendly Slack copy for Artsy engineering deploy announcements. The audience is non-technical product and design teammates.

Rewrite each PR below into a short title and one-sentence description suitable for Slack.

Rules:
- Title: plain language, title case, no conventional-commit prefixes (no "feat:", scopes, or ticket IDs)
- Description: one sentence, max ${MAX_DESCRIPTION_LENGTH} characters, explain user-visible impact in plain language
- Do not mention code, files, libraries, tests, CI, feature flags, or implementation details unless the category is "Improvement or maintenance" and the change is a routine dependency or tooling update — then say it has no visible changes
- Do not invent links, ticket numbers, or features not supported by the PR text
- Area must be one of: Artworks, ArtOS, Conversations, Inventory, Orders — or omit if unclear. ArtOS covers partner CMS (catalog, lists, settings, Studio editors, Instagram/Mailchimp/Tearsheet/Checklist)
- Keep the category exactly as given — never promote chores to features
- Return ONLY valid JSON: an array of objects with keys prNumber (number), title (string), description (string), area (string, optional)

PRs:

${prBlocks}`
}

export function parseClaudeResponse(text: string): ClaudeSummaryResult[] {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonText = (fenced?.[1] ?? trimmed).trim()

  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed)) {
    throw new Error("Claude response was not a JSON array")
  }

  const results: ClaudeSummaryResult[] = []
  for (const item of parsed) {
    if (
      typeof item?.prNumber !== "number" ||
      typeof item?.title !== "string" ||
      typeof item?.description !== "string"
    ) {
      continue
    }

    const description =
      item.description.length > MAX_DESCRIPTION_LENGTH
        ? `${item.description.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
        : item.description

    results.push({
      prNumber: item.prNumber,
      title: item.title.trim(),
      description: description.trim(),
      area: typeof item.area === "string" ? item.area.trim() : undefined,
    })
  }

  if (results.length === 0) {
    throw new Error("Claude response did not contain any valid summaries")
  }

  return results
}

export function mergeClaudeSummaries(
  ruleBased: EnrichedDeployChange[],
  summaries: ClaudeSummaryResult[]
): EnrichedDeployChange[] {
  const summaryByPr = new Map(
    summaries.map(summary => [summary.prNumber, summary])
  )

  return ruleBased.map(change => {
    if (change.prNumber === undefined) {
      return change
    }

    const summary = summaryByPr.get(change.prNumber)
    if (!summary) {
      return change
    }

    return {
      ...change,
      title: summary.title,
      description: summary.description,
      area: summary.area ?? change.area,
      descriptionSource: "claude" as const,
    }
  })
}

export async function summarizeWithClaude(
  apiKey: string,
  inputs: ClaudeSummaryInput[],
  model: string = DEFAULT_CLAUDE_MODEL,
  fetchImpl: typeof fetch = fetch
): Promise<ClaudeSummaryResult[]> {
  if (inputs.length === 0) {
    return []
  }

  const response = await fetchImpl(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: buildClaudePrompt(inputs) }],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `Anthropic API error (${response.status}): ${errorBody.slice(0, 200)}`
    )
  }

  const payload = (await response.json()) as AnthropicMessageResponse
  const text = payload.content
    ?.filter(block => block.type === "text")
    .map(block => block.text ?? "")
    .join("\n")
    .trim()

  if (!text) {
    throw new Error("Anthropic API returned an empty response")
  }

  return parseClaudeResponse(text)
}
