import {
  getTypeLabel,
  groupChangesByType,
  parseConventionalType,
  parseDeployChanges,
  resolveChangeCategory,
  sortTypeKeys,
} from "./parse-commits"

describe("parseDeployChanges", () => {
  it("parses conventional commits with PR numbers", () => {
    const changes = parseDeployChanges([
      "fix(lists): open View on Artsy CMS link in a new tab (#11776)",
      "chore: TOP-336 - paginate artist search (#11755)",
    ])

    expect(changes).toEqual([
      {
        type: "fix",
        scope: "lists",
        description: "open View on Artsy CMS link in a new tab",
        prNumber: 11776,
      },
      {
        type: "chore",
        description: "TOP-336 - paginate artist search",
        prNumber: 11755,
      },
    ])
  })

  it("parses conventional commits without PR numbers", () => {
    const changes = parseDeployChanges([
      "chore: lint only watches AGENTS.md now",
      "fix: stop ArtOS welcome popup from reappearing",
    ])

    expect(changes).toEqual([
      {
        type: "chore",
        description: "lint only watches AGENTS.md now",
      },
      {
        type: "fix",
        description: "stop ArtOS welcome popup from reappearing",
      },
    ])
  })

  it("parses merge commits and dedupes by PR number", () => {
    const changes = parseDeployChanges([
      "chore: remove agent-wrapper sync workflow (#11780)",
      "Merge pull request #11780 from artsy/chore/remove-wrapper-sync",
    ])

    expect(changes).toEqual([
      {
        type: "chore",
        description: "remove agent-wrapper sync workflow",
        prNumber: 11780,
      },
    ])
  })

  it("parses merge commits when no squash commit exists", () => {
    const changes = parseDeployChanges([
      "Merge pull request #11780 from artsy/chore/remove-wrapper-sync",
    ])

    expect(changes).toEqual([
      {
        type: "chore",
        description: "remove wrapper sync",
        prNumber: 11780,
      },
    ])
  })

  it("handles a full deploy PR commit list", () => {
    const changes = parseDeployChanges([
      "fix(lists): open View on Artsy CMS link in a new tab (#11776)",
      "chore: TOP-336 - paginate artist search (#11755)",
      "chore: remove topaz_partner-offer-convo feature flag (#11671)",
      "fix: stop ArtOS welcome popup from reappearing for partners with onbo…",
      "chore: remove agent-wrapper sync caller workflow",
      "chore: lint only watches AGENTS.md now",
      "Merge pull request #11780 from artsy/chore/remove-wrapper-sync",
    ])

    expect(changes).toHaveLength(7)
    expect(changes.map(c => c.type)).toEqual([
      "fix",
      "chore",
      "chore",
      "fix",
      "chore",
      "chore",
      "chore",
    ])
  })
})

describe("groupChangesByType", () => {
  it("groups changes by conventional commit type", () => {
    const groups = groupChangesByType([
      { type: "fix", description: "one", prNumber: 1 },
      { type: "chore", description: "two", prNumber: 2 },
      { type: "fix", description: "three", prNumber: 3 },
    ])

    expect(groups.get("fix")).toHaveLength(2)
    expect(groups.get("chore")).toHaveLength(1)
  })
})

describe("sortTypeKeys", () => {
  it("orders known types before unknown types", () => {
    expect(sortTypeKeys(["chore", "other", "feat", "fix"])).toEqual([
      "feat",
      "fix",
      "chore",
      "other",
    ])
  })
})

describe("getTypeLabel", () => {
  it("returns human-readable labels", () => {
    expect(getTypeLabel("feat")).toBe("Features")
    expect(getTypeLabel("fix")).toBe("Bug fixes")
    expect(getTypeLabel("unknown")).toBe("Other changes")
  })
})

describe("parseConventionalType", () => {
  it("extracts the type prefix from a PR title", () => {
    expect(parseConventionalType("chore: remove feature flag")).toBe("chore")
    expect(parseConventionalType("feat(artos): add preview")).toBe("feat")
  })
})

describe("resolveChangeCategory", () => {
  it("prefers the PR title type over the deploy commit type", () => {
    expect(resolveChangeCategory("chore: remove feature flag", "feat")).toBe(
      "improvements-and-maintenance"
    )
  })

  it("only puts feat PRs in the features section", () => {
    expect(resolveChangeCategory("feat: add preview", "feat")).toBe("features")
    expect(resolveChangeCategory("chore: cleanup", "chore")).toBe(
      "improvements-and-maintenance"
    )
    expect(resolveChangeCategory("fix: bug", "fix")).toBe("fixes")
    expect(resolveChangeCategory("perf: faster search", "perf")).toBe(
      "improvements-and-maintenance"
    )
  })
})
