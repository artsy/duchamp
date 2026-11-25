import * as fs from "fs"
import * as yaml from "js-yaml"
import * as path from "path"
import { TOPIC_SKILLS, topicSkillPath } from "./topic-skills"

const root = path.join(__dirname, "..")
const skills = Object.keys(
  yaml.load(
    fs.readFileSync(path.join(root, "review", "skills.yml"), "utf8")
  ) as Record<string, string[]>
)

describe("TOPIC_SKILLS against .claude/topic-skills", () => {
  const topicDir = path.join(root, ".claude", "topic-skills")

  it.each(TOPIC_SKILLS.map(topic => [topic.skill, topicSkillPath(topic)]))(
    "%s has a SKILL.md whose name matches its folder",
    (skill, skillPath) => {
      const skillMd = fs.readFileSync(
        path.join(topicDir, skillPath, "SKILL.md"),
        "utf8"
      )
      expect(skillMd.match(/^name: (.+)$/m)?.[1].trim()).toBe(skill)
    }
  )

  it("gives every entry repos and a description of its code", () => {
    for (const { repos, when } of TOPIC_SKILLS) {
      expect(repos.length).toBeGreaterThan(0)
      expect(when).not.toBe("")
    }
  })

  it("lists every vendored skill folder, and no two share a name", () => {
    const onDisk = fs
      .readdirSync(topicDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(vendor =>
        fs
          .readdirSync(path.join(topicDir, vendor.name), {
            withFileTypes: true,
          })
          .filter(entry => entry.isDirectory())
          .map(entry => `${vendor.name}/${entry.name}`)
      )
    expect(onDisk.sort()).toEqual(TOPIC_SKILLS.map(topicSkillPath).sort())
    const names = TOPIC_SKILLS.map(({ skill }) => skill)
    expect(new Set(names).size).toBe(names.length)
  })

  it("shares no skill with skills.yml or the review skills", () => {
    const taken = [
      ...skills,
      ...fs.readdirSync(path.join(root, ".claude", "skills")),
    ]
    expect(
      TOPIC_SKILLS.map(({ skill }) => skill).filter(skill =>
        taken.includes(skill)
      )
    ).toEqual([])
  })
})

/** The skills are vendored as is, so an update that adds anything but Markdown fails here. */
describe(".claude/topic-skills/stripe", () => {
  const dir = path.join(root, ".claude", "topic-skills", "stripe")

  it("keeps its LICENSE and a SOURCE.md that names a commit", () => {
    expect(fs.existsSync(path.join(dir, "LICENSE"))).toBe(true)
    expect(fs.readFileSync(path.join(dir, "SOURCE.md"), "utf8")).toMatch(
      /[0-9a-f]{40}/
    )
  })

  it("holds only Markdown, apart from the LICENSE", () => {
    const files = fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
    expect(files.filter(f => f !== "LICENSE" && !f.endsWith(".md"))).toEqual([])
  })
})
