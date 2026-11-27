import {
  areasFor,
  bumpFor,
  FIRST_VERSION,
  formatRelease,
  formatVersion,
  type Merge,
  mergeTitle,
  nextVersion,
  parseVersion,
  planReleases,
  prNumber,
  sectionFor,
} from "./release"

const merge = (overrides: Partial<Merge> = {}): Merge => ({
  sha: "a".repeat(40),
  title: "feat: Fable experiment (#175)",
  body: "",
  date: "2026-11-17T09:23:52+01:00",
  files: ["fable-experiment/README.md", "scripts/build-review-prompt.ts"],
  ...overrides,
})

describe("parseVersion", () => {
  it("reads vX.Y.Z and rejects anything else", () => {
    expect(parseVersion("v1.12.3")).toEqual({ major: 1, minor: 12, patch: 3 })
    expect(parseVersion("1.2.3")).toBeUndefined()
    expect(parseVersion("v1.2")).toBeUndefined()
    expect(parseVersion("v1.2.3-beta")).toBeUndefined()
  })
})

describe("bumpFor", () => {
  it.each([
    ["feat: add a thing (#1)", "minor"],
    ["feat(review): add a thing", "minor"],
    ["fix: a bug", "patch"],
    ["chore: tidy", "patch"],
    ["docs: words", "patch"],
    ['Revert "feat: a thing" (#115)', "patch"],
    ["Add someone to participants list (#127)", "patch"],
    ["feat!: drop an input", "major"],
    ["fix(review)!: rename an output", "major"],
  ])("%s is %s", (title, bump) => {
    expect(bumpFor(title)).toBe(bump)
  })

  it("is major with a BREAKING CHANGE footer", () => {
    expect(bumpFor("feat: a thing", "Body\n\nBREAKING CHANGE: drops x")).toBe(
      "major"
    )
    expect(bumpFor("fix: a thing", "mentions breaking change in prose")).toBe(
      "patch"
    )
  })
})

describe("nextVersion", () => {
  const v = { major: 1, minor: 4, patch: 2 }

  it("bumps and resets the lower parts", () => {
    expect(formatVersion(nextVersion(v, "patch"))).toBe("v1.4.3")
    expect(formatVersion(nextVersion(v, "minor"))).toBe("v1.5.0")
    expect(formatVersion(nextVersion(v, "major"))).toBe("v2.0.0")
  })
})

describe("mergeTitle", () => {
  it("keeps a squash merge's subject", () => {
    expect(mergeTitle("fix: a bug (#12)", "")).toBe("fix: a bug (#12)")
  })

  it("takes a merge commit's title from its body, with the PR number", () => {
    expect(
      mergeTitle(
        "Merge pull request #114 from artsy/egdbear/fix-dd-triage-oidc",
        "\nfix: grant id-token for dd-triage\n"
      )
    ).toBe("fix: grant id-token for dd-triage (#114)")
  })

  it("keeps the subject when a merge commit has no body", () => {
    const subject = "Merge pull request #9 from artsy/branch"
    expect(mergeTitle(subject, "  \n")).toBe(subject)
  })
})

describe("prNumber", () => {
  it("reads a trailing (#N)", () => {
    expect(prNumber("feat: a thing (#175)")).toBe("175")
    expect(prNumber("feat: see #12 for more")).toBeUndefined()
  })
})

describe("areasFor", () => {
  it("names each area once, in a fixed order", () => {
    expect(
      areasFor([
        "README.md",
        "scripts/review-risk.ts",
        "fable-experiment/participants.yml",
        "scripts/review-risk.test.ts",
      ])
    ).toEqual(["AI review experiments", "AI review", "Docs"])
  })

  it.each([
    [".github/workflows/claude-review.yml", "AI review"],
    [".github/workflows/agent-review.yml", "AI review"],
    [".github/workflows/run-agent-review.yml", "AI review"],
    ["review/datadog/dashboard.json", "AI review"],
    [".claude/agents/duchamp-security-reviewer.md", "AI review"],
    ["docs/enabling-ai-review.md", "AI review"],
    ["scripts/on-call/next-on-call.ts", "Incidents and on-call"],
    [
      ".github/workflows/incident-standup-reminder.yml",
      "Incidents and on-call",
    ],
    [".github/workflows/daily-datadog-triage.yml", "Datadog triage"],
    [".github/actions/link-pr-to-notion/index.ts", "Notion"],
    [".github/workflows/run-danger-yarn.yml", "Danger and PR checks"],
    [".github/actions/setup-and-install/action.yml", "Danger and PR checks"],
    ["scripts/npm-audit.js", "Danger and PR checks"],
    [".github/workflows/release.yml", "Releases"],
    ["docs/actions.md", "Docs"],
    ["templates/run-claude-review.yml", "AI review"],
    ["templates/run-agent-review.yml", "AI review"],
    ["templates/run-daily-datadog-triage.yml", "Datadog triage"],
    ["templates/run-dangerfile.yml", "Danger and PR checks"],
    ["danger-yarn.ts", "Danger and PR checks"],
    [".github/workflows/open-agent-wrappers-pr.yml", "Agent wrappers"],
    ["scripts/sync-agent-wrappers.sh", "Agent wrappers"],
    ["review-styles/README.md", "AI review"],
    ["package.json", "Tooling"],
  ])("puts %s under %s", (file, area) => {
    expect(areasFor([file])).toEqual([area])
  })

  it("is empty for no files", () => {
    expect(areasFor([])).toEqual([])
  })
})

