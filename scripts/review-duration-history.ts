import { execFile } from "child_process"
import { promisify } from "util"
import { mapLimit, median } from "./collect-review-usage"
import { formatDuration } from "./review-usage"

/**
 * How long AI reviews have taken, from the Actions API instead of job logs, so it
 * reaches back past GitHub's 90 days of logs. Prints monthly and weekly tables.
 *
 *   yarn ts-node scripts/review-duration-history.ts --repos eigen,force \
 *     --since 2026-01-29 --per-week 10 --exclude-author MounirDhahri
 *
 * GitHub drops step timings from older runs, so the Claude step column starts later
 * than the job column. Job time includes about a minute of setup.
 */

const execFileAsync = promisify(execFile)

const JOB_CONCURRENCY = 4

/** A run this short stopped at the check job, so it holds no review. */
export const MIN_REVIEW_RUN_SECONDS = 60

const USAGE =
  "Usage: review-duration-history.ts --repos eigen,force --since YYYY-MM-DD [--until YYYY-MM-DD] [--per-week 10] [--exclude-author login]... [--workflow file.yml]"

export interface Options {
  repos: string[]
  since: string
  until: string
  perWeek: number
  excludeAuthors: string[]
  workflow: string
}

export interface Run {
  id: number
  created_at: string
  run_started_at: string
  updated_at: string
  actor: string
}

export interface ReviewTiming {
  repo: string
  created: string
  jobSeconds: number
  /** Null when GitHub no longer keeps the run's step timings. */
  claudeSeconds: number | null
}

interface Step {
  name: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
}

interface Job {
  name: string
  conclusion: string | null
  started_at: string
  completed_at: string
  steps: Step[]
}

export const parseArgs = (argv: string[], today: string): Options => {
  const options: Options = {
    repos: [],
    since: "",
    until: today,
    perWeek: 10,
    excludeAuthors: [],
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
      case "--until":
        options.until = value
        i++
        break
      case "--per-week":
        options.perWeek = Number(value)
        i++
        break
      case "--exclude-author":
        options.excludeAuthors.push(value)
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
  if (!(options.perWeek > 0)) {
    throw new Error(`--per-week must be a positive number. ${USAGE}`)
  }
  return options
}

/**
 * Month-long `created` ranges from since to until. GitHub returns at most 1,000 runs
 * for a filtered list, so each range has to stay under that.
 */
export const monthRanges = (since: string, until: string): string[] => {
  const ranges: string[] = []
  const start = new Date(`${since}T00:00:00Z`)
  while (start.toISOString().slice(0, 10) <= until) {
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
    )
    const last = end.toISOString().slice(0, 10)
    ranges.push(
      `${start.toISOString().slice(0, 10)}..${last < until ? last : until}`
    )
    start.setTime(end.getTime() + 86_400_000)
  }
  return ranges
}

/** The Monday that starts the ISO week of a timestamp, as YYYY-MM-DD. */
export const weekOf = (timestamp: string): string => {
  const day = new Date(timestamp)
  day.setUTCHours(0, 0, 0, 0)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

const seconds = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / 1000

export const isReviewRun = (run: Run, excludeAuthors: string[]): boolean =>
  !excludeAuthors.includes(run.actor) &&
  seconds(run.run_started_at, run.updated_at) >= MIN_REVIEW_RUN_SECONDS

/** Up to n items spread evenly across a list, so one busy day doesn't fill a week. */
export const evenSample = <T>(items: T[], n: number): T[] =>
  items.length <= n
    ? items
    : Array.from(
        { length: n },
        (_, i) => items[Math.floor((i * items.length) / n)]
      )

/** Up to perWeek runs from each week, oldest first. */
export const sampleByWeek = (runs: Run[], perWeek: number): Run[] => {
  const weeks = new Map<string, Run[]>()
  for (const run of [...runs].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  )) {
    const week = weekOf(run.created_at)
    weeks.set(week, [...(weeks.get(week) ?? []), run])
  }
  return [...weeks.values()].flatMap(week => evenSample(week, perWeek))
}

