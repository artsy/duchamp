import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import {
  checkGuards,
  type GuardResult,
  parseNumstatZ,
  parsePatterns,
  parseRawZ,
} from "./guards"
import {
  commitMessages,
  type FixResult,
  issueComment,
  parseResult,
  prBody,
  prTitle,
} from "./pr-body"
import { listIssues, type Meta, required } from "./select"
import { isDdIssueId } from "./text"
import { findTriageIssue } from "./triage-result"

/**
 * The publish job's decision for one fix artifact: reject, skip, or publish, plus the
 * PR title and body and the triage issue comment. It runs on a fresh runner after
 * the patches are applied with `git apply --index`, and reads only git's view of
 * them. The workflow does the writes (commit, push, PR, labels, comments).
 */

export type Verdict = "publish" | "reject" | "skip"

export interface Decision {
  verdict: Verdict
  reasons: string[]
  guards: GuardResult | null
  result: FixResult | null
}

export const decide = (input: {
  result: FixResult | null
  applied: boolean
  guards: () => GuardResult
}): Decision => {
  if (!input.result) {
    return {
      verdict: "reject",
      reasons: ["the agent wrote no valid result.json"],
      guards: null,
      result: null,
    }
  }
  if (input.result.decision === "skip") {
    return { verdict: "skip", reasons: [], guards: null, result: input.result }
  }
  if (!input.applied) {
    return {
      verdict: "reject",
      reasons: ["the patches are missing or do not apply to base_sha"],
      guards: null,
      result: input.result,
    }
  }
  const guards = input.guards()
  return {
    verdict: guards.ok ? "publish" : "reject",
    reasons: guards.reasons,
    guards,
    result: input.result,
  }
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

export const reviewers = (owner: string, author: string | null): string[] =>
  author && LOGIN.test(author) && author.toLowerCase() !== owner.toLowerCase()
    ? [owner, author]
    : [owner]

/** A guard limit from the environment. Anything but a positive integer throws, so a bad input can't turn the guard off. */
export const positiveInt = (name: string, raw: string | undefined): number => {
  const value = Number(raw)
  if (
    !raw ||
    !/^\d+$/.test(raw.trim()) ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(raw ?? null)}`
    )
  }
  return value
}

export const branchName = (id: string): string =>
  `autofix/dd-${id.replace(/-/g, "").slice(0, 8).toLowerCase()}`

// ---- CLI ---------------------------------------------------------------

const git = (repoDir: string, args: string[]): string =>
  execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

const readOptional = (file: string): string =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""

const main = (): void => {
  const repoDir = required("REPO_DIR")
  const inDir = required("IN_DIR")
  const outDir = required("OUT_DIR")
  const id = required("DD_ISSUE_ID")
  const baseSha = required("BASE_SHA")
  const owner = required("REVIEWER")
  const runUrl = required("RUN_URL")
  if (!isDdIssueId(id)) throw new Error("invalid dd issue id")
  const maxLines = positiveInt("MAX_LINES", process.env.MAX_LINES)

  const meta: Meta = JSON.parse(
    fs.readFileSync(path.join(inDir, "meta.json"), "utf8")
  )
  if (meta.dd_issue_id !== id || meta.base_sha !== baseSha) {
    throw new Error("meta.json does not match this run's issue and base_sha")
  }

  const result = parseResult(readOptional(path.join(inDir, "result.json")))
  const patch = ["test.patch", "fix.patch"]
    .map(name => readOptional(path.join(inDir, name)))
    .join("\n")
  const decision = decide({
    result,
    applied: process.env.APPLY_OUTCOME === "applied",
    guards: () =>
      checkGuards({
        decision: result?.decision,
        raw: parseRawZ(
          git(repoDir, [
            "diff",
            "--cached",
            "--raw",
            "-z",
            "--no-renames",
            "--no-ext-diff",
          ])
        ),
        numstat: parseNumstatZ(
          git(repoDir, [
            "diff",
            "--cached",
            "--numstat",
            "-z",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
          ])
        ),
        patch,
        maxLines,
        sensitive: parsePatterns(process.env.SENSITIVE_PATHS ?? ""),
      }),
  })

  const triageIssue = findTriageIssue(
    listIssues(required("GITHUB_REPOSITORY"), "triage"),
    id
  )
  fs.mkdirSync(outDir, { recursive: true })
  if (decision.verdict === "publish" && decision.result && decision.guards) {
    fs.writeFileSync(
      path.join(outDir, "pr-body.md"),
      prBody({
        meta,
        result: decision.result,
        agentBody: readOptional(path.join(inDir, "pr-body.md")),
        triageIssue: triageIssue?.number ?? null,
        sensitive: decision.guards.sensitive,
        weightedLines: decision.guards.weightedLines,
      })
    )
  } else {
    fs.writeFileSync(
      path.join(outDir, "issue-comment.md"),
      issueComment(
        decision.verdict === "skip"
          ? { kind: "skipped", summary: decision.result?.summary ?? "" }
          : { kind: "rejected", reasons: decision.reasons },
        runUrl
      )
    )
  }

  const reviewerList = reviewers(owner, meta.suspect_author)
  const commits = commitMessages(meta)
  const outputs: Record<string, string> = {
    verdict: decision.verdict,
    title: prTitle(meta),
    test_commit: commits.test,
    fix_commit: commits.fix,
    branch: branchName(id),
    reviewers: reviewerList.join(","),
    assignee: reviewerList[reviewerList.length - 1],
    triage_issue: triageIssue ? String(triageIssue.number) : "",
    sensitive: decision.guards?.sensitive.length ? "true" : "false",
  }
  const summary = [
    `## Autofix: publish \`${id}\``,
    "",
    `Verdict: **${decision.verdict}**`,
    ...decision.reasons.map(reason => `- ${reason}`),
  ].join("\n")
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value.replace(/[\r\n]/g, " ")}\n`)
        .join("")
    )
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error: any) {
    console.error(`AUTOFIX PUBLISH FAILED: ${error.message}`)
    process.exit(1)
  }
}
