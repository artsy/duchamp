import {
  BODY_MAX,
  commitMessages,
  isAllowedUrl,
  issueComment,
  parseResult,
  prBody,
  prTitle,
  sanitizeLine,
  sanitizeMarkdown,
  splitCode,
} from "./pr-body"
import type { Meta } from "./select"

const ID = "0b7e7c2a-1111-4c1d-9a00-000000000001"

const meta: Meta = {
  dd_issue_id: ID,
  permalink: `https://app.datadoghq.com/error-tracking/issue/${ID}`,
  service: "gravity.grape",
  error_type: "NoMethodError",
  total_count: 120,
  impacted_users: 9,
  first_seen: "2026-11-11T12:00:00.000Z",
  first_seen_version: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  base_sha: "f".repeat(40),
  suspect_range: { from: "a".repeat(40), to: "b".repeat(40), deploy: 2 },
  suspect_author: "octocat",
  top_frame: { path: "app/presenters/collector_profile_presenter.rb", line: 7 },
}

const sanitize = (text: string) => sanitizeMarkdown(text, BODY_MAX)

describe("parseResult", () => {
  it("reads the agreed shape", () => {
    expect(
      parseResult(
        JSON.stringify({
          decision: "fix",
          confidence: "high",
          root_cause: "nil profile",
          hypotheses: ["one", { rank: 2, text: "two" }],
          summary: "s",
        })
      )
    ).toEqual({
      decision: "fix",
      confidence: "high",
      root_cause: "nil profile",
      hypotheses: ["one", "two"],
      summary: "s",
    })
  })

  it("drops a confidence outside high, medium or low", () => {
    const result = parseResult(
      JSON.stringify({ decision: "fix", confidence: "fixes #9 @x" })
    )
    expect(result?.confidence).toBe("")
    expect(
      prBody({
        meta,
        result: result!,
        agentBody: "",
        triageIssue: null,
        sensitive: [],
        weightedLines: 1,
      })
    ).toContain("- Agent confidence: not given;")
  })

  it.each(["", "not json", '{"decision":"merge"}', "null"])(
    "returns null for %p",
    raw => {
      expect(parseResult(raw)).toBeNull()
    }
  )
})

