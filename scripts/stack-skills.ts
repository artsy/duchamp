import * as fs from "fs"
import * as yaml from "js-yaml"
import * as path from "path"
import { diffPathspec, git } from "./review-diff"

/**
 * Stack skills, for the best-practices experiment. review/skills.yml maps a skill in
 * .claude/stack-skills/ to the repos it reviews. It lives in duchamp, so a PR cannot
 * drop a skill from its own review. The workflow installs only the skills a review
 * picks, so other reviews can't load them. See best-practices-experiment/README.md.
 */

const toolingPath = (...parts: string[]): string =>
  path.join(__dirname, "..", ...parts)

/** Skills listed for the repo that have a SKILL.md in .claude/stack-skills. */
export const loadStackSkills = (repo: string | undefined): string[] => {
  const skillsPath = toolingPath("review", "skills.yml")
  if (!repo || !fs.existsSync(skillsPath)) {
    return []
  }

  let parsed: unknown
  try {
    parsed = yaml.load(fs.readFileSync(skillsPath, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: Failed to parse skills.yml: ${message}`)
    return []
  }
  if (typeof parsed !== "object" || parsed === null) {
    return []
  }

  return Object.entries(parsed)
    .filter(
      ([, repos]) =>
        Array.isArray(repos) &&
        repos.some(
          r => typeof r === "string" && r.toLowerCase() === repo.toLowerCase()
        )
    )
    .map(([skill]) => skill)
    .filter(skill => {
      const exists = fs.existsSync(
        toolingPath(".claude", "stack-skills", skill, "SKILL.md")
      )
      if (!exists) {
        console.error(
          `Warning: skills.yml lists ${skill}, which isn't vendored`
        )
      }
      return exists
    })
}

const NOT_APP_CODE =
  /(^|\/)(__tests__|__generated__|__snapshots__|__mocks__)\/|\.(tests?|spec|stories)\.tsx?$|\.d\.ts$/

/** TypeScript the app runs: not tests, stories, mocks or generated code. */
export const isAppCodePath = (file: string): boolean =>
  /\.tsx?$/.test(file) && !NOT_APP_CODE.test(file)

/**
 * Skills for this review: in the group, the repo listed, and the range touches app
 * code. Any failure to read the diff means none.
 */
export const resolveStackSkills = (
  inBestPractices: boolean,
  repo: string | undefined,
  range: string | undefined,
  ignorePaths: string[]
): { skills: string[]; reason: string } => {
  if (!inBestPractices) {
    return { skills: [], reason: "not in the best-practices experiment" }
  }
  const skills = loadStackSkills(repo)
  if (skills.length === 0) {
    return { skills, reason: `no stack skills for ${repo}` }
  }
  if (!range) {
    return { skills: [], reason: "no base branch" }
  }

  try {
    const files = git([
      "diff",
      "--name-only",
      "--no-renames",
      range,
      "--",
      ...diffPathspec(ignorePaths),
    ]).split("\n")
    return files.some(isAppCodePath)
      ? { skills, reason: "the diff touches app code" }
      : { skills: [], reason: "the diff touches no app code" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { skills: [], reason: `could not read the diff: ${message}` }
  }
}

export const formatStackSkillsSection = (skills: string[]): string => {
  if (skills.length === 0) {
    return ""
  }

  const names = skills.map(skill => `\`${skill}\``).join(", ")
  return [
    "\n## Stack Practices\n",
    `After you read the diff and before you write findings, run ${skills.length === 1 ? "this skill" : "each of these skills"} with the Skill tool: ${names}.\n`,
    "- Use it as a checklist for this diff. Open the reference files that match what the change does, such as list rendering, animations or bundle size, and read them before you judge that code. Do not run its profiling or build commands; you cannot measure anything here.",
    "- Name the rule in every finding it leads to, as `(rule: <rule or reference file name>)`, for example `(rule: js-lists-flatlist-flashlist)`.",
    "- Its findings go under Suggestions unless the diff itself proves the problem, such as an unbounded list rendered with `map` inside a `ScrollView`, or heavy work in a scroll or gesture handler. Its own guardrails apply: no memoisation advice without a measured render problem.",
    "- One exception: when an `artsy-react-native` rule gives a `Severity:`, use it, post the finding inline, and skip any likelihood-times-impact score. Those rules come from things that broke Artsy's apps. The `impact:` labels in other skills (CRITICAL, HIGH) rank their own advice; they don't change where a finding goes.",
    "- These skills were written for interactive sessions. Skip any step that asks the user something, waits for an answer, or fetches pages from outside the repo.",
    "- If nothing in it applies to this diff, leave it out of the review.\n",
  ].join("\n")
}
