const { cleanupPreviousAIReviews } = require("./cleanup-ai-reviews")

describe("cleanupPreviousAIReviews", () => {
  const createMockGithub = (comments = [], threads = []) => ({
    paginate: jest.fn().mockResolvedValue(comments),
    rest: {
      issues: {
        listComments: jest.fn(),
        deleteComment: jest.fn().mockResolvedValue({}),
      },
    },
    graphql: jest.fn().mockImplementation((query) => {
      if (query.includes("query")) {
        return Promise.resolve({
          repository: {
            pullRequest: {
              reviewThreads: { nodes: threads },
            },
          },
        })
      }
      return Promise.resolve({ thread: { isResolved: true } })
    }),
  })

  const mockContext = {
    repo: { owner: "test-owner", repo: "test-repo" },
    payload: { pull_request: { number: 42 } },
  }

  const mockCore = {
    info: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("should delete comments with AI review markers", async () => {
    const comments = [
      { id: 1, body: "<!-- claude-ai-review-main -->\n## Code Review" },
      { id: 2, body: "Regular comment without marker" },
      { id: 3, body: "<!-- claude-ai-review-main -->\nAnother AI review" },
    ]

    const mockGithub = createMockGithub(comments)

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    expect(mockGithub.rest.issues.deleteComment).toHaveBeenCalledTimes(2)
    expect(mockGithub.rest.issues.deleteComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 1,
    })
    expect(mockGithub.rest.issues.deleteComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 3,
    })
  })

  it("should resolve inline threads with AI review markers", async () => {
    const threads = [
      {
        id: "thread-1",
        isResolved: false,
        comments: {
          nodes: [{ body: "<!-- claude-ai-review-inline -->\nInline comment" }],
        },
      },
      {
        id: "thread-2",
        isResolved: false,
        comments: { nodes: [{ body: "Human comment" }] },
      },
      {
        id: "thread-3",
        isResolved: true,
        comments: {
          nodes: [{ body: "<!-- claude-ai-review-inline -->\nAlready resolved" }],
        },
      },
    ]

    const mockGithub = createMockGithub([], threads)

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    // Should only resolve the unresolved AI thread
    const mutationCalls = mockGithub.graphql.mock.calls.filter(([query]) =>
      query.includes("mutation")
    )
    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0][1]).toEqual({ threadId: "thread-1" })
  })

  it("should not delete comments without AI markers", async () => {
    const comments = [
      { id: 1, body: "Regular comment" },
      { id: 2, body: "Another regular comment" },
    ]

    const mockGithub = createMockGithub(comments)

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    expect(mockGithub.rest.issues.deleteComment).not.toHaveBeenCalled()
  })

  it("should handle empty comments and threads", async () => {
    const mockGithub = createMockGithub([], [])

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    expect(mockGithub.rest.issues.deleteComment).not.toHaveBeenCalled()
    expect(mockCore.info).toHaveBeenCalledWith(
      "Cleanup complete: 0 comments deleted, 0 threads resolved"
    )
  })

  it("should log cleanup summary", async () => {
    const comments = [
      { id: 1, body: "<!-- claude-ai-review-main -->\nReview" },
    ]
    const threads = [
      {
        id: "thread-1",
        isResolved: false,
        comments: {
          nodes: [{ body: "<!-- claude-ai-review-inline -->\nInline" }],
        },
      },
    ]

    const mockGithub = createMockGithub(comments, threads)

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    expect(mockCore.info).toHaveBeenCalledWith(
      "Cleanup complete: 1 comments deleted, 1 threads resolved"
    )
  })
})
