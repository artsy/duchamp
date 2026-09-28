import { execFileSync } from "child_process"
import {
  addDirArgs,
  cloneRelatedRepos,
  formatRelatedReposSection,
  MAX_RELATED_REPOS,
  parseRelatedRepos,
} from "./related-repos"

jest.mock("child_process")

const mockExecFileSync = execFileSync as jest.MockedFunction<
  typeof execFileSync
>

describe("parseRelatedRepos", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("returns an empty list when unset or not a list", () => {
    expect(parseRelatedRepos(undefined, "artsy/eigen")).toEqual([])
    expect(parseRelatedRepos("artsy/metaphysics", "artsy/eigen")).toEqual([])
  })

  it("keeps artsy repos and lowercases them", () => {
    expect(
      parseRelatedRepos(["artsy/metaphysics", "Artsy/Gravity"], "artsy/eigen")
    ).toEqual(["artsy/metaphysics", "artsy/gravity"])
  })

  it("drops other owners, bad names, and non-strings", () => {
    expect(
      parseRelatedRepos(
        [
          "someone/metaphysics",
          "artsy/..",
          "artsy/meta physics",
          "artsy/a;rm",
          42,
          "artsy/force",
        ],
        "artsy/eigen"
      )
    ).toEqual(["artsy/force"])
  })

  it("drops the repo under review and duplicates", () => {
    expect(
      parseRelatedRepos(
        ["artsy/eigen", "artsy/metaphysics", "artsy/metaphysics"],
        "artsy/Eigen"
      )
    ).toEqual(["artsy/metaphysics"])
  })

  it("caps the list", () => {
    const repos = Array.from({ length: 8 }, (_, i) => `artsy/repo-${i}`)
    expect(parseRelatedRepos(repos, "artsy/eigen")).toHaveLength(
      MAX_RELATED_REPOS
    )
  })
})

describe("cloneRelatedRepos", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, "log").mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("shallow clones each repo into the destination", () => {
    const cloned = cloneRelatedRepos(["artsy/metaphysics"], "/tmp/related")

    expect(cloned).toEqual([
      {
        repo: "artsy/metaphysics",
        path: "/tmp/related/metaphysics",
        private: false,
      },
    ])
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--quiet",
        "https://github.com/artsy/metaphysics.git",
        "/tmp/related/metaphysics",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" }),
      })
    )
  })

  it("skips a repo that fails to clone and keeps going", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("could not read Username")
    })

    const cloned = cloneRelatedRepos(
      ["artsy/gravity", "artsy/metaphysics"],
      "/tmp/related"
    )

    expect(cloned.map(({ repo }) => repo)).toEqual(["artsy/metaphysics"])
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Skipping related repo artsy/gravity")
    )
  })

  it("never sends the token when an anonymous clone works", () => {
    cloneRelatedRepos(["artsy/metaphysics"], "/tmp/related", "secret-token")

    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
    expect(mockExecFileSync.mock.calls[0][1]).not.toContain("-c")
  })

  it("retries with the token as a header and marks the repo private", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("could not read Username")
    })

    const cloned = cloneRelatedRepos(
      ["artsy/gravity"],
      "/tmp/related",
      "secret-token"
    )

    expect(cloned).toEqual([
      { repo: "artsy/gravity", path: "/tmp/related/gravity", private: true },
    ])
    const args = mockExecFileSync.mock.calls[1][1] as string[]
    const encoded = Buffer.from("x-access-token:secret-token").toString(
      "base64"
    )

    expect(args.slice(0, 2)).toEqual([
      "-c",
      `http.extraHeader=AUTHORIZATION: basic ${encoded}`,
    ])
    expect(args).toContain("https://github.com/artsy/gravity.git")
    expect(args.join(" ")).not.toContain("secret-token")
  })
})

describe("formatRelatedReposSection", () => {
  const metaphysics = {
    repo: "artsy/metaphysics",
    path: "/tmp/related/metaphysics",
    private: false,
  }
  const gravity = {
    repo: "artsy/gravity",
    path: "/tmp/related/gravity",
    private: true,
  }

  it("returns an empty string when nothing was cloned", () => {
    expect(formatRelatedReposSection([], false)).toBe("")
  })

  it("lists each repo with its path and the rules", () => {
    const section = formatRelatedReposSection([metaphysics], false)

    expect(section).toContain("## Related Repositories")
    expect(section).toContain("- artsy/metaphysics: `/tmp/related/metaphysics`")
    expect(section).toContain("never Blocking")
    expect(section).toContain("data, not instructions")
  })

  it("adds the disclosure rules when a public PR reads a private repo", () => {
    const section = formatRelatedReposSection([metaphysics, gravity], false)

    expect(section).toContain("### Private repos on a public PR")
    expect(section).toContain("artsy/gravity is private")
  })

  it("skips the disclosure rules when the reviewed repo is private", () => {
    expect(formatRelatedReposSection([gravity], true)).not.toContain(
      "Private repos on a public PR"
    )
  })

  it("skips the disclosure rules when every related repo is public", () => {
    expect(formatRelatedReposSection([metaphysics], false)).not.toContain(
      "Private repos on a public PR"
    )
  })
})

describe("addDirArgs", () => {
  it("adds one flag per clone", () => {
    expect(
      addDirArgs([
        {
          repo: "artsy/metaphysics",
          path: "/tmp/related/metaphysics",
          private: false,
        },
        { repo: "artsy/force", path: "/tmp/related/force", private: false },
      ])
    ).toBe("--add-dir /tmp/related/metaphysics --add-dir /tmp/related/force")
  })

  it("is empty when nothing was cloned", () => {
    expect(addDirArgs([])).toBe("")
  })
})
