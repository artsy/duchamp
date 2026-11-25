import {
  formatTopicSkillsSection,
  topicSkillPath,
  topicSkillsFor,
} from "./topic-skills"

describe("topicSkillsFor", () => {
  it("returns the skills listed for the repo, in any case", () => {
    const stripe = ["stripe-best-practices"]
    expect(topicSkillsFor("artsy/gravity").map(t => t.skill)).toEqual(stripe)
    expect(topicSkillsFor("artsy/Force").map(t => t.skill)).toEqual(stripe)
  })

  it("places a skill under its vendor's folder", () => {
    expect(topicSkillPath(topicSkillsFor("artsy/eigen")[0])).toBe(
      "stripe/stripe-best-practices"
    )
  })

  it("returns nothing for an unlisted repo or no repo", () => {
    expect(topicSkillsFor("artsy/volt")).toEqual([])
    expect(topicSkillsFor(undefined)).toEqual([])
  })
})

describe("formatTopicSkillsSection", () => {
  const stripe = {
    skill: "stripe-best-practices",
    vendor: "stripe",
    repos: [],
    when: "Stripe integration code",
  }

  it("is empty with no skills", () => {
    expect(formatTopicSkillsSection([])).toBe("")
  })

  it("lets the reviewer decide, and limits the review to the changed code", () => {
    const section = formatTopicSkillsSection([stripe])
    expect(section).toContain("## Topic Practices")
    expect(section).toContain(
      "decide for each whether the diff touches the code it covers"
    )
    expect(section).toContain(
      "If it doesn't, don't run it and don't mention it"
    )
    expect(section).toContain(
      "- `stripe-best-practices`: Stripe integration code."
    )
    expect(section).toContain("under Suggestions")
    expect(section).toContain(
      "Don't ask for an upgrade only because a newer version exists"
    )
    expect(section).toContain("Judge only the code the diff changes")
    expect(section).toContain("If the Skill tool says a skill does not exist")
    expect(section).toContain("say in one line which skills ran")
  })

  it("lists several skills with their topics", () => {
    const section = formatTopicSkillsSection([
      stripe,
      { skill: "other", vendor: "v", repos: [], when: "other code" },
    ])
    expect(section).toContain(
      "- `stripe-best-practices`: Stripe integration code."
    )
    expect(section).toContain("- `other`: other code.")
  })
})