/** The review job's timings, or null when the job didn't run a review to the end. */
export const reviewTiming = (
  repo: string,
  run: Run,
  jobs: Job[]
): ReviewTiming | null => {
  const job = jobs.find(job => job.name.endsWith("/ review"))
  if (!job || job.conclusion !== "success") {
    return null
  }
  const step = job.steps.find(
    step => step.name.startsWith("Run Claude Code Review") && step.completed_at
  )
  return {
    repo,
    created: run.created_at,
    jobSeconds: seconds(job.started_at, job.completed_at),
    claudeSeconds:
      step?.started_at && step.completed_at
        ? seconds(step.started_at, step.completed_at)
        : null,
  }
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

const time = (secs: number): string => formatDuration(secs * 1000)

const groupBy = (
  timings: ReviewTiming[],
  key: (timing: ReviewTiming) => string
): [string, ReviewTiming[]][] => {
  const groups = new Map<string, ReviewTiming[]>()
  for (const timing of timings) {
    groups.set(key(timing), [...(groups.get(key(timing)) ?? []), timing])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export const summarize = (timings: ReviewTiming[]): string => {
  const months = groupBy(timings, timing => timing.created.slice(0, 7)).map(
    ([month, group]) => {
      const jobs = group.map(timing => timing.jobSeconds)
      const steps = group.flatMap(timing =>
        timing.claudeSeconds === null ? [] : [timing.claudeSeconds]
      )
      const cells = [
        month,
        String(group.length),
        String(new Set(group.map(timing => timing.repo)).size),
        time(median(jobs)),
        time(percentile(jobs, 0.9)),
        steps.length > 0 ? `${time(median(steps))} (${steps.length})` : "-",
      ]
      return `| ${cells.join(" | ")} |`
    }
  )

  const weeks = groupBy(timings, timing => weekOf(timing.created)).map(
    ([week, group]) =>
      `| ${week} | ${group.length} | ${time(median(group.map(timing => timing.jobSeconds)))} |`
  )

  return [
    "| Month | Reviews | Repos | Job median | Job p90 | Claude step median (reviews with step timings) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...months,
    "",
    "| Week of | Reviews | Job median |",
    "| --- | --- | --- |",
    ...weeks,
  ].join("\n")
}

/** One item per line of `gh api --paginate`, picked out by a jq filter. */
const ghJson = async <T>(path: string, jq: string): Promise<T[]> => {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--paginate", path, "--jq", jq],
    { maxBuffer: 256 * 1024 * 1024 }
  )
  return stdout
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as T)
}

const listRuns = async (repo: string, options: Options): Promise<Run[]> => {
  const runs: Run[] = []
  for (const range of monthRanges(options.since, options.until)) {
    runs.push(
      ...(await ghJson<Run>(
        `repos/artsy/${repo}/actions/workflows/${options.workflow}/runs?per_page=100&status=completed&created=${range}`,
        ".workflow_runs[] | {id, created_at, run_started_at, updated_at, actor: .actor.login} | @json"
      ))
    )
  }
  return runs
}

const main = async (): Promise<void> => {
  const options = parseArgs(
    process.argv.slice(2),
    new Date().toISOString().slice(0, 10)
  )

  const timings: ReviewTiming[] = []
  for (const repo of options.repos) {
    try {
      const runs = (await listRuns(repo, options)).filter(run =>
        isReviewRun(run, options.excludeAuthors)
      )
      const sample = sampleByWeek(runs, options.perWeek)
      const found = await mapLimit(sample, JOB_CONCURRENCY, async run => {
        try {
          const jobs = await ghJson<Job>(
            `repos/artsy/${repo}/actions/runs/${run.id}/jobs?per_page=100`,
            ".jobs[] | @json"
          )
          return reviewTiming(repo, run, jobs)
        } catch {
          console.error(`${repo} run ${run.id}: could not read jobs`)
          return null
        }
      })
      const kept = found.filter(
        (timing): timing is ReviewTiming => timing !== null
      )
      timings.push(...kept)
      console.error(
        `${repo}: ${runs.length} review runs, ${sample.length} sampled, ${kept.length} with a finished review`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${repo}: could not list runs: ${message}`)
    }
  }

  console.log(summarize(timings))
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
