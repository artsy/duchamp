/**
 * The few Datadog REST calls autofix needs: Error Tracking search and get, and one
 * error span for the stack. `fetch` is injected so tests run on fixtures.
 *
 * Shapes follow the v2 API (snake_case on the wire): Error Tracking search returns
 * `data[]` results carrying counts, with the issues themselves in `included[]`; spans
 * carry the Ruby stack at `attributes.custom.error.stack`.
 */

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export interface DatadogConfig {
  apiKey: string
  appKey: string
  site: string
  fetch: Fetch
}

export class DatadogError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ErrorIssue {
  id: string
  service: string
  errorType: string
  errorMessage: string
  filePath: string
  functionName: string
  state: string
  /** Milliseconds since the epoch. */
  firstSeen: number
  firstSeenVersion: string
  totalCount: number
  impactedUsers: number
}

export interface ErrorSpan {
  stack: string
  message: string
  resourceName: string
  url: string
}

const request = async (
  config: DatadogConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<any> => {
  const response = await config.fetch(`https://api.${config.site}${path}`, {
    method,
    headers: {
      "DD-API-KEY": config.apiKey,
      "DD-APPLICATION-KEY": config.appKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new DatadogError(
      `Datadog ${method} ${path.split("?")[0]} returned ${response.status}: ${text.slice(0, 300)}`,
      response.status
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new DatadogError(
      `Datadog ${method} ${path} returned invalid JSON`,
      response.status
    )
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "")
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

export const toIssue = (
  id: string,
  attributes: Record<string, unknown> | undefined,
  counts: Record<string, unknown> = {}
): ErrorIssue => ({
  id,
  service: str(attributes?.service),
  errorType: str(attributes?.error_type),
  errorMessage: str(attributes?.error_message),
  filePath: str(attributes?.file_path),
  functionName: str(attributes?.function_name),
  state: str(attributes?.state),
  firstSeen: num(attributes?.first_seen),
  firstSeenVersion: str(attributes?.first_seen_version),
  totalCount: num(counts.total_count),
  impactedUsers: num(counts.impacted_users),
})

/** Join search results (counts) with the included issues (details). */
export const parseSearch = (response: any): ErrorIssue[] => {
  const included = new Map<string, Record<string, unknown>>()
  for (const item of response?.included ?? []) {
    if (item?.type === "issue" && typeof item.id === "string") {
      included.set(item.id, item.attributes ?? {})
    }
  }
  return (response?.data ?? [])
    .map((result: any) => {
      const id = result?.relationships?.issue?.data?.id ?? result?.id
      return typeof id === "string"
        ? toIssue(id, included.get(id), result.attributes ?? {})
        : null
    })
    .filter((issue: ErrorIssue | null): issue is ErrorIssue => issue !== null)
}

export interface SearchOptions {
  query: string
  /** Milliseconds since the epoch. */
  from: number
  to: number
}

/** The search endpoint returns at most this many issues and has no paging. */
export const SEARCH_LIMIT = 100

const search = async (
  config: DatadogConfig,
  { query, from, to }: SearchOptions,
  orderBy: "TOTAL_COUNT" | "FIRST_SEEN"
): Promise<ErrorIssue[]> =>
  parseSearch(
    await request(
      config,
      "POST",
      "/api/v2/error-tracking/issues/search?include=issue,issue.impacted_users",
      {
        data: {
          type: "search_request",
          attributes: {
            query,
            from,
            to,
            track: "trace",
            order_by: orderBy,
            states: ["OPEN"],
          },
        },
      }
    )
  )

/** Open backend issues matching `query`, most events first. */
export const searchIssues = (
  config: DatadogConfig,
  options: SearchOptions
): Promise<ErrorIssue[]> => search(config, options, "TOTAL_COUNT")

/**
 * Open issues first seen since `from`, newest first. A full page is complete only
 * when it reaches an issue first seen before `from`; otherwise this throws.
 */
export const searchNewIssues = async (
  config: DatadogConfig,
  options: SearchOptions
): Promise<ErrorIssue[]> => {
  const issues = await search(config, options, "FIRST_SEEN")
  if (issues.length < SEARCH_LIMIT) return issues
  const newestFirst = issues.every(
    (issue, i) => i === 0 || issues[i - 1].firstSeen >= issue.firstSeen
  )
  if (!newestFirst || issues[issues.length - 1].firstSeen >= options.from) {
    throw new DatadogError(
      `Datadog search returned a full page of ${issues.length} issues without reaching the start of the window; some new errors would be missed`,
      200
    )
  }
  return issues
}

/** One issue by id, without counts (the get endpoint has none). */
export const getIssue = async (
  config: DatadogConfig,
  id: string
): Promise<ErrorIssue> => {
  const response = await request(
    config,
    "GET",
    `/api/v2/error-tracking/issues/${encodeURIComponent(id)}`
  )
  if (response?.data?.id !== id) {
    throw new DatadogError(`Datadog issue ${id} not found`, 404)
  }
  return toIssue(id, response.data.attributes)
}

export const parseSpan = (response: any): ErrorSpan | null => {
  const attributes = response?.data?.[0]?.attributes
  if (!attributes) return null
  const custom = attributes.custom ?? {}
  return {
    stack: str(custom.error?.stack) || str(attributes.error?.stack),
    message: str(custom.error?.message) || str(attributes.error?.message),
    resourceName: str(attributes.resource_name),
    url: str(custom.http?.url),
  }
}

/**
 * The latest production error span for an issue. Error Tracking tags each span it
 * groups with `@issue.id`. Spans are kept 15 days.
 */
export const latestErrorSpan = async (
  config: DatadogConfig,
  issueId: string
): Promise<ErrorSpan | null> =>
  parseSpan(
    await request(config, "POST", "/api/v2/spans/events/search", {
      data: {
        type: "search_request",
        attributes: {
          filter: {
            query: `env:production status:error @issue.id:${issueId}`,
            from: "now-15d",
            to: "now",
          },
          page: { limit: 1 },
          sort: "-timestamp",
        },
      },
    })
  )

export const permalink = (site: string, id: string): string =>
  `https://app.${site}/error-tracking/issue/${id}`
