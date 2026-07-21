import type { EnrichedDeployChange } from "./enrich-changes"
import {
  buildClaudePrompt,
  mergeClaudeSummaries,
  parseClaudeResponse,
  summarizeWithClaude,
} from "./summarize-with-claude"

describe("buildClaudePrompt", () => {
  it("includes PR details and formatting rules", () => {
    const prompt = buildClaudePrompt([
      {
        prNumber: 11786,
        prTitle: "feat(artworks): add public-facing routes for studio",
        prBody: "### Description\n\nPartners can share studio links.",
        category: "features",
        area: "Artworks",
      },
    ])

    expect(prompt).toContain("PR #11786")
    expect(prompt).toContain("Category: New feature")
    expect(prompt).toContain("Suggested area: Artworks")
    expect(prompt).toContain("add public-facing routes for studio")
    expect(prompt).toContain("Return ONLY valid JSON")
  })
})

describe("parseClaudeResponse", () => {
  it("parses a raw JSON array", () => {
    const results = parseClaudeResponse(`[
      {
        "prNumber": 11786,
        "title": "Add Public-facing Routes for Studio",
        "description": "Partners can share direct links to Studio pages.",
        "area": "Artworks"
      }
    ]`)

    expect(results).toEqual([
      {
        prNumber: 11786,
        title: "Add Public-facing Routes for Studio",
        description: "Partners can share direct links to Studio pages.",
        area: "Artworks",
      },
    ])
  })

  it("parses JSON wrapped in a markdown fence", () => {
    const results = parseClaudeResponse(`
Here are the summaries:

\`\`\`json
[{"prNumber": 1, "title": "Example Title", "description": "Example description."}]
\`\`\`
`)

    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe("Example Title")
  })

  it("truncates long descriptions", () => {
    const longDescription = "A".repeat(150)
    const results = parseClaudeResponse(
      `[{"prNumber": 1, "title": "Title", "description": "${longDescription}"}]`
    )

    expect(results[0]?.description.length).toBeLessThanOrEqual(120)
    expect(results[0]?.description.endsWith("…")).toBe(true)
  })

  it("throws when response is not valid JSON", () => {
    expect(() => parseClaudeResponse("not json")).toThrow()
  })
})

describe("mergeClaudeSummaries", () => {
  const ruleBased: EnrichedDeployChange[] = [
    {
      category: "features",
      area: "Artworks",
      title: "Old Title",
      description: "Old description.",
      prNumber: 11786,
      prUrl: "https://github.com/artsy/volt/pull/11786",
      descriptionSource: "rules",
    },
    {
      category: "fixes",
      title: "Commit-only fix",
      description: "Fallback copy.",
      descriptionSource: "rules",
    },
  ]

  it("merges Claude title and description while preserving links and category", () => {
    const merged = mergeClaudeSummaries(ruleBased, [
      {
        prNumber: 11786,
        title: "Add Public-facing Routes for Studio",
        description: "Partners can share direct links to Studio pages.",
        area: "Artworks",
      },
    ])

    expect(merged[0]).toMatchObject({
      category: "features",
      prUrl: "https://github.com/artsy/volt/pull/11786",
      title: "Add Public-facing Routes for Studio",
      description: "Partners can share direct links to Studio pages.",
      descriptionSource: "claude",
    })
    expect(merged[1]).toEqual(ruleBased[1])
  })
})

describe("summarizeWithClaude", () => {
  it("calls the Anthropic API and parses the response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: `[{"prNumber": 11786, "title": "Better Title", "description": "Better description."}]`,
          },
        ],
      }),
    })

    const results = await summarizeWithClaude(
      "test-key",
      [
        {
          prNumber: 11786,
          prTitle: "feat: example",
          prBody: "Example body",
          category: "features",
        },
      ],
      "claude-haiku-4-5-20251001",
      fetchImpl as unknown as typeof fetch
    )

    expect(results[0]?.title).toBe("Better Title")
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-key",
        }),
      })
    )
  })

  it("throws when the API returns an error", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid x-api-key",
    })

    await expect(
      summarizeWithClaude(
        "bad-key",
        [
          {
            prNumber: 1,
            prTitle: "feat: example",
            prBody: "Example body",
            category: "features",
          },
        ],
        "claude-haiku-4-5-20251001",
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow("Anthropic API error (401)")
  })
})
