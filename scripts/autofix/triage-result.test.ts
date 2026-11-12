import {
  findTriageIssue,
  parseStructuredOutput,
  summaryMarkdown,
  TRIAGE_SCHEMA,
  type ValidateDeps,
  validateEntries,
} from "./triage-result"

const A = "0b7e7c2a-1111-4c1d-9a00-000000000001"
const B = "0b7e7c2a-2222-4c1d-9a00-000000000002"

const entry = (overrides: Record<string, unknown> = {}) => ({
  dd_issue_id: A,
  issue_number: 999,
  root_cause:
    "CollectorProfilePresenter#initialize reads collector_profile.user, but MeEndpoint passes nil for users without a profile.",
  suspect_file: "app/api/v1/me_endpoint.rb",
  suspect_line: 42,
  confidence: "high",
  ...overrides,
})

const deps = (overrides: Partial<ValidateDeps> = {}): ValidateDeps => ({
  candidates: [A, B],
  triageIssues: [
    { number: 12, title: `[triage] NoMethodError: user on nil (dd:${A})` },
    { number: 13, title: `[triage] TypeError: x (dd:${B})` },
  ],
  fileExists: file => file === "app/api/v1/me_endpoint.rb",
  screen: () => new Map(),
  ...overrides,
})

describe("parseStructuredOutput", () => {
  it("fails loudly when the skill returned no result", () => {
    expect(() => parseStructuredOutput(undefined)).toThrow(
      /no structured result/
    )
    expect(() => parseStructuredOutput("  ")).toThrow(/no structured result/)
  })

  it("fails on malformed output", () => {
    expect(() => parseStructuredOutput("TRIAGE FAILED")).toThrow(/not JSON/)
    expect(() => parseStructuredOutput('{"issue": []}')).toThrow(
      /no issues array/
    )
  })

  it("accepts a verified empty run", () => {
    expect(parseStructuredOutput('{"issues": []}')).toEqual([])
  })
})

describe("validateEntries", () => {
  it("accepts a valid entry and takes the issue number from GitHub", () => {
    const { accepted, rejected } = validateEntries([entry()], deps())
    expect(rejected).toEqual([])
    expect(accepted).toEqual([{ ...entry(), issue_number: 12 }])
  })

  it.each([
    [
      { dd_issue_id: "0b7e7c2a-9999-4c1d-9a00-000000000009" },
      "not one of select's candidates",
    ],
    [{ dd_issue_id: "../../x" }, "not one of select's candidates"],
    [
      { root_cause: "x".repeat(601) },
      "root_cause missing or over 600 characters",
    ],
    [{ root_cause: "" }, "root_cause missing or over 600 characters"],
    [
      { suspect_file: "app/missing.rb" },
      "suspect_file is not a file in the repo at base_sha",
    ],
    [
      { suspect_file: "/app/app/api/v1/me_endpoint.rb" },
      "suspect_file is not a file in the repo at base_sha",
    ],
    [
      { suspect_file: "app/../config/x.rb" },
      "suspect_file is not a file in the repo at base_sha",
    ],
    [{ suspect_line: 0 }, "suspect_line is not a positive line number"],
    [{ suspect_line: 1.5 }, "suspect_line is not a positive line number"],
    [{ confidence: "certain" }, "confidence is not high, medium or low"],
  ])("rejects %p", (overrides, reason) => {
    const { accepted, rejected } = validateEntries([entry(overrides)], deps())
    expect(accepted).toEqual([])
    expect(rejected[0].reason).toBe(reason)
  })

  it("allows a null suspect_line", () => {
    expect(
      validateEntries([entry({ suspect_line: null })], deps()).accepted
    ).toHaveLength(1)
  })

  it("drops a duplicate entry", () => {
    const { accepted, rejected } = validateEntries([entry(), entry()], deps())
    expect(accepted).toHaveLength(1)
    expect(rejected).toEqual([{ id: A, reason: "duplicate entry" }])
  })

  it("drops a root cause the screen flags", () => {
    const { accepted, rejected } = validateEntries(
      [entry()],
      deps({
        screen: () =>
          new Map([[A, [{ field: "root_cause", check: "addressed-to-ai" }]]]),
      })
    )
    expect(accepted).toEqual([])
    expect(rejected[0].reason).toBe(
      "screen: suspicious (root_cause: addressed-to-ai)"
    )
  })

  it("drops an entry with no [triage] issue on GitHub", () => {
    const { rejected } = validateEntries([entry()], deps({ triageIssues: [] }))
    expect(rejected[0].reason).toBe("no [triage] issue on GitHub")
  })

  it("strips hidden characters from the root cause", () => {
    const hidden = String.fromCodePoint(0x200b)
    const { accepted } = validateEntries(
      [entry({ root_cause: `nil${hidden} user` })],
      deps()
    )
    expect(accepted[0].root_cause).toBe("nil user")
  })
})

describe("findTriageIssue", () => {
  it("takes the newest [triage] issue with the key, ignoring other titles", () => {
    expect(
      findTriageIssue(
        [
          { number: 1, title: `[triage] old (dd:${A})` },
          { number: 5, title: `[triage] new (dd:${A})` },
          { number: 9, title: `Not triage (dd:${A})` },
        ],
        A
      )?.number
    ).toBe(5)
  })
})

it("matches the schema in the datadog-triage skill", () => {
  expect(TRIAGE_SCHEMA.properties.issues.items.required).toEqual([
    "dd_issue_id",
    "issue_number",
    "root_cause",
    "suspect_file",
    "suspect_line",
    "confidence",
  ])
})

it("summarises accepted and dropped entries", () => {
  const summary = summaryMarkdown(
    [{ ...entry(), issue_number: 12 } as any],
    [{ id: B, reason: "duplicate entry" }]
  )
  expect(summary).toContain(`\`${A}\` → #12, high confidence`)
  expect(summary).toContain(`\`${B}\`: duplicate entry`)
})
