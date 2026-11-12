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

// Claude Code treats any other non-zero exit as a warning and runs the call.
const blocked = (tool: string, input: Record<string, unknown>) => {
  const result = run(tool, input)
  return (
    result.status === 2 && result.stderr.includes("BLOCKED by fix-guard.sh")
  )
}

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
    expect(blocked("Write", { file_path: path.join(out, "other.md") })).toBe(
      true
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
    expect(blocked("Edit", { file_path: file })).toBe(true)
  })

  it("resolves symlinks before checking", () => {
    expect(blocked("Write", { file_path: "app/config_link/secrets.yml" })).toBe(
      true
    )
    expect(blocked("Edit", { file_path: "app/models/secrets.rb" })).toBe(true)
  })

  it("blocks the hook's own directory and the packet", () => {
    expect(
      blocked("Edit", { file_path: path.join(packet, "context.md") })
    ).toBe(true)
    expect(blocked("Edit", { file_path: HOOK })).toBe(true)
  })

  it("blocks NotebookEdit and MultiEdit the same way", () => {
    expect(blocked("NotebookEdit", { notebook_path: "config/x.ipynb" })).toBe(
      true
    )
    expect(allowed("MultiEdit", { file_path: "app/models/a.rb" })).toBe(true)
  })

  it("checks the path the tool writes to, not another argument", () => {
    expect(
      blocked("Write", { command: "app/models/a.rb", file_path: "Gemfile" })
    ).toBe(true)
  })
})

describe("Bash", () => {
  it.each([
    "git log --oneline -5 -- app/models/artwork.rb",
    "git log a1b2c3d..HEAD -- app",
    "git blame -L 10,20 app/models/artwork.rb",
    "git blame -w -M -C -L10,20 a1b2c3d -- app/models/artwork.rb",
    "git blame HEAD~2 app/models/artwork.rb",
    "git log",
    "git log -n 3 --format=%h%x09%an%x09%s --since=2026-01-01 --author=octocat",
    "git log --pretty=format:%h,%s -20 --no-merges HEAD~5..HEAD",
    "git log --follow --max-count=5 -- app/models/artwork.rb",
    "git log a1b2c3d4e5f60718293a4b5c6d7e8f9012345678..HEAD -- app lib/x.rb",
    "git log -Sprice_cents --no-ext-diff --no-textconv --oneline -- app",
    "git log -p --no-ext-diff --no-textconv -1 -- app/models/artwork.rb",
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
    "git log --output\tapp/x.rb",
    'git log --format=[core]%n%x09fsmonitor=id --out"put"=.git/config',
    "git log --out'put'=.git/config",
    "git blame --contents .git/config app/models/artwork.rb",
    "git blame --con /proc/self/environ app/models/artwork.rb",
    "git blame --ignore-revs-file .git/config app/models/artwork.rb",
    "git blame -S .git/config app/models/artwork.rb",
    "git blame -wS.git/config app/models/artwork.rb",
    "git log -p --ext-diff",
    "git log -p --textconv",
    "git log -p",
    "git log -p --no-ext-diff",
    "git log --stat --no-textconv",
    "git log -Sprice_cents --oneline -- app",
    "git log --format=%GS",
    "git log --show-signature",
    "git log --all",
    "git log -c",
    "git log --grep=x",
    "git log -n",
    "git log -n x",
    "git log main..HEAD",
    "git log HEAD@{1}",
    "git log -- /etc/passwd",
    "git log -- ../outside",
    "git log -- .git/config",
    "git log -- :(top)app",
    "git log app/models/artwork.rb",
    "git log --since=x --until=*",
    "git blame",
    "git blame -L /def/,+5 app/models/artwork.rb",
    "git blame -L 1,2",
    "git blame app/a.rb app/b.rb",
    "git blame --incremental app/a.rb",
    "git blame -C5 app/a.rb",
    "git blame -- /proc/self/environ",
    "git  -C / log",
    "git status",
    "git log\tapp",
    "git log\nid",
    "bundle exec rspec",
    "cat .git/config",
  ])("blocks %p", command => {
    expect(blocked("Bash", { command })).toBe(true)
  })
})

