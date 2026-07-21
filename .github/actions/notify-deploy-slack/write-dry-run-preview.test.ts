import {
  formatDryRunMarkdown,
  toFileUrl,
  writeDryRunPreview,
} from "./write-dry-run-preview"

describe("formatDryRunMarkdown", () => {
  it("formats main and thread sections as markdown", () => {
    const markdown = formatDryRunMarkdown({
      projectName: "Volt",
      deployPrUrl: "https://github.com/artsy/volt/pull/11777",
      deployPrNumber: 11777,
      slackChannel: "#product-amber",
      changeCount: 2,
      copySourceSummary: "2 claude, 1 rules",
      messages: {
        mainMessage: ":rocket: A new batch of Volt changes just went live!",
        threadMessage: "Fixes\n\nArtOS: Example — description (PR)",
      },
      outputPath: "tmp/preview.md",
    })

    expect(markdown).toContain("# Volt deploy Slack preview")
    expect(markdown).toContain("- **Copy source:** 2 claude, 1 rules")
    expect(markdown).toContain(
      "[#11777](https://github.com/artsy/volt/pull/11777)"
    )
    expect(markdown).toContain("## Main message")
    expect(markdown).toContain("## Thread reply")
    expect(markdown).not.toContain("```")
    expect(markdown).toContain(
      ":rocket: A new batch of Volt changes just went live!"
    )
  })
})

describe("writeDryRunPreview", () => {
  it("writes a markdown file and returns its absolute path", () => {
    const outputPath = "tmp/test-deploy-slack-preview.md"
    const absolutePath = writeDryRunPreview({
      projectName: "Volt",
      deployPrUrl: "https://github.com/artsy/volt/pull/11777",
      deployPrNumber: 11777,
      slackChannel: "#product-amber",
      changeCount: 1,
      messages: {
        mainMessage: "main",
        threadMessage: "thread",
      },
      outputPath,
    })

    expect(absolutePath).toContain("test-deploy-slack-preview.md")
    expect(toFileUrl(absolutePath)).toBe(`file://${absolutePath}`)
  })
})
