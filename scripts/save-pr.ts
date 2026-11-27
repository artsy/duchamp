import { execFileSync } from "child_process"
import * as fs from "fs"
import { isTrustedComment } from "./review-mode"

/**
 * Saves a PR's description and comments to a file, for the reviewers that can't run `gh`
 * themselves (Codex, Gemini). On a public repo anyone can comment, and those reviewers run
 * with an API key in reach, so only comments from the PR's author or people with write
 * access go in.
 */

export interface PrView {
  number: number
  title: string
  author: { login: string }
  body: string
  comments: {
    author: { login: string } | null
    authorAssociation: string
    body: string
  }[]
}

export const formatPrForModel = (pr: PrView): string => {
  const trusted = pr.comments.filter(comment =>
    isTrustedComment(
      {
        // gh's comment JSON has no __typename; bots come back as NONE, so they drop out.
        author: comment.author && {
          __typename: "User",
          login: comment.author.login,
        },
        authorAssociation: comment.authorAssociation,
        body: comment.body,
      },
      pr.author.login
    )
  )
  const dropped = pr.comments.length - trusted.length

  return [
    `# #${pr.number}: ${pr.title}`,
    `Author: @${pr.author.login}`,
    "",
    pr.body,
    "",
    "## Comments",
    ...trusted.map(
      comment =>
        `\n### @${comment.author?.login} (${comment.authorAssociation})\n\n${comment.body}`
    ),
    ...(dropped > 0
      ? [
          `\n${dropped} comments from people without write access were left out.`,
        ]
      : []),
    "",
  ].join("\n")
}

const main = (): void => {
  const prNumber = process.env.PR_NUMBER ?? ""
  const file = process.env.PR_FILE ?? ""
  if (!prNumber || !file) throw new Error("PR_NUMBER and PR_FILE are required")

  const json = execFileSync(
    "gh",
    ["pr", "view", prNumber, "--json", "number,title,author,body,comments"],
    { encoding: "utf8" }
  )
  fs.writeFileSync(file, formatPrForModel(JSON.parse(json) as PrView))
}

if (require.main === module) {
  main()
}
