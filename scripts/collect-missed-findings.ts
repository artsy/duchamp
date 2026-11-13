import { gh, listRuns, mapLimit, RUN_LIST_LIMIT } from "./collect-review-usage"
import { MISSED_LOG_PREFIX } from "./review-missed"

/**
 * List what human reviewers caught and the AI review missed, grouped by repo and
 * category, to spot patterns worth a `focus_areas` entry. Reads the MISSED_FINDING
 * lines that review-missed.ts prints in each outcome job's log.
 *
 *   yarn ts-node scripts/collect-missed-findings.ts --repos gravity,volt --since 2026-11-01
 *
 * GitHub keeps logs for 90 days by default.
 */

const LOG_CONCURRENCY = 6
const WORKFLOW = "run-claude-review.yml"
const OUTCOME_JOBS_FILTER =
  '.jobs[] | select(.name | endswith("outcome")) | select(.conclusion != "skipped") | .id'
const USAGE =
  "Usage: collect-missed-findings.ts --repos gravity,volt --since YYYY-MM-DD"

export interface MissedFinding {
  repo: string
  pr: string
  category: string
  path?: string
  summary: string
}

/** The step's log lines carry a job and timestamp prefix, so match anywhere in the line. */
export const parseMissedLines = (log: string): MissedFinding[] =>
  log.split("\n").flatMap(line => {
    const start = line.indexOf(MISSED_LOG_PREFIX)
    if (start === -1) {
      return []
    }
    try {
      return [JSON.parse(line.slice(start + MISSED_LOG_PREFIX.length))]
    } catch {
      return []
    }
  })

/** Markdown, one section per repo and category, largest category first. */
export const summarize = (missed: MissedFinding[]): string => {
  if (missed.length === 0) {
    return "No missed findings in this period.\n"
  }

  const groups = new Map<string, MissedFinding[]>()
  for (const finding of missed) {
    const key = `${finding.repo} · ${finding.category}`
    groups.set(key, [...(groups.get(key) ?? []), finding])
  }

  return [...groups.entries()]
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(([key, findings]) =>
      [
        `## ${key} (${findings.length})`,
        "",
        ...findings.map(
          finding =>
            `- ${finding.summary} (\`${finding.path ?? "?"}\`, #${finding.pr})`
        ),
        "",
      ].join("\n")
    )
    .join("\n")
}

export const parseArgs = (
  argv: string[]
): { repos: string[]; since: string } => {
  const value = (flag: string): string => argv[argv.indexOf(flag) + 1] ?? ""
  const repos = argv.includes("--repos")
    ? value("--repos")
        .split(",")
        .map(repo => repo.trim())
        .filter(Boolean)
    : []
  const since = argv.includes("--since") ? value("--since") : ""
  if (repos.length === 0 || !since) {
    throw new Error(USAGE)
  }
  return { repos, since }
}

const main = async (): Promise<void> => {
  const { repos, since } = parseArgs(process.argv.slice(2))

  const runs: { repo: string; databaseId: number }[] = []
  for (const repo of repos) {
    const repoRuns = await listRuns(repo, {
      repos,
      since,
      splits: [],
      workflow: WORKFLOW,
    })
    runs.push(...repoRuns.map(run => ({ repo, databaseId: run.databaseId })))
    console.error(`${repo}: ${repoRuns.length} runs`)
    if (repoRuns.length >= RUN_LIST_LIMIT) {
      const earliest = repoRuns.map(run => run.createdAt).sort()[0]
      console.error(
        `${repo}: hit GitHub's ${RUN_LIST_LIMIT}-run limit, so runs before ${earliest} are missing. Move --since later.`
      )
    }
  }

  const missed = await mapLimit(runs, LOG_CONCURRENCY, async run => {
    try {
      // Most runs are reviews. Only a run whose outcome job ran can hold these lines.
      const jobIds = (
        await gh([
          "api",
          `repos/artsy/${run.repo}/actions/runs/${run.databaseId}/jobs`,
          "--jq",
          OUTCOME_JOBS_FILTER,
        ])
      )
        .split("\n")
        .filter(Boolean)
      const logs = await Promise.all(
        jobIds.map(id =>
          gh(["run", "view", "-R", `artsy/${run.repo}`, "--job", id, "--log"])
        )
      )
      return logs.flatMap(parseMissedLines)
    } catch {
      console.error(`${run.repo} run ${run.databaseId}: could not read log`)
      return []
    }
  })

  console.log(summarize(missed.flat()))
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