describe("other tools", () => {
  it.each([
    "WebFetch",
    "WebSearch",
    "mcp__github__create_pull_request",
    "Monitor",
    "Agent",
    "Task",
    "",
  ])("blocks %p", tool => {
    expect(blocked(tool, {})).toBe(true)
  })

  it("lets reads in the repo and the packet through, and nothing else", () => {
    expect(
      allowed("Read", { file_path: path.join(repo, "app/models/x.rb") })
    ).toBe(true)
    expect(
      allowed("Read", { file_path: path.join(packet, "context.md") })
    ).toBe(true)
    expect(allowed("Grep", { pattern: "x" })).toBe(true)
    expect(allowed("Glob", { pattern: "**/*.rb", path: "app" })).toBe(true)
    expect(blocked("Read", { file_path: "/proc/self/environ" })).toBe(true)
    expect(blocked("Read", { file_path: path.join(repo, ".git/config") })).toBe(
      true
    )
    expect(blocked("Read", { file_path: "/etc/passwd" })).toBe(true)
    expect(blocked("Grep", { pattern: "token", path: os.homedir() })).toBe(true)
  })

  it.each([
    ["Glob", { pattern: "/etc/*" }],
    ["Glob", { pattern: "~/.ssh/*" }],
    ["Glob", { pattern: "../**/*.yml" }],
    ["Glob", { pattern: "app/../../**" }],
    ["Glob", { pattern: "{app,/etc}/*" }],
    ["Glob", { pattern: "*.rb", path: "/etc" }],
    ["Glob", { pattern: "*.rb", path: "../" }],
    ["Grep", { pattern: "x", path: "/etc" }],
    ["Grep", { pattern: "x", path: "app/config_link" }],
    ["Grep", { pattern: "x", glob: "/etc/*" }],
    ["Grep", { pattern: "x", glob: "../*" }],
  ])("blocks %s outside the read roots: %p", (tool, input) => {
    expect(blocked(tool, input)).toBe(true)
  })

  it("lets Glob and Grep search inside the repo", () => {
    expect(allowed("Glob", { pattern: "app/**/*.rb" })).toBe(true)
    expect(allowed("Glob", { pattern: "*.rb", path: repo })).toBe(true)
    expect(allowed("Grep", { pattern: "/api/v1", glob: "*.rb" })).toBe(true)
    expect(allowed("Grep", { pattern: "x", glob: "**/*.{rb,erb}" })).toBe(true)
    expect(allowed("Glob", { pattern: "app/**/.gitkeep" })).toBe(true)
    expect(allowed("Grep", { pattern: "x", path: packet })).toBe(true)
  })

  it("allows Skill and TodoWrite", () => {
    expect(allowed("Skill", { skill: "diagnosing-bugs" })).toBe(true)
    expect(allowed("TodoWrite", { todos: [] })).toBe(true)
  })

  it.each([
    ["Grep", { pattern: "x", glob: ".git/config" }],
    ["Grep", { pattern: "x", glob: "**/.git/**" }],
    ["Grep", { pattern: "x", glob: "{app,.git}/*" }],
    ["Grep", { pattern: "x", glob: ".g*/config" }],
    ["Grep", { pattern: "x", glob: "*git/config" }],
    ["Grep", { pattern: "x", glob: ".[g]it/config" }],
    ["Glob", { pattern: ".git/**" }],
    ["Glob", { pattern: ".GIT/config" }],
    ["Glob", { pattern: ".*/config" }],
  ])("blocks a %s glob that reaches .git: %p", (tool, input) => {
    expect(blocked(tool, input)).toBe(true)
  })

  it("blocks with exit 2 on an internal error", () => {
    const result = spawnSync("/bin/bash", [HOOK, repo, out, packet], {
      input: JSON.stringify({ tool_name: "Read", tool_input: {} }),
      encoding: "utf8",
      env: { PATH: path.join(root, "missing") },
    })
    expect(result.status).toBe(2)
  })

  it("fails closed on input it cannot parse", () => {
    const result = spawnSync("bash", [HOOK, repo, out, packet], {
      input: "not json",
      encoding: "utf8",
    })
    expect(result.status).toBe(2)
  })
})
