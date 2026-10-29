import * as fs from "fs"
import * as yaml from "js-yaml"
import * as path from "path"

const root = path.join(__dirname, "..")
const skills = Object.keys(
  yaml.load(
    fs.readFileSync(path.join(root, "review", "skills.yml"), "utf8")
  ) as Record<string, string[]>
)

/** Claude Code finds a skill by its frontmatter name, so two with one name collide. */
describe("review/skills.yml against .claude/stack-skills", () => {
  it.each(skills)("%s has a SKILL.md whose name matches its folder", skill => {
    const skillMd = fs.readFileSync(
      path.join(root, ".claude", "stack-skills", skill, "SKILL.md"),
      "utf8"
    )
    expect(skillMd.match(/^name: (.+)$/m)?.[1].trim()).toBe(skill)
  })

  it("gives every artsy-react-native rule a Severity: line", () => {
    const skillMd = fs.readFileSync(
      path.join(
        root,
        ".claude",
        "stack-skills",
        "artsy-react-native",
        "SKILL.md"
      ),
      "utf8"
    )
    const rules = skillMd.split(/^## /m).slice(1)
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule).toMatch(/^Severity: (blocking|required|suggestion)$/m)
    }
  })

  it("has no stack skill named like a review skill", () => {
    const reviewSkills = fs.readdirSync(path.join(root, ".claude", "skills"))
    expect(skills.filter(skill => reviewSkills.includes(skill))).toEqual([])
  })
})
