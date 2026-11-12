import type { GuardResult } from "./guards"
import { branchName, decide, reviewers } from "./publish"

const passing: GuardResult = {
  ok: true,
  reasons: [],
  sensitive: [],
  weightedLines: 4,
  files: ["app/x.rb", "spec/x_spec.rb"],
}

const result = (decision: "fix" | "skip") => ({
  decision,
  confidence: "high",
  root_cause: "",
  hypotheses: [],
  summary: "not a code bug",
})

describe("decide", () => {
  it("rejects a missing result.json", () => {
    expect(
      decide({ result: null, applied: true, guards: () => passing })
    ).toMatchObject({
      verdict: "reject",
      reasons: ["the agent wrote no valid result.json"],
    })
  })

  it("skips when the agent skipped, without running the guards", () => {
    const guards = jest.fn(() => passing)
    expect(
      decide({ result: result("skip"), applied: false, guards }).verdict
    ).toBe("skip")
    expect(guards).not.toHaveBeenCalled()
  })

  it("rejects patches that did not apply", () => {
    expect(
      decide({ result: result("fix"), applied: false, guards: () => passing })
    ).toMatchObject({
      verdict: "reject",
      reasons: ["the patches are missing or do not apply to base_sha"],
    })
  })

  it("follows the guards", () => {
    expect(
      decide({ result: result("fix"), applied: true, guards: () => passing })
        .verdict
    ).toBe("publish")
    expect(
      decide({
        result: result("fix"),
        applied: true,
        guards: () => ({ ...passing, ok: false, reasons: ["x"] }),
      })
    ).toMatchObject({ verdict: "reject", reasons: ["x"] })
  })
})

describe("reviewers", () => {
  it("adds the suspect author after the owner", () => {
    expect(reviewers("MounirDhahri", "octocat")).toEqual([
      "MounirDhahri",
      "octocat",
    ])
  })

  it.each([null, "mounirdhahri", "bad login!", "-x"])(
    "falls back to the owner for %p",
    author => {
      expect(reviewers("MounirDhahri", author)).toEqual(["MounirDhahri"])
    }
  )
})

it("names the branch from the short id", () => {
  expect(branchName("0B7E7C2A-1111-4c1d-9a00-000000000001")).toBe(
    "autofix/dd-0b7e7c2a"
  )
})