describe("sectionFor", () => {
  it.each([
    ["feat: a thing", "🚀  Enhancement"],
    ["fix: a bug", "🐛  Bug Fix"],
    ["perf: faster", "🐛  Bug Fix"],
    ['Revert "feat: a thing" (#115)', "🐛  Bug Fix"],
    ["revert: undo danger upgrades", "🐛  Bug Fix"],
    ["docs: words", "📝  Documentation"],
    ["chore: tidy", "🏠  Internal"],
    ["ci: a job", "🏠  Internal"],
    ["Add someone to participants list", "🏠  Internal"],
    ["feat!: drop an input", "💥  Breaking Change"],
  ])("%s goes under %s", (title, section) => {
    expect(sectionFor(title)).toBe(section)
  })
})

describe("formatRelease", () => {
  it("lays the notes out like auto, with areas, author and a compare link", () => {
    const release = formatRelease(
      { major: 1, minor: 67, patch: 0 },
      merge({ author: { login: "MounirDhahri", name: "Mounir Dhahri" } }),
      "artsy/duchamp",
      { major: 1, minor: 66, patch: 0 }
    )

    expect(release.tag).toBe("v1.67.0")
    expect(release.name).toBe("v1.67.0")
    expect(release.sha).toBe("a".repeat(40))
    expect(release.notes).toBe(
      [
        "#### 🚀  Enhancement",
        "",
        "- feat: Fable experiment [#175](https://github.com/artsy/duchamp/pull/175) ([@MounirDhahri](https://github.com/MounirDhahri))",
        "",
        "#### 🗂️  Areas",
        "",
        "- 🧪 AI review experiments",
        "- 🤖 AI review",
        "",
        "#### Authors: 1",
        "",
        "- Mounir Dhahri ([@MounirDhahri](https://github.com/MounirDhahri))",
        "",
        "Merged 2026-11-17 · [v1.66.0...v1.67.0](https://github.com/artsy/duchamp/compare/v1.66.0...v1.67.0)",
      ].join("\n")
    )
  })

  it("links the commit, and leaves out areas, authors and compare when unknown", () => {
    const release = formatRelease(
      FIRST_VERSION,
      merge({ title: "Initial commit", files: [] }),
      "artsy/duchamp"
    )

    expect(release.notes).toBe(
      [
        "#### 🏠  Internal",
        "",
        `- Initial commit [\`aaaaaaa\`](https://github.com/artsy/duchamp/commit/${"a".repeat(40)})`,
        "",
        "Merged 2026-11-17",
      ].join("\n")
    )
  })

  it("lists a bot by login only", () => {
    const release = formatRelease(
      FIRST_VERSION,
      merge({ author: { login: "dependabot[bot]" } }),
      "artsy/duchamp"
    )

    expect(release.notes).toContain(
      "- [@dependabot[bot]](https://github.com/dependabot[bot])"
    )
  })

  it("warns about a breaking change under its section", () => {
    const release = formatRelease(
      { major: 2, minor: 0, patch: 0 },
      merge({ title: "feat!: drop an input (#200)" }),
      "artsy/duchamp"
    )

    expect(release.notes.split("\n").slice(0, 5)).toEqual([
      "#### 💥  Breaking Change",
      "",
      "- feat!: drop an input [#200](https://github.com/artsy/duchamp/pull/200)",
      "",
      "Callers on `@main` already run this. Check their workflows.",
    ])
  })
})

describe("planReleases", () => {
  it("starts at v1.0.0 with no earlier tag, then bumps per merge", () => {
    const tags = planReleases(
      undefined,
      [
        merge({ title: "Initial commit" }),
        merge({ title: "feat: one (#2)" }),
        merge({ title: "fix: two (#3)" }),
        merge({ title: "feat: three (#4)" }),
      ],
      "artsy/duchamp"
    ).map(release => release.tag)

    expect(tags).toEqual(["v1.0.0", "v1.1.0", "v1.1.1", "v1.2.0"])
  })

  it("continues from the latest tag", () => {
    const tags = planReleases(
      { major: 1, minor: 66, patch: 3 },
      [
        merge({ title: "docs: words (#176)" }),
        merge({ title: "feat!: x (#177)" }),
      ],
      "artsy/duchamp"
    ).map(release => release.tag)

    expect(tags).toEqual(["v1.66.4", "v2.0.0"])
  })

  it("is empty with nothing to release", () => {
    expect(planReleases({ major: 1, minor: 0, patch: 0 }, [], "r")).toEqual([])
  })
})
