import * as fs from "fs"
import * as path from "path"
import {
  type DatadogConfig,
  DatadogError,
  type Fetch,
  getIssue,
  latestErrorSpan,
  parseSearch,
  permalink,
  SEARCH_LIMIT,
  searchIssues,
  searchNewIssues,
} from "./datadog"

const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, "__fixtures__", name), "utf8")

const ID = "0b7e7c2a-1111-4c1d-9a00-000000000001"

const respond = (status: number, body: string) =>
  jest.fn<ReturnType<Fetch>, Parameters<Fetch>>(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }))

const searchResponse = (issues: { id: string; firstSeen: number }[]) => ({
  data: issues.map(({ id }) => ({
    id,
    type: "error_tracking_search_result",
    attributes: { total_count: 1 },
    relationships: { issue: { data: { id, type: "issue" } } },
  })),
  included: issues.map(({ id, firstSeen }) => ({
    id,
    type: "issue",
    attributes: { first_seen: firstSeen, first_seen_version: "ABCDEF1234567" },
  })),
})

const configWith = (fetch: Fetch): DatadogConfig => ({
  apiKey: "api",
  appKey: "app",
  site: "datadoghq.com",
  fetch,
})

describe("parseSearch", () => {
  it("joins counts from results with details from included issues", () => {
    const [first, second] = parseSearch(
      JSON.parse(fixture("datadog-search.json"))
    )
    expect(first).toMatchObject({
      id: ID,
      errorType: "NoMethodError",
      service: "gravity.grape",
      totalCount: 120,
      impactedUsers: 9,
      firstSeen: 1762862400000,
      firstSeenVersion: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    })
    expect(second.errorType).toBe("Net::ReadTimeout")
    expect(second.impactedUsers).toBe(0)
  })

  it("lowercases the first seen version", () => {
    const [issue] = parseSearch(searchResponse([{ id: "x", firstSeen: 1 }]))
    expect(issue.firstSeenVersion).toBe("abcdef1234567")
  })

  it("returns nothing for an empty response", () => {
    expect(parseSearch({})).toEqual([])
  })
})

describe("searchIssues", () => {
  it("posts a search request with both keys and the include list", async () => {
    const fetch = respond(200, fixture("datadog-search.json"))
    const issues = await searchIssues(configWith(fetch), {
      query: "env:production service:(gravity)",
      from: 1,
      to: 2,
    })
    expect(issues).toHaveLength(2)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(
      "https://api.datadoghq.com/api/v2/error-tracking/issues/search?include=issue,issue.impacted_users"
    )
    expect(init.headers["DD-API-KEY"]).toBe("api")
    expect(init.headers["DD-APPLICATION-KEY"]).toBe("app")
    expect(JSON.parse(init.body!).data.attributes).toEqual({
      query: "env:production service:(gravity)",
      from: 1,
      to: 2,
      track: "trace",
      order_by: "TOTAL_COUNT",
      states: ["OPEN"],
    })
  })

  it("throws on an auth failure instead of returning an empty list", async () => {
    const fetch = respond(403, '{"errors":["Forbidden"]}')
    await expect(
      searchIssues(configWith(fetch), { query: "q", from: 1, to: 2 })
    ).rejects.toThrow(DatadogError)
  })

  it("throws on a body that is not JSON", async () => {
    await expect(
      searchIssues(configWith(respond(200, "<html>")), {
        query: "q",
        from: 1,
        to: 2,
      })
    ).rejects.toThrow("invalid JSON")
  })
})

describe("searchNewIssues", () => {
  const FROM = 1_000_000
  const issues = (count: number, oldest: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      firstSeen: i === count - 1 ? oldest : FROM + (count - i) * 1000,
    }))

  it("orders by first seen", async () => {
    const fetch = respond(200, fixture("datadog-search.json"))
    await searchNewIssues(configWith(fetch), { query: "q", from: FROM, to: 2 })
    expect(
      JSON.parse(fetch.mock.calls[0][1].body!).data.attributes.order_by
    ).toBe("FIRST_SEEN")
  })

  it("accepts a full page that reaches past the start of the window", async () => {
    const body = JSON.stringify(searchResponse(issues(SEARCH_LIMIT, FROM - 1)))
    const found = await searchNewIssues(configWith(respond(200, body)), {
      query: "q",
      from: FROM,
      to: 2,
    })
    expect(found).toHaveLength(SEARCH_LIMIT)
  })

  it("throws on a full page still inside the window", async () => {
    const body = JSON.stringify(searchResponse(issues(SEARCH_LIMIT, FROM)))
    await expect(
      searchNewIssues(configWith(respond(200, body)), {
        query: "q",
        from: FROM,
        to: 2,
      })
    ).rejects.toThrow("full page")
  })

  it("throws on a full page that is not newest first", async () => {
    const page = issues(SEARCH_LIMIT, FROM - 1)
    page[0].firstSeen = FROM - 5
    await expect(
      searchNewIssues(
        configWith(respond(200, JSON.stringify(searchResponse(page)))),
        { query: "q", from: FROM, to: 2 }
      )
    ).rejects.toThrow("full page")
  })
})

describe("getIssue", () => {
  it("reads one issue", async () => {
    const issue = await getIssue(
      configWith(respond(200, fixture("datadog-issue.json"))),
      ID
    )
    expect(issue.errorMessage).toBe("undefined method 'user' for nil")
    expect(issue.totalCount).toBe(0)
  })

  it("refuses a response for another id", async () => {
    await expect(
      getIssue(configWith(respond(200, fixture("datadog-issue.json"))), "other")
    ).rejects.toThrow("not found")
  })
})

describe("latestErrorSpan", () => {
  it("queries by issue id and reads the stack from custom.error", async () => {
    const fetch = respond(200, fixture("datadog-span.json"))
    const span = await latestErrorSpan(configWith(fetch), ID)
    expect(span?.stack).toContain("collector_profile_presenter.rb:7")
    expect(span?.resourceName).toBe("GET /api/v1/me/collector_profile")
    expect(span?.url).toContain("api.artsy.net")
    const body = JSON.parse(fetch.mock.calls[0][1].body!)
    expect(body.data.attributes.filter.query).toBe(
      `env:production status:error @issue.id:${ID}`
    )
  })

  it("returns null when no span was kept", async () => {
    expect(
      await latestErrorSpan(configWith(respond(200, '{"data":[]}')), ID)
    ).toBeNull()
  })
})

it("builds the Error Tracking permalink", () => {
  expect(permalink("datadoghq.com", ID)).toBe(
    `https://app.datadoghq.com/error-tracking/issue/${ID}`
  )
})
