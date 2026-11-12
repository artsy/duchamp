import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import {
  ddIdInTitle,
  type GitHubIssue,
  listIssues,
  required,
  type ScanFinding,
  scan,
  screenReason,
} from "./select"
import { isDdIssueId, stripHidden } from "./text"

/**
 * Check the triage agent's structured result before anything acts on it. The result
 * is model output that read attacker-controlled errors, so every field is checked
 * against what we already know, and issue numbers come from GitHub, not the model.
 */

export const ROOT_CAUSE_MAX = 600
export const SUSPECT_FILE_MAX = 200

/** The schema passed to the triage run with --json-schema. Mirrors the datadog-triage skill's reference/structured-result.md. */
export const TRIAGE_SCHEMA = {
  type: "object",
  required: ["issues"],
  additionalProperties: false,
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        required: [
          "dd_issue_id",
          "issue_number",
          "root_cause",
          "suspect_file",
          "suspect_line",
          "confidence",
        ],
        additionalProperties: false,
        properties: {
          dd_issue_id: { type: "string" },
          issue_number: { type: ["number", "null"] },
          root_cause: { type: "string", maxLength: ROOT_CAUSE_MAX },
          suspect_file: { type: "string" },
          suspect_line: { type: ["number", "null"] },
          confidence: { enum: ["high", "medium", "low"] },
        },
      },
    },
  },
}

export type Confidence = "high" | "medium" | "low"

export interface TriageEntry {
  dd_issue_id: string
  issue_number: number
  root_cause: string
  suspect_file: string
  suspect_line: number | null
  confidence: Confidence
}

export interface Rejected {
  id: string
  reason: string
}

/**
 * Parse the action's structured_output. Missing or malformed output throws: the skill
 * returns nothing when its preflight fails, and that must fail the job, not read as
 * "nothing to fix".
 */
export const parseStructuredOutput = (raw: string | undefined): unknown[] => {
  if (!raw || !raw.trim()) {
    throw new Error(
      "triage returned no structured result (its preflight may have failed; see the triage step log)"
    )
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("triage structured result is not JSON")
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.issues)) {
    throw new Error("triage structured result has no issues array")
  }
  return parsed.issues
}

const SAFE_PATH = /^[\w][\w./-]*$/

/** The newest `[triage]` issue whose title carries `(dd:<id>)`. */
export const findTriageIssue = (
  issues: GitHubIssue[],
  id: string
): GitHubIssue | null =>
  issues
    .filter(
      issue =>
        issue.title.startsWith("[triage]") && ddIdInTitle(issue.title) === id
    )
    .sort((a, b) => b.number - a.number)[0] ?? null

export interface ValidateDeps {
  candidates: string[]
  triageIssues: GitHubIssue[]
  /** Whether the path is a file in the repo at base_sha. */
  fileExists: (file: string) => boolean
  /** scan_text.py findings for root causes, by dd id. */
  screen: (
    entries: { id: string; root_cause: string }[]
  ) => Map<string, ScanFinding[]>
}

