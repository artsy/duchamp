import { execFile } from "child_process"
import { promisify } from "util"
import {
  cacheHitRate,
  formatDuration,
  type ReviewUsage,
  USAGE_LOG_PREFIX,
} from "./review-usage"

/**
 * Compare AI review cost across time windows, for example before and after a change
 * to the review. Reads the REVIEW_USAGE line that review-usage.ts prints in each
 * review job's log.
 *
 *   yarn ts-node scripts/collect-review-usage.ts --repos eigen,force \
 *     --since 2026-10-14 --split 2026-10-22T14:05:00Z
 *
 * Each --split starts a new window. Dates or full UTC timestamps both work. GitHub
 * keeps logs for 90 days by default.
 */

const execFileAsync = promisify(execFile)

const LOG_CONCURRENCY = 6

/** GitHub returns at most 1,000 runs for a filtered list, newest first. */
const RUN_LIST_LIMIT = 1000

const USAGE =
  "Usage: collect-review-usage.ts --repos eigen,force --since YYYY-MM-DD [--split YYYY-MM-DD]... [--workflow file.yml]"

export interface UsageRecord extends ReviewUsage {
  modelArgs: string
  reviewMode: string | null
  /** Whether the review was in the review experiment; null in older log lines. */
  experiment?: boolean | null
}

export interface RunUsage {
  repo: string
  runId: number
  createdAt: string
  usage: UsageRecord
}

export interface Options {
  repos: string[]
  since: string
  splits: string[]
  workflow: string
}

export const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    repos: [],
    since: "",
    splits: [],
    workflow: "run-claude-review.yml",
  }

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1]
    if (argv[i].startsWith("--") && (!value || value.startsWith("--"))) {
      throw new Error(`${argv[i]} needs a value. ${USAGE}`)
    }
    switch (argv[i]) {
      case "--repos":
        options.repos = value.split(",").map(repo => repo.trim())
        i++
        break
      case "--since":
        options.since = value
        i++
        break
      case "--split":
        options.splits.push(value)
        i++
        break
      case "--workflow":
        options.workflow = value
        i++
        break
    }
  }

  if (options.repos.length === 0 || !options.since) {
    throw new Error(USAGE)
  }

  options.splits.sort()
  const early = options.splits.find(split => split <= options.since)
  if (early) {
    throw new Error(`--split ${early} must come after --since ${options.since}`)
  }
  return options
}

/** The usage lines in a job log. The prefix starts mid-line, after the log timestamp. */
export const parseUsageLines = (log: string): UsageRecord[] =>
  log.split("\n").flatMap(line => {
    const start = line.indexOf(USAGE_LOG_PREFIX)
    if (start === -1) {
      return []
    }
    try {
      return [JSON.parse(line.slice(start + USAGE_LOG_PREFIX.length).trim())]
    } catch {
      return []
    }
  })

/**
 * Window label for a run, or null before --since. ISO strings compare in time order,
 * and a bare date sorts before every timestamp on that day.
 */
export const windowFor = (
  createdAt: string,
  since: string,
  splits: string[]
): string | null => {
  if (createdAt < since) {
    return null
  }

  const starts = [since, ...splits]
  for (let i = starts.length - 1; i >= 0; i--) {
    if (createdAt >= starts[i]) {
      const end = splits[i]
      return end ? `${starts[i]} to ${end}` : `${starts[i]} on`
    }
  }
  return null
}

export const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

const groupName = (usage: UsageRecord): string => {
  if (usage.experiment === true) {
    return "experiment"
  }
  return usage.experiment === false ? "standard" : "unknown"
}

/** A markdown table with one row per window, group and review mode. */
export const summarize = (
  runs: RunUsage[],
  since: string,
  splits: string[]
): string => {
  const groups = new Map<string, UsageRecord[]>()
  for (const run of runs) {
    const window = windowFor(run.createdAt, since, splits)
    if (!window) {
      continue
    }
    const key = `${window}|${groupName(run.usage)}|${run.usage.reviewMode ?? "all"}`
    groups.set(key, [...(groups.get(key) ?? []), run.usage])
  }

  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, usages]) => {
      const [window, group, mode] = key.split("|")
      const cells = [
        window,
        group,
        mode,
        String(usages.length),
        String(usages.filter(u => u.outcome !== "success").length),
        `$${median(usages.map(u => u.costUsd)).toFixed(2)}`,
        String(median(usages.map(u => u.turns))),
        formatDuration(median(usages.map(u => u.durationMs))),
        `${(median(usages.map(cacheHitRate)) * 100).toFixed(1)}%`,
        `$${usages.reduce((sum, u) => sum + u.costUsd, 0).toFixed(2)}`,
      ]
      return `| ${cells.join(" | ")} |`
    })

  return [
    "| Window | Group | Mode | Reviews | Not success | Median cost | Median turns | Median time | Median cache hit | Total cost |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

const gh = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 256 * 1024 * 1024,
  })
  return stdout
}

const listRuns = async (
  repo: string,
  options: Options
): Promise<{ databaseId: number; createdAt: string }[]> => {
  const output = await gh([
    "run",
    "list",
    "-R",
    `artsy/${repo}`,
    "--workflow",
    options.workflow,
    "--created",
    `>=${options.since}`,
    "--status",
    "completed",
    "--limit",
    String(RUN_LIST_LIMIT),
    "--json",
    "databaseId,createdAt",
  ])
  return JSON.parse(output)
}

/** Runs fn over items with at most `limit` in flight. */
const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return results
}

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))

  const runs: { repo: string; databaseId: number; createdAt: string }[] = []
  for (const repo of options.repos) {
    try {
      const repoRuns = await listRuns(repo, options)
      runs.push(...repoRuns.map(run => ({ repo, ...run })))
      console.error(`${repo}: ${repoRuns.length} runs`)
      if (repoRuns.length >= RUN_LIST_LIMIT) {
        const earliest = repoRuns.map(run => run.createdAt).sort()[0]
        console.error(
          `${repo}: hit GitHub's ${RUN_LIST_LIMIT}-run limit, so runs before ${earliest} are missing. Move --since later, or the earliest window is short.`
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${repo}: could not list runs: ${message}`)
    }
  }

  const usages = await mapLimit(runs, LOG_CONCURRENCY, async run => {
    try {
      const log = await gh([
        "run",
        "view",
        String(run.databaseId),
        "-R",
        `artsy/${run.repo}`,
        "--log",
      ])
      return parseUsageLines(log).map(usage => ({
        repo: run.repo,
        runId: run.databaseId,
        createdAt: run.createdAt,
        usage,
      }))
    } catch {
      console.error(`${run.repo} run ${run.databaseId}: could not read log`)
      return []
    }
  })

  const found = usages.flat()
  console.error(
    `${found.length} reviews with usage out of ${runs.length} runs. Runs without it skipped review or predate the usage line.\n`
  )
  console.log(summarize(found, options.since, options.splits))
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