describe("sanitizeMarkdown", () => {
  it("removes mentions in prose but not in code", () => {
    expect(sanitize("Thanks @octocat and @artsy/eng")).toBe(
      "Thanks octocat and artsy/eng"
    )
    expect(sanitize("`@user = nil`")).toBe("`@user = nil`")
    expect(sanitize("```ruby\n@user = profile.user\n```")).toBe(
      "```ruby\n@user = profile.user\n```"
    )
    expect(sanitize("mail me at a@b.com")).toBe("mail me at a@b.com")
  })

  it("removes closing keywords and issue refs", () => {
    expect(
      sanitize("Fixes #12 and closes artsy/gravity#34, resolves: #5")
    ).toBe("see 12 and see 34, see: 5")
    expect(sanitize("See GH-77")).toBe("See 77")
    expect(sanitize("This fixes the nil")).toBe("This fixes the nil")
  })

  it("removes a closing keyword in front of an issue URL", () => {
    expect(
      sanitizeMarkdown(
        "Fixes https://github.com/artsy/gravity/issues/7 and the fix https://app.datadoghq.com/x",
        500
      )
    ).toBe(
      "see https://github.com/artsy/gravity/issues/7 and the fix https://app.datadoghq.com/x"
    )
  })

  it("keeps allowlisted links and drops the rest", () => {
    expect(sanitize(`[Datadog](${meta.permalink})`)).toBe(
      `[Datadog](${meta.permalink})`
    )
    expect(
      sanitize("[code](https://github.com/artsy/gravity/blob/main/x.rb)")
    ).toBe("[code](https://github.com/artsy/gravity/blob/main/x.rb)")
    expect(sanitize("[click](https://evil.example/x)")).toBe("click")
    expect(sanitize("see https://evil.example/x.")).toBe("see [link removed].")
    expect(sanitize("see www.evil.example")).toBe("see [link removed]")
    expect(sanitize("<https://evil.example>")).toBe("[link removed]")
    expect(sanitize("[x]: https://evil.example\nbody")).toBe("body")
    expect(sanitize("[a](https://github.com/someone-else/repo)")).toBe("a")
  })

  it("drops images from outside the allowlist, even in code", () => {
    expect(sanitize("![pixel](https://evil.example/p.gif) after")).toBe("after")
    expect(
      sanitize('```mermaid\nclick A href "https://evil.example"\n```')
    ).toBe('```mermaid\nclick A href "[link removed]"\n```')
  })

  it("strips raw HTML and comments", () => {
    expect(
      sanitize('<img src="https://evil.example/p.gif"> hi <!-- hidden -->')
    ).toBe("hi")
    expect(sanitize("a <!-- unterminated")).toBe("a")
  })

  it("treats an unclosed fence as code to the end, as GitHub does", () => {
    const text = "intro @a\n```\n@b #1\n"
    expect(splitCode(text).map(part => part.code)).toEqual([false, true])
    expect(sanitize(text)).toBe("intro a\n```\n@b #1")
  })

  it.each([
    "`a\n\n@x Fixes #1\n\nb`",
    "```x`\n@x Fixes #1",
    "cc `@octocat Fixes #1",
  ])("treats text GitHub renders as prose as prose: %p", text => {
    const out = sanitize(text)
    expect(out).not.toMatch(/@/)
    expect(out).not.toMatch(/fixes/i)
    expect(out).not.toMatch(/#\d/)
  })

  it("cuts to length", () => {
    expect(sanitizeMarkdown("x".repeat(50), 10)).toHaveLength(10)
  })
})

it("allows only https on the allowlisted hosts", () => {
  expect(isAllowedUrl("http://app.datadoghq.com/x")).toBe(false)
  expect(isAllowedUrl("https://app.datadoghq.com.evil.example/x")).toBe(false)
  expect(isAllowedUrl("https://github.com/artsy/x")).toBe(true)
  expect(isAllowedUrl("javascript:alert(1)")).toBe(false)
})

it("builds a deterministic title", () => {
  expect(prTitle(meta)).toBe(
    "fix: NoMethodError in app/presenters/collector_profile_presenter.rb"
  )
})

describe("title and commit messages from hostile Datadog text", () => {
  const hostile: Meta = {
    ...meta,
    error_type:
      "Fixes #12 @octocat\ncloses https://github.com/artsy/gravity/issues/3 `@team` artsy/x#4 GH-5",
    top_frame: { path: "app/x.rb\nresolves #6", line: 1 },
  }

  it("sanitises the title like the body", () => {
    const title = prTitle(hostile)
    expect(title).not.toMatch(/[\n\r#@]|https?:|GH-/)
    expect(title).toMatch(/^fix: see 12 octocat /)
    expect(title.length).toBeLessThanOrEqual(5 + 60 + 4 + 80)
  })

  it("sanitises both commit messages and keeps [skip ci]", () => {
    const { test, fix } = commitMessages(hostile)
    for (const message of [test, fix]) {
      expect(message).not.toMatch(/[\n\r#@]|https?:|GH-/)
      expect(message).toMatch(/ \[skip ci\]$/)
    }
    expect(test).toMatch(/^test: reproduce see 12 /)
    expect(fix).toBe(`${prTitle(hostile)} [skip ci]`)
  })

  it("does not let our own fix: prefix close an issue", () => {
    expect(prTitle({ ...meta, error_type: "#12", top_frame: null })).toBe(
      "fix: 12"
    )
  })

  it("caps length", () => {
    expect(sanitizeLine("x".repeat(500), 60)).toHaveLength(60)
  })
})

describe("prBody", () => {
  const body = prBody({
    meta,
    result: {
      decision: "fix",
      confidence: "high",
      root_cause: "",
      hypotheses: ["nil profile @octocat", "stale cache"],
      summary: "",
    },
    agentBody:
      "## Summary\n\nGuard the caller. Fixes #99, cc @someone\n\n## Evidence\n\nSee https://evil.example\n\n## Merge Danger\n\n**Door:** two-way",
    triageIssue: 42,
    sensitive: ["app/models/order.rb"],
    weightedLines: 12,
  })

  it("starts with the fixed header", () => {
    expect(body).toMatch(/^> \[!IMPORTANT\]\n> Opened by autofix/)
    expect(body).toContain("**CI has not run.**")
    expect(body).toContain("`autofix/run-ci`")
    expect(body).toContain("symptom suppression")
    expect(body).toContain("**Update branch**, or any push without `[skip ci]`")
    expect(body).toContain(
      `[NoMethodError](${meta.permalink}), 120 events, 9 users`
    )
    expect(body).toContain("Suspect range: `aaaaaaaaaaaa..bbbbbbbbbbbb`")
  })

  it("links the triage issue in the repo template, and nothing the agent wrote", () => {
    expect(body).toContain("This PR resolves #42\n\n### Description")
    expect(body).not.toContain("#99")
    expect(body).not.toContain("@someone")
    expect(body).not.toContain("@octocat")
    expect(body).not.toContain("evil.example")
    expect(body).toContain("**Door:** two-way")
  })

  it("notes sensitive paths in Merge Danger", () => {
    expect(body).toContain("#### Merge Danger (autofix)")
    expect(body).toContain("`app/models/order.rb`")
  })
})

describe("issueComment", () => {
  it("sanitises the agent's skip reason", () => {
    const comment = issueComment(
      {
        kind: "skipped",
        summary: "Not a bug, closes #3 @octocat https://evil.example",
      },
      "https://github.com/artsy/gravity/actions/runs/1"
    )
    expect(comment).toContain("Not a bug, see 3 octocat [link removed]")
  })

  it("sanitises rejection reasons, which can carry agent-chosen paths", () => {
    expect(
      issueComment(
        { kind: "rejected", reasons: ["path outside the allowlist: @x#1"] },
        "run"
      )
    ).toContain("- path outside the allowlist: x1")
  })
})
