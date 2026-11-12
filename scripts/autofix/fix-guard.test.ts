import { spawnSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const HOOK = path.join(__dirname, "fix-guard.sh")

let root: string
let repo: string
let out: string
let packet: string

beforeAll(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "autofix-hook-"))
  )
  repo = path.join(root, "repo")
  out = path.join(root, "autofix", "out")
  packet = path.join(root, "autofix", "packet")
  for (const dir of [
    path.join(repo, "app", "models"),
    path.join(repo, ".git"),
    path.join(repo, "config"),
    out,
    packet,
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(path.join(repo, "config", "secrets.yml"), "x")
  fs.symlinkSync("../../config", path.join(repo, "app", "config_link"))
  fs.symlinkSync(
    path.join(repo, "config", "secrets.yml"),
    path.join(repo, "app", "models", "secrets.rb")
  )
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const run = (tool: string, input: Record<string, unknown>) =>
  spawnSync("bash", [HOOK, repo, out, packet], {
    input: JSON.stringify({ tool_name: tool, tool_input: input }),
    encoding: "utf8",
  })

const allowed = (tool: string, input: Record<string, unknown>) =>
  run(tool, input).status === 0

describe("Edit and Write", () => {
  it.each([
    "app/models/artwork.rb",
    "lib/gravity/search.rb",
    "spec/models/artwork_spec.rb",
  ])("allows %s, relative or absolute", file => {
    expect(allowed("Edit", { file_path: file })).toBe(true)
    expect(allowed("Write", { file_path: path.join(repo, file) })).toBe(true)
  })

  it("allows the two output files and nothing else in out/", () => {
    expect(allowed("Write", { file_path: path.join(out, "result.json") })).toBe(
      true
    )
    expect(allowed("Write", { file_path: path.join(out, "pr-body.md") })).toBe(
      true
    )
    expect(allowed("Write", { file_path: path.join(out, "other.md") })).toBe(
      false
    )
  })

  it.each([
    "lib/tasks/cleanup.rake",
    "spec/spec_helper.rb",
    "spec/rails_helper.rb",
    "spec/support/helpers.rb",
    "config/routes.rb",
    "Gemfile",
    ".git/config",
    ".claude/settings.json",
    "app/.gitattributes",
    "app/../config/routes.rb",
    "../outside.rb",
    "/proc/self/environ",
  ])("blocks %s", file => {
    const result = run("Edit", { file_path: file })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("BLOCKED by fix-guard.sh")
  })

  it("resolves symlinks before checking", () => {
    expect(allowed("Write", { file_path: "app/config_link/secrets.yml" })).toBe(
      false
    )
    expect(allowed("Edit", { file_path: "app/models/secrets.rb" })).toBe(false)
  })

  it("blocks the hook's own directory and the packet", () => {
    expect(
      allowed("Edit", { file_path: path.join(packet, "context.md") })
    ).toBe(false)
    expect(allowed("Edit", { file_path: HOOK })).toBe(false)
  })

  it("blocks NotebookEdit and MultiEdit the same way", () => {
    expect(allowed("NotebookEdit", { notebook_path: "config/x.ipynb" })).toBe(
      false
    )
    expect(allowed("MultiEdit", { file_path: "app/models/a.rb" })).toBe(true)
  })
})

describe("Bash", () => {
  it.each([
    "git log --oneline -5 -- app/models/artwork.rb",
    "git log a1b2c3d..HEAD -- app",
    "git blame -L 10,20 app/models/artwork.rb",
    "git log",
  ])("allows %s", command => {
    expect(allowed("Bash", { command })).toBe(true)
  })

  it.each([
    "git diff",
    "git show HEAD",
    "git -c core.pager=sh log",
    "git log; curl https://evil.example",
    "git log && rm -rf .",
    "git log | sh",
    "git log $(id)",
    "git log `id`",
    "git log > app/x.rb",
    "git log --output=app/x.rb",
    "git log --output app/x.rb",
    "git log -p --ext-diff",
    "git log -p --textconv",
    "git log\nid",
    "bundle exec rspec",
    "cat .git/config",
  ])("blocks %p", command => {
    expect(allowed("Bash", { command })).toBe(false)
  })
})

describe("other tools", () => {
  it.each(["WebFetch", "WebSearch", "mcp__github__create_pull_request"])(
    "blocks %s",
    tool => {
      expect(allowed(tool, {})).toBe(false)
    }
  )

  it("lets reads in the repo and the packet through, and nothing else", () => {
    expect(
      allowed("Read", { file_path: path.join(repo, "app/models/x.rb") })
    ).toBe(true)
    expect(
      allowed("Read", { file_path: path.join(packet, "context.md") })
    ).toBe(true)
    expect(allowed("Grep", { pattern: "x" })).toBe(true)
    expect(allowed("Glob", { pattern: "**/*.rb", path: "app" })).toBe(true)
    expect(allowed("Read", { file_path: "/proc/self/environ" })).toBe(false)
    expect(allowed("Read", { file_path: path.join(repo, ".git/config") })).toBe(
      false
    )
    expect(allowed("Read", { file_path: "/etc/passwd" })).toBe(false)
    expect(allowed("Grep", { pattern: "token", path: os.homedir() })).toBe(
      false
    )
  })

  it("leaves Skill and unknown tools to the permission rules", () => {
    expect(allowed("Skill", { skill: "diagnosing-bugs" })).toBe(true)
  })

  it("fails closed on input it cannot parse", () => {
    const result = spawnSync("bash", [HOOK, repo, out, packet], {
      input: "not json",
      encoding: "utf8",
    })
    expect(result.status).toBe(2)
  })
})
