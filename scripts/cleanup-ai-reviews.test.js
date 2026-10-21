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
    graphql: jest.fn().mockImplementation(query => {
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

  it("should resolve inline threads started by Claude bot (__typename=Bot, login=claude)", async () => {
    // GraphQL returns "claude" not "claude[bot]", and __typename instead of type
    const threads = [
      {
        id: "thread-1",
        isResolved: false,
        comments: {
          nodes: [{ author: { __typename: "Bot", login: "claude" } }],
        },
      },
      {
        id: "thread-2",
        isResolved: false,
        comments: {
          nodes: [{ author: { __typename: "User", login: "human-user" } }],
        },
      },
      {
        id: "thread-3",
        isResolved: true,
        comments: {
          nodes: [{ author: { __typename: "Bot", login: "claude" } }],
        },
      },
    ]

    const mockGithub = createMockGithub([], threads)

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    const mutationCalls = mockGithub.graphql.mock.calls.filter(([query]) =>
      query.includes("mutation")
    )
    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0][1]).toEqual({ threadId: "thread-1" })
  })

  it("should handle no threads", async () => {
    const mockGithub = createMockGithub([], [])

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    expect(mockCore.info).toHaveBeenCalledWith(
      "Cleanup complete: 0 threads resolved"
    )
  })

  it("should leave summary comments for the post step to delete", async () => {
    const comments = [
      { id: 1, user: { type: "Bot", login: "claude[bot]" }, body: "Review" },
    ]
    const threads = [
      {
        id: "thread-1",
        isResolved: false,
        comments: {
          nodes: [{ author: { __typename: "Bot", login: "claude" } }],
        },
      },
    ]

    const mockGithub = createMockGithub(comments, threads)

    await cleanupPreviousAIReviews({
      github: mockGithub,
      context: mockContext,
      core: mockCore,
    })

    expect(mockGithub.rest.issues.deleteComment).not.toHaveBeenCalled()
    expect(mockCore.info).toHaveBeenCalledWith(
      "Cleanup complete: 1 threads resolved"
    )
  })
})
