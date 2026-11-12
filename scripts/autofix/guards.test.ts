import { execFileSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  addedDebugTags,
  checkGuards,
  type GuardInput,
  isAllowedPath,
  modeProblem,
  parseNumstatZ,
  parsePatterns,
  parseRawZ,
} from "./guards"

describe("isAllowedPath", () => {
  it.each([
    "app/models/artwork.rb",
    "lib/gravity/search.rb",
    "spec/models/artwork_spec.rb",
    "spec/requests/api/v1/me_spec.rb",
  ])("allows %s", file => {
    expect(isAllowedPath(file)).toBe(true)
  })

  it.each([
    "lib/tasks/cleanup.rake",
    "spec/spec_helper.rb",
    "spec/rails_helper.rb",
    "spec/support/factories.rb",
    "config/routes.rb",
    "Gemfile",
    ".github/workflows/ci.yml",
    "app/.gitattributes",
    "app/models/../../config/x.rb",
    "app/models/a b.rb",
    "application.rb",
    "specs/x_spec.rb",
  ])("refuses %s", file => {
    expect(isAllowedPath(file)).toBe(false)
  })
})

describe("modeProblem", () => {
  const entry = (srcMode: string, dstMode: string) => ({
    srcMode,
    dstMode,
    status: "M",
    path: "app/x.rb",
  })

  it.each([
    [entry("100644", "100644"), null],
    [entry("000000", "100644"), null],
    [entry("100644", "000000"), null],
    [entry("000000", "120000"), "a symlink"],
    [entry("000000", "160000"), "a submodule"],
    [entry("100644", "100755"), "a mode change 100644 → 100755"],
    [entry("000000", "100755"), "mode 100755"],
  ])("%p → %p", (input, expected) => {
    expect(modeProblem(input)).toBe(expected)
  })
})

describe("parsePatterns", () => {
  it("matches simple globs", () => {
    const [payments, models] = parsePatterns(
      "app/payments/**, app/models/*_order.rb"
    )
    expect(payments.test("app/payments/stripe/charge.rb")).toBe(true)
    expect(models.test("app/models/line_order.rb")).toBe(true)
    expect(models.test("app/models/sub/line_order.rb")).toBe(false)
  })

  it("is empty for an empty input", () => {
    expect(parsePatterns("")).toEqual([])
  })
})

it("finds debug tags only on added lines", () => {
  expect(addedDebugTags("+++ b/app/x.rb\n+  puts '[DEBUG-a4f2] x'\n")).toBe(
    true
  )
  expect(addedDebugTags("-  puts '[DEBUG-a4f2] x'\n context [DEBUG-\n")).toBe(
    false
  )
})

