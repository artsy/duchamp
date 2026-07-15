import {
  detectArea,
  enrichFromPullRequest,
  extractConciseTitle,
  extractFeatureFlag,
  extractTicketLink,
  humanizeDescription,
  toTitleCase,
} from "./enrich-changes"

describe("detectArea", () => {
  it("maps lists scope to ArtOS", () => {
    expect(
      detectArea(
        "fix(lists): open View on Artsy CMS link in a new tab",
        "",
        "lists"
      )
    ).toBe("ArtOS")
  })

  it("detects ArtOS from studio editor content without an explicit ArtOS mention", () => {
    expect(
      detectArea(
        "feat: shareable studio links",
        "Opening the Instagram Studio editor now gets its own URL"
      )
    ).toBe("ArtOS")
  })

  it("detects Artworks from edition dimension content", () => {
    expect(
      detectArea(
        "fix: correct dimension unit switching",
        "Editing edition set dimensions and switching units"
      )
    ).toBe("Artworks")
  })

  it("detects Conversations from partner offer content", () => {
    expect(
      detectArea(
        "chore: remove topaz_partner-offer-convo feature flag",
        "Removes the feature flag surrounding partner offers"
      )
    ).toBe("Conversations")
  })

  it("returns undefined when area is ambiguous", () => {
    expect(
      detectArea(
        "chore: remove agent-wrapper sync workflow",
        "internal tooling"
      )
    ).toBeUndefined()
  })
})

describe("extractTicketLink", () => {
  it("extracts Notion links", () => {
    expect(
      extractTicketLink(
        "[Notion Ticket](https://app.notion.com/p/artsy/Welcome-popup-appears-multiple-times-398cab0764a08029a97fc95a5a0e1c0e)"
      )
    ).toEqual({
      url: "https://app.notion.com/p/artsy/Welcome-popup-appears-multiple-times-398cab0764a08029a97fc95a5a0e1c0e",
      label: "Notion",
    })
  })

  it("extracts Jira links", () => {
    expect(
      extractTicketLink(
        "This PR resolves [TOP-324]\n\n[TOP-324]: https://artsyproduct.atlassian.net/browse/TOP-324?atlOrigin=abc"
      )
    ).toEqual({
      url: "https://artsyproduct.atlassian.net/browse/TOP-324?atlOrigin=abc",
      label: "Jira",
    })
  })
})

describe("extractFeatureFlag", () => {
  it("extracts a feature flag name from PR text", () => {
    expect(
      extractFeatureFlag(
        "chore: remove topaz_partner-offer-convo feature flag",
        "Removes the feature flag surrounding partner offers"
      )
    ).toEqual({
      name: "topaz_partner-offer-convo",
      url: undefined,
    })
  })
})

describe("extractConciseTitle", () => {
  it("converts a conventional PR title to title case", () => {
    expect(
      extractConciseTitle(
        "fix(lists): open View on Artsy CMS link in a new tab"
      )
    ).toBe("Open View on Artsy CMS Link in a New Tab")
  })
})

describe("toTitleCase", () => {
  it("preserves product names and acronyms", () => {
    expect(toTitleCase("stop artos welcome popup from reappearing")).toBe(
      "Stop ArtOS Welcome Popup from Reappearing"
    )
  })
})

describe("humanizeDescription", () => {
  it("prefers the PR description over the title", () => {
    expect(
      humanizeDescription(
        "fix(lists): open View on Artsy CMS link in a new tab",
        'After creating a Show/Fair via "Add to Artsy", the "View on Artsy CMS" link navigated in the same tab, losing the collection view. Open it in a new tab instead.'
      )
    ).toBe(
      'After creating a Show/Fair via "Add to Artsy", the "View on Artsy CMS" link navigated in the same tab, losing the colle…'
    )
  })

  it("falls back to a cleaned title", () => {
    expect(
      humanizeDescription("chore: remove agent-wrapper sync workflow", "")
    ).toBe("Removed the agent-wrapper sync workflow")
  })
})

describe("enrichFromPullRequest", () => {
  it("enriches a fix PR with area, title, description, and links", () => {
    const enriched = enrichFromPullRequest(
      {
        type: "fix",
        scope: "lists",
        description: "open View on Artsy CMS link in a new tab",
        prNumber: 11776,
      },
      {
        title: "fix(lists): open View on Artsy CMS link in a new tab",
        body: "[Notion Ticket](https://app.notion.com/p/artsy/show-fair-link)\n\nOpen it in a new tab instead.",
        html_url: "https://github.com/artsy/volt/pull/11776",
      }
    )

    expect(enriched.category).toBe("fixes")
    expect(enriched.area).toBe("ArtOS")
    expect(enriched.title).toBe("Open View on Artsy CMS Link in a New Tab")
    expect(enriched.description).toBe("Open it in a new tab instead.")
    expect(enriched.prUrl).toBe("https://github.com/artsy/volt/pull/11776")
    expect(enriched.ticketLabel).toBe("Notion")
  })

  it("keeps chore PRs out of the features section even if the deploy commit type differs", () => {
    const enriched = enrichFromPullRequest(
      {
        type: "feat",
        description: "paginate artist search",
        prNumber: 11755,
      },
      {
        title: "chore: TOP-336 - paginate artist search",
        body: "Paginate the artist search functionality.",
        html_url: "https://github.com/artsy/volt/pull/11755",
      }
    )

    expect(enriched.category).toBe("improvements-and-maintenance")
  })

  it("uses plain-language titles for routine dependency updates", () => {
    const enriched = enrichFromPullRequest(
      {
        type: "chore",
        description: "bump aws-sdk-s3",
        prNumber: 200,
      },
      {
        title: "chore: bump aws-sdk-s3 gem",
        body: "Routine dependency update for aws-sdk-s3 gem.",
        html_url: "https://github.com/artsy/volt/pull/200",
      }
    )

    expect(enriched.title).toBe("AWS Storage Library Update")
    expect(enriched.description).toBe(
      "Routine dependency update of the aws-sdk-s3 gem, with no visible changes"
    )
  })
})
