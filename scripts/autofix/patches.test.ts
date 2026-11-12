import { execFileSync } from "child_process"
import * as fs from "fs"
import * as yaml from "js-yaml"
import * as os from "os"
import * as path from "path"
import { checkGuards, parseNumstatZ, parseRawZ } from "./guards"

/**
 * Runs the fix job's inline patch-building shell, and publish's apply step, straight
 * from the workflow file, against a real repo the "agent" has changed.
 */

const WORKFLOW = path.join(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "autofix-datadog.yml"
)

const stepScript = (job: string, name: string): string => {
  const workflow = yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as any
  const step = workflow.jobs[job].steps.find((s: any) => s.name === name)
  if (!step?.run) throw new Error(`no run step "${name}" in ${job}`)
  return step.run
}

let root: string
let workspace: string
let autofix: string

const sh = (script: string, cwd: string, env: Record<string, string> = {}) =>
  execFileSync("bash", ["-c", script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      AUTOFIX: autofix,
      RUNNER_TEMP: root,
      BASE_SHA: "",
      ...env,
    },
  })

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" })

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

beforeEach(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "autofix-patches-"))
  )
  workspace = path.join(root, "workspace")
  autofix = path.join(root, "autofix")
  for (const dir of ["packet", "out", "artifact"]) {
    fs.mkdirSync(path.join(autofix, dir), { recursive: true })
  }
  fs.mkdirSync(workspace)
  git(workspace, "init", "-q")
  git(workspace, "config", "user.email", "test@example.com")
  git(workspace, "config", "user.name", "Test")
  write(path.join(workspace, "app/models/artwork.rb"), "class Artwork\nend\n")
  write(path.join(workspace, "lib/tasks/x.rake"), "task :x\n")
  write(
    path.join(workspace, "spec/models/artwork_spec.rb"),
    "describe Artwork\n"
  )
  write(path.join(workspace, "config/routes.rb"), "routes\n")
  git(workspace, "add", ".")
  git(workspace, "commit", "-qm", "base")
  const base = git(workspace, "rev-parse", "HEAD").trim()
  sh(stepScript("fix", "Make a pristine clone"), workspace, { BASE_SHA: base })
  write(path.join(autofix, "packet/meta.json"), '{"dd_issue_id":"x"}\n')
})

afterEach(() => {
  execFileSync("chmod", ["-R", "u+w", root])
  fs.rmSync(root, { recursive: true, force: true })
})

const buildPatches = () =>
  sh(stepScript("fix", "Build patches from the pristine clone"), workspace)

const read = (name: string) =>
  fs.readFileSync(path.join(autofix, "artifact", name), "utf8")

it("splits the agent's changes into a test patch and a fix patch, from app/lib/spec only", () => {
  write(
    path.join(workspace, "app/models/artwork.rb"),
    "class Artwork\n  def x; end\nend\n"
  )
  write(path.join(workspace, "spec/models/new_spec.rb"), "it works\n")
  write(
    path.join(workspace, "config/routes.rb"),
    "changed outside the allowlist\n"
  )
  write(path.join(workspace, "Gemfile"), "gem 'evil'\n")
  write(path.join(autofix, "out/result.json"), '{"decision":"fix"}')
  write(path.join(autofix, "out/pr-body.md"), "## Summary\n")
  buildPatches()

  const test = read("test.patch")
  const fix = read("fix.patch")
  expect(test).toContain("spec/models/new_spec.rb")
  expect(test).not.toContain("app/models")
  expect(fix).toContain("app/models/artwork.rb")
  expect(fix).not.toContain("spec/")
  expect(test + fix).not.toContain("config/routes.rb")
  expect(test + fix).not.toContain("Gemfile")
  expect(read("result.json")).toBe('{"decision":"fix"}')
  expect(read("pr-body.md")).toBe("## Summary\n")
  expect(fs.existsSync(path.join(autofix, "artifact/meta.json"))).toBe(false)
})

it("ignores a tampered .git/config in the workspace", () => {
  fs.appendFileSync(
    path.join(workspace, ".git/config"),
    '[diff "evil"]\n\ttextconv = touch PWNED\n[core]\n\thooksPath = /tmp/evil\n'
  )
  write(path.join(workspace, ".gitattributes"), "*.rb diff=evil\n")
  write(path.join(workspace, "app/models/artwork.rb"), "changed\n")
  write(path.join(workspace, "spec/models/artwork_spec.rb"), "changed\n")
  buildPatches()
  expect(fs.existsSync(path.join(workspace, "PWNED"))).toBe(false)
  expect(fs.existsSync(path.join(autofix, "pristine/PWNED"))).toBe(false)
  expect(read("fix.patch")).toContain("+changed")
})