export const validateEntries = (
  entries: unknown[],
  deps: ValidateDeps
): { accepted: TriageEntry[]; rejected: Rejected[] } => {
  const rejected: Rejected[] = []
  const shaped: Omit<TriageEntry, "issue_number">[] = []
  const seen = new Set<string>()

  for (const entry of entries as any[]) {
    const id = entry?.dd_issue_id
    const label = isDdIssueId(id) ? id : "(invalid id)"
    const reject = (reason: string) => rejected.push({ id: label, reason })
    if (!isDdIssueId(id) || !deps.candidates.includes(id)) {
      reject("not one of select's candidates")
      continue
    }
    if (seen.has(id)) {
      reject("duplicate entry")
      continue
    }
    seen.add(id)
    const rootCause =
      typeof entry.root_cause === "string"
        ? stripHidden(entry.root_cause).trim()
        : ""
    if (!rootCause || rootCause.length > ROOT_CAUSE_MAX) {
      reject(`root_cause missing or over ${ROOT_CAUSE_MAX} characters`)
      continue
    }
    const file =
      typeof entry.suspect_file === "string" ? entry.suspect_file : ""
    if (
      !file ||
      file.length > SUSPECT_FILE_MAX ||
      !SAFE_PATH.test(file) ||
      file.split("/").includes("..") ||
      !deps.fileExists(file)
    ) {
      reject("suspect_file is not a file in the repo at base_sha")
      continue
    }
    const line = entry.suspect_line
    if (line !== null && !(Number.isInteger(line) && line > 0)) {
      reject("suspect_line is not a positive line number")
      continue
    }
    if (!["high", "medium", "low"].includes(entry.confidence)) {
      reject("confidence is not high, medium or low")
      continue
    }
    shaped.push({
      dd_issue_id: id,
      root_cause: rootCause,
      suspect_file: file,
      suspect_line: line,
      confidence: entry.confidence,
    })
  }

  const suspicious =
    shaped.length > 0
      ? deps.screen(
          shaped.map(e => ({ id: e.dd_issue_id, root_cause: e.root_cause }))
        )
      : new Map<string, ScanFinding[]>()
  const accepted: TriageEntry[] = []
  for (const entry of shaped) {
    const findings = suspicious.get(entry.dd_issue_id)
    if (findings) {
      rejected.push({ id: entry.dd_issue_id, reason: screenReason(findings) })
      continue
    }
    const issue = findTriageIssue(deps.triageIssues, entry.dd_issue_id)
    if (!issue) {
      rejected.push({
        id: entry.dd_issue_id,
        reason: "no [triage] issue on GitHub",
      })
      continue
    }
    accepted.push({ ...entry, issue_number: issue.number })
  }
  return { accepted, rejected }
}

export const summaryMarkdown = (
  accepted: TriageEntry[],
  rejected: Rejected[]
): string => {
  const lines = ["## Autofix: triage", "", `Confirmed ${accepted.length}:`, ""]
  for (const entry of accepted) {
    lines.push(
      `- \`${entry.dd_issue_id}\` → #${entry.issue_number}, ${entry.confidence} confidence`
    )
  }
  if (rejected.length > 0) {
    lines.push("", "Dropped:", "")
    for (const { id, reason } of rejected) lines.push(`- \`${id}\`: ${reason}`)
  }
  return `${lines.join("\n")}\n`
}

// ---- CLI ---------------------------------------------------------------

const main = (): void => {
  const repoDir = required("REPO_DIR")
  const baseSha = required("BASE_SHA")
  const outDir = required("OUT_DIR")
  const scanScript = required("SCAN_SCRIPT")
  const candidates: string[] = JSON.parse(required("CANDIDATES"))

  const entries = parseStructuredOutput(process.env.STRUCTURED_OUTPUT)
  const { accepted, rejected } = validateEntries(entries, {
    candidates,
    triageIssues: listIssues(required("GITHUB_REPOSITORY"), "triage"),
    fileExists: file => {
      try {
        const type = execFileSync(
          "git",
          ["cat-file", "-t", `${baseSha}:${file}`],
          {
            cwd: repoDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }
        )
        return type.trim() === "blob"
      } catch {
        return false
      }
    },
    screen: list => scan(scanScript, "triage", ["root_cause"], list),
  })

  fs.mkdirSync(outDir, { recursive: true })
  for (const entry of accepted) {
    fs.writeFileSync(
      path.join(outDir, `triage-${entry.dd_issue_id}.json`),
      `${JSON.stringify(entry, null, 2)}\n`
    )
  }
  const summary = summaryMarkdown(accepted, rejected)
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  }
  if (process.env.GITHUB_OUTPUT) {
    const ids = accepted.map(entry => entry.dd_issue_id)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `count=${ids.length}\nids=${JSON.stringify(ids)}\n`
    )
  }
}

if (require.main === module) {
  if (process.argv.includes("--schema")) {
    process.stdout.write(JSON.stringify(TRIAGE_SCHEMA))
  } else {
    try {
      main()
    } catch (error: any) {
      console.error(`AUTOFIX TRIAGE FAILED: ${error.message}`)
      process.exit(1)
    }
  }
}
