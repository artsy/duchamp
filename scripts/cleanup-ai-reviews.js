/**
 * Clean up previous AI review comments before posting a new review.
 *
 * This script:
 * 1. Deletes main review comments (issue comments) that have AI markers
 * 2. Resolves inline review threads that have AI markers (preserves conversation history)
 *
 * @param {Object} params - Parameters from actions/github-script
 * @param {import('@octokit/rest').Octokit} params.github - GitHub API client
 * @param {Object} params.context - GitHub context
 * @param {Object} params.core - GitHub Actions core utilities
 */
async function cleanupPreviousAIReviews({ github, context, core }) {
  const { owner, repo } = context.repo
  const prNumber = context.payload.pull_request.number

  const deletedComments = await deleteMainReviewComments({
    github,
    owner,
    repo,
    prNumber,
  })

  const resolvedThreads = await resolveInlineReviewThreads({
    github,
    owner,
    repo,
    prNumber,
  })

  core.info(`Cleanup complete: ${deletedComments} comments deleted, ${resolvedThreads} threads resolved`)
}

/**
 * Delete main review comments (issue comments) that contain AI markers.
 * These don't have threaded conversations, so they're safe to delete entirely.
 */
async function deleteMainReviewComments({ github, owner, repo, prNumber }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  })

  const aiComments = comments.filter((comment) =>
    comment.body?.includes("<!-- claude-ai-review")
  )

  await Promise.all(
    aiComments.map(async (comment) => {
      await github.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: comment.id,
      })
    })
  )

  return aiComments.length
}

/**
 * Resolve inline review threads that contain AI markers.
 * We resolve rather than delete to preserve any conversation history
 * (resolved threads collapse in GitHub UI but keep the discussion).
 */
async function resolveInlineReviewThreads({ github, owner, repo, prNumber }) {
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes { body }
              }
            }
          }
        }
      }
    }
  `

  const result = await github.graphql(query, { owner, repo, pr: prNumber })
  const threads = result.repository.pullRequest.reviewThreads.nodes

  const aiThreads = threads.filter((thread) => {
    if (thread.isResolved) return false
    const firstComment = thread.comments.nodes[0]
    return firstComment?.body?.includes("<!-- claude-ai-review")
  })

  await Promise.all(
    aiThreads.map(async (thread) => {
      await github.graphql(
        `
        mutation($threadId: ID!) {
          resolveReviewThread(input: {threadId: $threadId}) {
            thread { isResolved }
          }
        }
      `,
        { threadId: thread.id }
      )
    })
  )

  return aiThreads.length
}

module.exports = { cleanupPreviousAIReviews }
