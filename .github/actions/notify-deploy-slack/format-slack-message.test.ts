import { formatSlackMessages } from "./format-slack-message"

const DEPLOY_PR_URL = "https://github.com/artsy/volt/pull/11777"

describe("formatSlackMessages", () => {
  it("matches the target format with features, fixes, and maintenance", () => {
    const messages = formatSlackMessages("Volt", DEPLOY_PR_URL, [
      {
        category: "features",
        area: "ArtOS",
        title: "Shareable Studio Links",
        description:
          "opening the Instagram, Mailchimp, Tearsheet, or Checklist Studio editor now gives it its own web address you can share, and closing it brings you back to where you were",
        prUrl: "https://github.com/artsy/volt/pull/100",
        ticketUrl: "https://app.notion.com/p/artsy/studio-links",
        ticketLabel: "Notion",
      },
      {
        category: "fixes",
        area: "Artworks",
        title: "Correct Dimension Unit Switching",
        description:
          "editing edition set dimensions and switching units (e.g. cm to in) now immediately shows the converted values instead of briefly showing stale ones",
        prUrl: "https://github.com/artsy/volt/pull/101",
      },
      {
        category: "improvements-and-maintenance",
        area: "ArtOS",
        title: "Clearer Collaborators Input",
        description:
          "the Instagram Editor now shows entered collaborator usernames as separate pills, so multiple names no longer blur together",
        prUrl: "https://github.com/artsy/volt/pull/102",
      },
      {
        category: "improvements-and-maintenance",
        title: "AWS Storage Library Update",
        description:
          "routine dependency update of the aws-sdk-s3 gem, with no visible changes",
        prUrl: "https://github.com/artsy/volt/pull/103",
      },
      {
        category: "improvements-and-maintenance",
        title: "Test Tooling Update",
        description:
          "routine update of the selenium-webdriver tool used for automated browser tests",
        prUrl: "https://github.com/artsy/volt/pull/104",
      },
    ])

    expect(messages.mainMessage).toBe(
      [
        `:rocket: A new batch of Volt changes just went live (<${DEPLOY_PR_URL}|PR>)!`,
        "",
        "New Features",
        "",
        "ArtOS: *Shareable Studio Links* — opening the Instagram, Mailchimp, Tearsheet, or Checklist Studio editor now gives it its own web address you can share, and closing it brings you back to where you were (<https://github.com/artsy/volt/pull/100|PR> · <https://app.notion.com/p/artsy/studio-links|Notion>)",
        "",
        "",
        "Check the thread for fixes and improvements :thread:",
      ].join("\n")
    )

    expect(messages.threadMessage).toBe(
      [
        "Fixes",
        "",
        "Artworks: *Correct Dimension Unit Switching* — editing edition set dimensions and switching units (e.g. cm to in) now immediately shows the converted values instead of briefly showing stale ones (<https://github.com/artsy/volt/pull/101|PR>)",
        "",
        "",
        "Improvements & Maintenance",
        "",
        "ArtOS: *Clearer Collaborators Input* — the Instagram Editor now shows entered collaborator usernames as separate pills, so multiple names no longer blur together (<https://github.com/artsy/volt/pull/102|PR>)",
        "*AWS Storage Library Update* — routine dependency update of the aws-sdk-s3 gem, with no visible changes (<https://github.com/artsy/volt/pull/103|PR>)",
        "*Test Tooling Update* — routine update of the selenium-webdriver tool used for automated browser tests (<https://github.com/artsy/volt/pull/104|PR>)",
      ].join("\n")
    )
  })

  it("omits the New Features section when there are no features", () => {
    const messages = formatSlackMessages("Volt", DEPLOY_PR_URL, [
      {
        category: "fixes",
        area: "ArtOS",
        title: "Stop ArtOS Welcome Popup From Reappearing",
        description:
          "The welcome popup no longer keeps reappearing for partners who've started onboarding",
        prUrl: "https://github.com/artsy/volt/pull/11779",
      },
    ])

    expect(messages.mainMessage).toBe(
      [
        `:rocket: A new batch of Volt changes just went live (<${DEPLOY_PR_URL}|PR>)!`,
        "",
        "Check the thread for fixes and improvements :thread:",
      ].join("\n")
    )
    expect(messages.threadMessage).toContain("Fixes")
    expect(messages.mainMessage).not.toContain("New Features")
  })

  it("includes feature flags in the link list", () => {
    const messages = formatSlackMessages("Volt", DEPLOY_PR_URL, [
      {
        category: "improvements-and-maintenance",
        area: "Conversations",
        title: "Remove Topaz Partner-Offer-Convo Feature Flag",
        description: "Partner offers in conversations are now always enabled",
        prUrl: "https://github.com/artsy/volt/pull/11671",
        ticketUrl: "https://artsyproduct.atlassian.net/browse/TOP-324",
        ticketLabel: "Jira",
        featureFlag: { name: "topaz_partner-offer-convo" },
      },
    ])

    expect(messages.threadMessage).toContain(
      "(<https://github.com/artsy/volt/pull/11671|PR> · <https://artsyproduct.atlassian.net/browse/TOP-324|Jira> · topaz_partner-offer-convo)"
    )
  })
})
