const fs = require("fs")
const { commentVulnerabilities } = require("./npm-audit")

jest.mock("fs")

describe("commentVulnerabilities", () => {
  const mockAuditData = `{"value":"example-package","children":{"Severity":"Critical","Vulnerable Versions":"<1.0.0","ID":"CVE-2024-1234","Issue":"Security vulnerability","URL":"https://example.com/advisory"}}
{"value":"another-package","children":{"Severity":"High","Vulnerable Versions":">=2.0.0 <2.1.0","ID":"CVE-2024-5678","Issue":"Another issue","URL":"https://example.com/advisory2"}}`

  beforeEach(() => {
    jest.clearAllMocks()
    fs.readFileSync.mockReturnValue(mockAuditData)
  })

  it("should update existing comment when NPM Audit Results comment exists", async () => {
    const existingComment = {
      id: 123,
      body: "## 🔒 NPM Audit Results\nOld content here",
    }

    const mockGithub = {
      rest: {
        issues: {
          listComments: jest.fn().mockResolvedValue({
            data: [existingComment],
          }),
          updateComment: jest.fn().mockResolvedValue({}),
          createComment: jest.fn(),
        },
      },
    }

    const mockContext = {
      issue: { number: 42 },
      repo: { owner: "test-owner", repo: "test-repo" },
    }

    const mockCore = {
      exportVariable: jest.fn(),
    }

    await commentVulnerabilities({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
      threshold: "critical",
      auditFilePath: "audit.json",
    })

    // Should list comments
    expect(mockGithub.rest.issues.listComments).toHaveBeenCalledWith({
      issue_number: 42,
      owner: "test-owner",
      repo: "test-repo",
    })

    // Should update existing comment, not create new one
    expect(mockGithub.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 123,
      body: expect.stringContaining("## 🔒 NPM Audit Results"),
    })

    expect(mockGithub.rest.issues.createComment).not.toHaveBeenCalled()

    // Should export variable
    expect(mockCore.exportVariable).toHaveBeenCalledWith("VULNS_FOUND", "true")
  })

  it("should create new comment when no NPM Audit Results comment exists", async () => {
    const mockGithub = {
      rest: {
        issues: {
          listComments: jest.fn().mockResolvedValue({
            data: [
              { id: 1, body: "Some other comment" },
              { id: 2, body: "Another comment" },
            ],
          }),
          updateComment: jest.fn(),
          createComment: jest.fn().mockResolvedValue({}),
        },
      },
    }

    const mockContext = {
      issue: { number: 42 },
      repo: { owner: "test-owner", repo: "test-repo" },
    }

    const mockCore = {
      exportVariable: jest.fn(),
    }

    await commentVulnerabilities({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
      threshold: "critical",
      auditFilePath: "audit.json",
    })

    // Should list comments
    expect(mockGithub.rest.issues.listComments).toHaveBeenCalledWith({
      issue_number: 42,
      owner: "test-owner",
      repo: "test-repo",
    })

    // Should create new comment, not update
    expect(mockGithub.rest.issues.createComment).toHaveBeenCalledWith({
      issue_number: 42,
      owner: "test-owner",
      repo: "test-repo",
      body: expect.stringContaining("## 🔒 NPM Audit Results"),
    })

    expect(mockGithub.rest.issues.updateComment).not.toHaveBeenCalled()

    // Should export variable
    expect(mockCore.exportVariable).toHaveBeenCalledWith("VULNS_FOUND", "true")
  })
})
