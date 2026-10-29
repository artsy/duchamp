import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import {
  formatStackSkillsSection,
  isAppCodePath,
  loadStackSkills,
  resolveStackSkills,
} from "./stack-skills"

jest.mock("fs")
jest.mock("child_process")

const mockFs = fs as jest.Mocked<typeof fs>
const mockGit = execFileSync as jest.Mock

const SKILLS_YML = `react-native-best-practices:
  - artsy/eigen
  - artsy/Energy
not-vendored:
  - artsy/eigen
`

/** skills.yml holds `skillsYml`; only the named skills have a SKILL.md. */
const mockTooling = (skillsYml: string | null, vendored: string[]): void => {
  mockFs.existsSync.mockImplementation(p => {
    const file = String(p)
    if (file.endsWith(path.join("review", "skills.yml"))) {
      return skillsYml !== null
    }
    return vendored.some(skill =>
      file.endsWith(path.join(".claude", "skills", skill, "SKILL.md"))
    )
  })
  mockFs.readFileSync.mockReturnValue(skillsYml ?? "")
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, "error").mockImplementation(() => {})
})

describe("loadStackSkills", () => {
  it("returns the vendored skills listed for the repo, in any case", () => {
    mockTooling(SKILLS_YML, ["react-native-best-practices"])
    expect(loadStackSkills("artsy/eigen")).toEqual([
      "react-native-best-practices",
    ])
    expect(loadStackSkills("artsy/energy")).toEqual([
      "react-native-best-practices",
    ])
  })

  it("warns about a listed skill that isn't vendored", () => {
    mockTooling(SKILLS_YML, ["react-native-best-practices"])
    loadStackSkills("artsy/eigen")
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("not-vendored")
    )
  })

  it("returns nothing for an unlisted repo, no repo or no file", () => {
    mockTooling(SKILLS_YML, ["react-native-best-practices"])
    expect(loadStackSkills("artsy/force")).toEqual([])
    expect(loadStackSkills(undefined)).toEqual([])
    mockTooling(null, [])
    expect(loadStackSkills("artsy/eigen")).toEqual([])
  })

  it("returns nothing for malformed YAML", () => {
    mockTooling("react-native-best-practices: [", [])
    expect(loadStackSkills("artsy/eigen")).toEqual([])
  })
})

describe("isAppCodePath", () => {
  it.each([
    "src/app/Scenes/Artwork/Artwork.tsx",
    "src/app/utils/formatPrice.ts",
  ])("counts %s", file => {
    expect(isAppCodePath(file)).toBe(true)
  })

  it.each([
    "src/app/Scenes/Artwork/__tests__/Artwork.tests.tsx",
    "src/app/Scenes/Artwork/Artwork.test.tsx",
    "src/app/Components/Button.stories.tsx",
    "src/__generated__/ArtworkQuery.graphql.ts",
    "src/types/env.d.ts",
    "ios/Artsy/AppDelegate.m",
    "README.md",
  ])("leaves out %s", file => {
    expect(isAppCodePath(file)).toBe(false)
  })
})

describe("resolveStackSkills", () => {
  const range = "origin/main...HEAD"

  beforeEach(() => {
    mockTooling(SKILLS_YML, ["react-native-best-practices"])
  })

  it("runs the repo's skills when the diff touches app code", () => {
    mockGit.mockReturnValue("README.md\nsrc/app/Scenes/Home.tsx\n")
    expect(resolveStackSkills(true, "artsy/eigen", range, [])).toEqual({
      skills: ["react-native-best-practices"],
      reason: "the diff touches app code",
    })
    const [cmd, args] = mockGit.mock.calls[0]
    expect(cmd).toBe("git")
    expect(args).toEqual(expect.arrayContaining(["diff", "--name-only", range]))
  })

  it("skips a diff with no app code", () => {
    mockGit.mockReturnValue("ios/Podfile\nsrc/app/__tests__/Home.tests.tsx\n")
    expect(resolveStackSkills(true, "artsy/eigen", range, []).skills).toEqual(
      []
    )
  })

  it("skips PRs outside the experiment without reading anything", () => {
    expect(resolveStackSkills(false, "artsy/eigen", range, [])).toEqual({
      skills: [],
      reason: "not in the best-practices experiment",
    })
    expect(mockGit).not.toHaveBeenCalled()
  })

  it("skips repos with no skills without reading the diff", () => {
    expect(resolveStackSkills(true, "artsy/force", range, []).skills).toEqual(
      []
    )
    expect(mockGit).not.toHaveBeenCalled()
  })

  it("skips when git fails or there is no range", () => {
    mockGit.mockImplementation(() => {
      throw new Error("bad revision")
    })
    expect(resolveStackSkills(true, "artsy/eigen", range, [])).toEqual({
      skills: [],
      reason: "could not read the diff: bad revision",
    })
    expect(
      resolveStackSkills(true, "artsy/eigen", undefined, []).skills
    ).toEqual([])
  })
})

describe("formatStackSkillsSection", () => {
  it("is empty with no skills", () => {
    expect(formatStackSkillsSection([])).toBe("")
  })

  it("names the skill and the rules for its findings", () => {
    const section = formatStackSkillsSection(["react-native-best-practices"])
    expect(section).toContain("## Stack Practices")
    expect(section).toContain(
      "run this skill with the Skill tool: `react-native-best-practices`"
    )
    expect(section).toContain("(rule: js-lists-flatlist-flashlist)")
    expect(section).toContain("under Suggestions")
    expect(section).toContain("Do not run its profiling or build commands")
  })

  it("lists several skills", () => {
    expect(formatStackSkillsSection(["a", "b"])).toContain(
      "each of these skills with the Skill tool: `a`, `b`"
    )
  })
})
