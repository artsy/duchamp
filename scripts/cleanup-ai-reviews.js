/**
 * Resolve the inline review threads Claude started on earlier reviews, before a new
 * review posts its own. Resolving rather than deleting keeps any conversation (resolved
 * threads collapse in the GitHub UI).
 *
 * Earlier summary comments are not touched here. scripts/post-review-summary.ts
 * deletes them after the new summary posts, so a run that fails leaves them in place.
 *
 * @param {Object} params - Parameters from actions/github-script
 * @param {import('@octokit/rest').Octokit} params.github - GitHub API client
 * @param {Object} params.context - GitHub context
 * @param {Object} params.core - GitHub Actions core utilities
 */

// GraphQL returns Bot logins without the [bot] suffix
const CLAUDE_BOT_LOGIN_GRAPHQL = "claude"

async function cleanupPreviousAIReviews({ github, context, core }) {
  const { owner, repo } = context.repo
  const prNumber = context.payload.pull_request.number

  const resolvedThreads = await resolveInlineReviewThreads({
    github,
    owner,
    repo,
    prNumber,
  })

  core.info(`Cleanup complete: ${resolvedThreads} threads resolved`)
}

/**
 * Resolve inline review threads started by the Claude bot.
 * We resolve rather than delete to preserve any conversation history
 * (resolved threads collapse in GitHub UI but keep the discussion).
 */
async function resolveInlineReviewThreads({ github, owner, repo, prNumber }) {
  // GraphQL returns Bot authors with __typename and login (without [bot] suffix)
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes {
                  author {
                    __typename
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  const result = await github.graphql(query, { owner, repo, pr: prNumber })
  const threads = result.repository.pullRequest.reviewThreads.nodes

  const aiThreads = threads.filter(thread => {
    if (thread.isResolved) return false
    const author = thread.comments.nodes[0]?.author
    return (
      author?.__typename === "Bot" && author?.login === CLAUDE_BOT_LOGIN_GRAPHQL
    )
  })

  await Promise.all(
    aiThreads.map(async thread => {
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