/** A real repo, so the guards read git's actual -z output. */
describe("checkGuards on git output", () => {
  let dir: string
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" })
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  const input = (overrides: Partial<GuardInput> = {}): GuardInput => ({
    decision: "fix",
    raw: parseRawZ(git("diff", "--cached", "--raw", "-z", "--no-renames")),
    numstat: parseNumstatZ(
      git(
        "diff",
        "--cached",
        "--numstat",
        "-z",
        "--no-renames",
        "--no-textconv"
      )
    ),
    patch: git("diff", "--cached", "--no-ext-diff", "--no-textconv"),
    maxLines: 150,
    sensitive: [],
    ...overrides,
  })

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "autofix-guards-"))
    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    write(
      "app/models/artwork.rb",
      "class Artwork\n  def title\n    name\n  end\nend\n"
    )
    write("spec/models/artwork_spec.rb", "describe Artwork do\nend\n")
    git("add", ".")
    git("commit", "-qm", "base")
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("passes a test plus a fix", () => {
    write(
      "app/models/artwork.rb",
      "class Artwork\n  def title\n    name.to_s\n  end\nend\n"
    )
    write("spec/models/artwork_spec.rb", "describe Artwork do\n  it { }\nend\n")
    write("spec/models/new_spec.rb", "x\n")
    git("add", "-A")
    const result = checkGuards(input())
    expect(result).toMatchObject({ ok: true, reasons: [] })
    // 2 app lines, plus (1 + 1) spec lines at half weight.
    expect(result.weightedLines).toBe(3)
    expect(result.files.sort()).toEqual([
      "app/models/artwork.rb",
      "spec/models/artwork_spec.rb",
      "spec/models/new_spec.rb",
    ])
  })

  it("requires a spec change and a non-spec change", () => {
    write("app/models/artwork.rb", "class Artwork; end\n")
    git("add", "-A")
    expect(checkGuards(input()).reasons).toContain(
      "needs at least one change under spec/ and one outside it"
    )
  })

  it("rejects a skip decision", () => {
    write("app/models/artwork.rb", "x\n")
    write("spec/models/artwork_spec.rb", "y\n")
    git("add", "-A")
    expect(checkGuards(input({ decision: "skip" })).ok).toBe(false)
  })

  it("rejects symlinks, executables, binaries and paths outside the allowlist", () => {
    write("spec/models/artwork_spec.rb", "y\n")
    fs.symlinkSync(
      "../../config/secrets.yml",
      path.join(dir, "app/models/link.rb")
    )
    write("app/models/run.rb", "x\n")
    fs.chmodSync(path.join(dir, "app/models/run.rb"), 0o755)
    fs.writeFileSync(
      path.join(dir, "app/models/blob.bin"),
      Buffer.from([0, 1, 2, 0, 255])
    )
    write("config/initializers/x.rb", "x\n")
    write("spec/support/helper.rb", "x\n")
    git("add", "-A")
    const { reasons, ok } = checkGuards(input())
    expect(ok).toBe(false)
    expect(reasons).toEqual(
      expect.arrayContaining([
        "app/models/link.rb is a symlink",
        "app/models/run.rb is mode 100755",
        "app/models/blob.bin is binary",
        "path outside the allowlist: config/initializers/x.rb",
        "path outside the allowlist: spec/support/helper.rb",
      ])
    )
  })

  it("rejects a mode change on an existing file", () => {
    write("spec/models/artwork_spec.rb", "y\n")
    fs.chmodSync(path.join(dir, "app/models/artwork.rb"), 0o755)
    git("add", "-A")
    expect(checkGuards(input()).reasons).toContain(
      "app/models/artwork.rb is a mode change 100644 → 100755"
    )
  })

  it("caps lines, with spec lines at half weight", () => {
    write("app/models/artwork.rb", "x\n".repeat(100))
    write("spec/models/artwork_spec.rb", "y\n".repeat(120))
    git("add", "-A")
    const result = checkGuards(input())
    // 5 + 100 app lines, 2 + 120 spec lines at half weight.
    expect(result.weightedLines).toBe(166)
    expect(result.reasons).toContain(
      "166 changed lines (spec lines count half), over 150"
    )
  })

  it("rejects added debug tags", () => {
    write("app/models/artwork.rb", "puts '[DEBUG-a4f2] here'\n")
    write("spec/models/artwork_spec.rb", "y\n")
    git("add", "-A")
    expect(checkGuards(input()).reasons).toContain("adds a [DEBUG-…] debug tag")
  })

  it("lists sensitive paths without rejecting them", () => {
    write("app/models/artwork.rb", "x\n")
    write("spec/models/artwork_spec.rb", "y\n")
    git("add", "-A")
    const result = checkGuards(
      input({ sensitive: parsePatterns("app/models/**") })
    )
    expect(result.ok).toBe(true)
    expect(result.sensitive).toEqual(["app/models/artwork.rb"])
  })

  it("parses deletions", () => {
    git("rm", "-q", "app/models/artwork.rb")
    write("spec/models/artwork_spec.rb", "y\n")
    git("add", "-A")
    const raw = parseRawZ(
      git("diff", "--cached", "--raw", "-z", "--no-renames")
    )
    expect(
      raw.find(entry => entry.path === "app/models/artwork.rb")
    ).toMatchObject({
      srcMode: "100644",
      dstMode: "000000",
      status: "D",
    })
    expect(checkGuards(input()).ok).toBe(true)
  })
})

it("refuses output it does not recognise", () => {
  expect(() => parseRawZ("garbage\0path\0")).toThrow(/unexpected/)
})