it("keeps a symlink as a symlink, so publish rejects it", () => {
  fs.symlinkSync(
    "../../config/routes.rb",
    path.join(workspace, "app/models/link.rb")
  )
  buildPatches()
  expect(read("fix.patch")).toContain("new file mode 120000")
})

it("records deletions, including a whole directory", () => {
  fs.rmSync(path.join(workspace, "lib"), { recursive: true })
  write(path.join(workspace, "spec/models/artwork_spec.rb"), "changed\n")
  buildPatches()
  expect(read("fix.patch")).toContain("deleted file mode 100644")
  expect(read("fix.patch")).toContain("lib/tasks/x.rake")
})

it("does not copy outputs that are symlinks", () => {
  fs.symlinkSync("/etc/hosts", path.join(autofix, "out/result.json"))
  buildPatches()
  expect(fs.existsSync(path.join(autofix, "artifact/result.json"))).toBe(false)
})

it("applies on a fresh checkout and passes the guards end to end", () => {
  write(
    path.join(workspace, "app/models/artwork.rb"),
    "class Artwork\n  def x; end\nend\n"
  )
  write(
    path.join(workspace, "spec/models/artwork_spec.rb"),
    "describe Artwork\n  it { }\n"
  )
  buildPatches()

  const fresh = path.join(root, "fresh")
  git(root, "clone", "-q", path.join(autofix, "pristine"), fresh)
  git(
    fresh,
    "reset",
    "-q",
    "--hard",
    git(workspace, "rev-parse", "HEAD").trim()
  )
  fs.mkdirSync(path.join(root, "autofix", "in"), { recursive: true })
  for (const name of ["test.patch", "fix.patch"]) {
    fs.copyFileSync(
      path.join(autofix, "artifact", name),
      path.join(root, "autofix", "in", name)
    )
  }
  const output = path.join(root, "github_output")
  fs.writeFileSync(output, "")
  sh(stepScript("publish", "Apply the patches"), fresh, {
    GITHUB_OUTPUT: output,
  })
  expect(fs.readFileSync(output, "utf8")).toBe("outcome=applied\n")

  const result = checkGuards({
    decision: "fix",
    raw: parseRawZ(
      git(fresh, "diff", "--cached", "--raw", "-z", "--no-renames")
    ),
    numstat: parseNumstatZ(
      git(fresh, "diff", "--cached", "--numstat", "-z", "--no-renames")
    ),
    patch: read("test.patch") + read("fix.patch"),
    maxLines: 150,
    sensitive: [],
  })
  expect(result.reasons).toEqual([])
})

describe("Materialize fix settings", () => {
  const tooling = () => path.join(autofix, "tooling")

  beforeEach(() => {
    for (const name of ["fix-settings.json", "fix-guard.sh"]) {
      write(
        path.join(tooling(), "scripts/autofix", name),
        fs.readFileSync(path.join(__dirname, name), "utf8")
      )
    }
    write(path.join(workspace, ".claude/skills/evil/SKILL.md"), "hooks\n")
    write(path.join(workspace, ".claude/settings.json"), "{}\n")
    write(path.join(workspace, ".mcp.json"), "{}\n")
    git(workspace, "add", ".")
    git(workspace, "commit", "-qm", "repo claude config")
    fs.rmSync(path.join(autofix, "pristine"), { recursive: true })
    sh(stepScript("fix", "Make a pristine clone"), workspace, {
      BASE_SHA: git(workspace, "rev-parse", "HEAD").trim(),
    })
    const env = path.join(root, "github_env")
    fs.writeFileSync(env, "")
    sh(stepScript("fix", "Materialize fix settings"), workspace, {
      GITHUB_ENV: env,
    })
  })

  it("moves the repo's whole .claude/ and .mcp.json out of the tree", () => {
    expect(fs.existsSync(path.join(workspace, ".claude"))).toBe(false)
    expect(fs.existsSync(path.join(workspace, ".mcp.json"))).toBe(false)
    expect(
      fs.existsSync(path.join(autofix, "target-claude/skills/evil/SKILL.md"))
    ).toBe(true)
  })

  it("makes the hook and its settings read-only", () => {
    const writable = (file: string) => (fs.statSync(file).mode & 0o222) !== 0
    expect(writable(path.join(tooling(), "scripts/autofix/fix-guard.sh"))).toBe(
      false
    )
    expect(writable(path.join(tooling(), "scripts/autofix"))).toBe(false)
    expect(writable(path.join(autofix, "fix-settings.json"))).toBe(false)
  })

  it("keeps the move out of the patches", () => {
    write(path.join(workspace, "spec/models/artwork_spec.rb"), "changed\n")
    buildPatches()
    expect(read("test.patch") + read("fix.patch")).not.toContain(".claude")
    expect(read("test.patch") + read("fix.patch")).not.toContain(".mcp.json")
  })
})
