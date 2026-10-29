import { execFileSync } from "child_process"
import {
  classifyDiff,
  classifyFiles,
  isDocsPath,
  isSensitivePath,
  MAX_LIGHT_LINES,
  parseNumstat,
} from "./review-risk"

jest.mock("child_process")

const mockExec = execFileSync as jest.Mock

beforeEach(() => {
  mockExec.mockReset()
})

describe("isSensitivePath", () => {
  it.each([
    ".github/workflows/deploy.yml",
    ".github/actions/setup/action.yml",
    "src/lib/auth/login.ts",
    "app/models/user_session.rb",
    "src/schema/v2/me/password.ts",
    "config/initializers/secret_token.rb",
    "app/policies/artwork_policy.rb",
    "src/Apps/Checkout/Routes/Payment.tsx",
    "app/models/order.rb",
    "src/orders/index.ts",
    "db/migrate/20261029_add_column.rb",
    "Dockerfile",
    "infra/main.tf",
    "db/structure.sql",
  ])("flags %s", file => {
    expect(isSensitivePath(file)).toBe(true)
  })

  it.each([
    "src/Components/Border.tsx",
    "src/app/Scenes/Artwork/Reorder.tsx",
    "README.md",
    "src/utils/formatPrice.ts",
  ])("leaves %s", file => {
    expect(isSensitivePath(file)).toBe(false)
  })
})

describe("isDocsPath", () => {
  it.each([
    "README.md",
    "docs/setup.rb",
    "src/docs/guide.mdx",
    "notes.txt",
    "images/hero.PNG",
    "LICENSE",
  ])("counts %s as docs", file => {
    expect(isDocsPath(file)).toBe(true)
  })

  it.each(["src/index.ts", "package.json", "app.json"])(
    "counts %s as code",
    file => {
      expect(isDocsPath(file)).toBe(false)
    }
  )
})

describe("parseNumstat", () => {
  it("sums added and removed lines, and counts binary files as 0", () => {
    expect(
      parseNumstat(
        "3\t2\tsrc/a.ts\n-\t-\timages/logo.png\n\n10\t0\tdocs/b.md\n"
      )
    ).toEqual([
      { path: "src/a.ts", lines: 5 },
      { path: "images/logo.png", lines: 0 },
      { path: "docs/b.md", lines: 10 },
    ])
  })
})

describe("classifyFiles", () => {
  it("is light for docs only, however long", () => {
    expect(
      classifyFiles([
        { path: "README.md", lines: 500 },
        { path: "docs/a.png", lines: 0 },
      ])
    ).toMatchObject({ tier: "light", reason: "docs only" })
  })

  it("is light for a small code change", () => {
    expect(
      classifyFiles([{ path: "src/a.ts", lines: MAX_LIGHT_LINES }])
    ).toMatchObject({ tier: "light" })
  })

  it("is standard for a large code change", () => {
    expect(
      classifyFiles([
        { path: "src/a.ts", lines: MAX_LIGHT_LINES },
        { path: "README.md", lines: 1 },
      ])
    ).toMatchObject({ tier: "standard" })
  })

  it("is standard for a one-line change to a sensitive file", () => {
    const risk = classifyFiles([
      { path: "src/a.ts", lines: 1 },
      { path: ".github/workflows/ci.yml", lines: 1 },
    ])
    expect(risk.tier).toBe("standard")
    expect(risk.sensitive).toEqual([".github/workflows/ci.yml"])
    expect(risk.reason).toContain(".github/workflows/ci.yml")
  })

  it("is light when nothing changed outside lockfiles and ignored paths", () => {
    expect(classifyFiles([])).toMatchObject({ tier: "light" })
  })
})

describe("classifyDiff", () => {
  it("reads numstat for the range without renames, minus lockfiles and ignored paths", () => {
    mockExec.mockReturnValue("1\t1\tsrc/a.ts\n")

    expect(classifyDiff("origin/main...HEAD", ["vendor/"])).toMatchObject({
      tier: "light",
    })

    const [cmd, args] = mockExec.mock.calls[0]
    expect(cmd).toBe("git")
    expect(args.slice(0, 5)).toEqual([
      "diff",
      "--numstat",
      "--no-renames",
      "origin/main...HEAD",
      "--",
    ])
    expect(args).toContain(":(exclude,glob)**/yarn.lock")
    expect(args).toContain(":(exclude,glob)**/vendor/**")
  })
})
