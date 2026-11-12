# Available Actions

This document provides detailed reference information for all GitHub Actions available in duchamp.

## Quick View

| Action                               | Description                    | Usage                               |
| ------------------------------------ | ------------------------------ | ----------------------------------- |
| `run-danger.yml`                     | General Danger.js checks       | For custom danger configurations    |
| `run-danger-yarn.yml`                | Yarn-specific Danger checks    | For Node projects using Yarn        |
| `run-add-version-label.yml`          | Auto-add version labels to PRs | For repositories using auto-release |
| `run-conventional-commits-check.yml` | Validate conventional commits  | For conventional commit compliance  |
| `run-npm-audit.yml`                  | Discover vulnerabilities       | For Node projects                   |
| `run-claude-review.yml`              | AI-powered PR review           | For Claude-based code review        |
| `link-pr-to-notion.yml`             | Link PRs to Notion tasks       | For repos using Notion task tracking |
| `incident-standup-reminder.yml`      | Remind on-call to run standup  | For scheduled Slack standup reminders |
| `incident-next-on-call.yml`          | Remind engineers of an upcoming on-call shift | For scheduled Slack next-on-call reminders |
| `incident-facilitate-review.yml`     | Pick a random facilitator for the Incident Review | For scheduled Slack Incident Review facilitator selection |
| `daily-datadog-triage.yml`           | Open one pre-triaged issue from Datadog errors | For private repos triaging production errors |
| `autofix-datadog.yml`                | Draft PRs (test + fix) for new Datadog errors | For private Rails repos, with `autofix-run-ci.yml` |

## Action Reference

### run-danger.yml

**Purpose**: Run Danger.js checks with custom configuration

**Use Case**: When you need custom Danger.js rules or want to use your own dangerfile

```yaml
uses: artsy/duchamp/.github/workflows/run-danger.yml@main
with:
  dangerfile: "dangerfile.ts" # Path to dangerfile (default: "dangerfile.ts")
  node-version: "22" # Node.js version (default: "22")
  install-from-caller: false # Install deps from calling repo (default: false)
  fail-on-errors: true # Fail workflow on Danger errors (default: true)
secrets:
  danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }} # Required
```

**Inputs:**

- `dangerfile` (optional): Path to the Danger.js configuration file
- `node-version` (optional): Node.js version to use for execution
- `install-from-caller` (optional): Whether to install dependencies from the calling repository
- `fail-on-errors` (optional): Whether to fail the workflow when Danger reports errors

**Secrets:**

- `danger-token` (required): GitHub API token for Danger.js operations

---

### run-danger-yarn.yml

**Purpose**: Run Danger.js with pre-configured yarn checks

**Use Case**: For Node.js projects using Yarn that want standard dependency checking

```yaml
uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
with:
  node-version: "22" # Node.js version (default: "22")
secrets:
  danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }} # Required
```

**Features:**

- Automatically checks for yarn.lock changes
- Validates package.json modifications
- Warns about dependency vulnerabilities
- Checks for lockfile consistency

**Inputs:**

- `node-version` (optional): Node.js version to use

**Secrets:**

- `danger-token` (required): GitHub API token for Danger.js operations

---

### run-add-version-label.yml

**Purpose**: Automatically add semantic version labels to pull requests

**Use Case**: Repositories using automated release workflows that need version categorization

```yaml
uses: artsy/duchamp/.github/workflows/run-add-version-label.yml@main
with:
  node-version: "22" # Node.js version (default: "22")
secrets:
  danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }} # Required
```

**Labels Applied:**

- `Version: Minor` - New features (blue)
- `Version: Trivial` - Skip release (blue)
- `Docs` - Documentation changes (green)

**Logic:**

- Defaults to `Version: Minor` for new PRs
- Skips labeling if version label already exists
- Uses `Docs` for Netlify CMS automated PRs
- Uses `Version: Trivial` for Dependabot PRs
- Creates labels in repository if they don't exist

**Requirements:**

- Repository must have `.autorc` file
- Appropriate permissions to create/manage labels

**Inputs:**

- `node-version` (optional): Node.js version to use

**Secrets:**

- `danger-token` (required): GitHub API token with label management permissions

---

### run-conventional-commits-check.yml

**Purpose**: Validate commit messages follow conventional commit format

**Use Case**: Repositories that enforce conventional commit standards

```yaml
uses: artsy/duchamp/.github/workflows/run-conventional-commits-check.yml@main
with:
  node-version: "22" # Node.js version (default: "22")
secrets:
  danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }} # Required
```

**Validates:**

- Commit PR format: `type: description`
- Valid types (feat, fix, docs, style, refactor, test, chore)

**Inputs:**

- `node-version` (optional): Node.js version to use

**Secrets:**

- `danger-token` (required): GitHub API token for accessing commit information

---

### run-npm-audit.yml

**Purpose**: Run yarn audit and comment on PRs with vulnerability findings

**Use Case**: For Node.js projects that need automated security vulnerability detection and reporting

```yaml
uses: artsy/duchamp/.github/workflows/run-npm-audit.yml@main
with:
  node-version: "22" # Node.js version (default: "22")
  fail-on-vulnerabilities: true # Fail workflow on vulnerabilities (default: true)
  severity-threshold: "critical" # Minimum severity level (default: "critical")
```

**Features:**

- Automatically runs yarn audit on pull requests
- Comments on PRs with vulnerability details
- Configurable severity thresholds (low, moderate, high, critical)
- Optional workflow failure on vulnerability detection
- Works with both Yarn Classic and Berry versions

**Inputs:**

- `node-version` (optional): Node.js version to use
- `fail-on-vulnerabilities` (optional): Whether to fail the workflow when vulnerabilities are found
- `severity-threshold` (optional): Minimum severity level to report (low, moderate, high, critical)

**Trigger Recommendations:**

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    paths:
      - "yarn.lock"
```

---

### run-claude-review.yml

**Purpose**: AI-powered pull request review using Claude

**Use Case**: Automated code review with customizable focus areas for any repository

```yaml
uses: artsy/duchamp/.github/workflows/claude-review.yml@main
with:
  model: "claude-opus-5-5" # Claude model (default)
  timeout-minutes: 30 # Maximum review time (default: 30)
secrets:
  anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }} # Required
```

**Features:**

- Full codebase context with `fetch-depth: 0`
- Reviews with `review/prompt.md` at `high` effort: severity-marked comments
  (`blocking:` / `required:` / `nit:` / `q:`) and a Request Changes / Needs Discussion
  / Approve verdict (see `review/README.md`)
- Customizable review focus via `.claude-review.yml` config file
- Add the `security-review` label for a security pass by a dedicated subagent (see
  `security-experiment/README.md`)
- Configurable PR exclusions (see below)
- Comments directly on the PR with findings
- Default exclusions (configurable per-repo):
  - Draft PRs
  - Bot authors (dependabot, renovate, usernames containing `[bot]`)
  - PRs titled exactly "Deploy"
  - PRs with "graphql schema" in the title
  - PRs labeled `in-progress` (requires `labeled`/`unlabeled` in the caller's trigger `types`, see below)

**Inputs:**

- `model` (optional): Claude model to use for the review (default `claude-opus-5-5`).
  Small experiment PRs run on a lighter model unless you set this; see
  [Model routing](../review/README.md#model-routing)
- `timeout-minutes` (optional): Maximum time for the review job

**Secrets:**

- `anthropic-api-key` (required): Anthropic API key for Claude access
- `review-app-private-key` (optional): private key of the Artsy Review Context GitHub
  App (org secret `REVIEW_APP_PRIVATE_KEY`). The workflow mints a read-only token from
  it for private repos listed in `related_repos`. Without it, private related repos are
  skipped
- `openai-api-key` (optional): OpenAI API key (`OPENAI_API_KEY`) for the
  [Codex experiment](../codex-experiment/README.md)'s second review. Without it, only
  Claude reviews

**Setting Up the API Key:**

The `ANTHROPIC_API_KEY` secret must be configured in GitHub before this workflow can run. There are two ways to do this:

1. **Organization-level secret** (recommended for Artsy): An admin can set this once at https://github.com/organizations/artsy/settings/secrets/actions, and it will be available to all repos in the org.

2. **Repository-level secret**: Go to your repo → Settings → Secrets and variables → Actions → New repository secret. Name it `ANTHROPIC_API_KEY` and paste your Anthropic API key as the value.

You can get an API key from https://console.anthropic.com/settings/keys.

**Repo Configuration:**

Create a `.claude-review.yml` file in your repository root to customize reviews:

```yaml
focus_areas:
  - "Watch for N+1 queries in database operations"
  - "Ensure new endpoints have authentication"
  - "Check that new features have tests"

ignore_paths:
  - "**/*.generated.ts"
  - "**/migrations/**"

context: |
  This is a Ruby on Rails API. We use GraphQL with graphql-ruby.
  Authentication is handled via JWT tokens.
```

**Configuration Options:**

- `prompt`: Complete custom prompt (replaces `review/prompt.md` - use this for full control)
- `focus_areas`: Array of specific concerns for Claude to watch for (added to the prompt)
- `ignore_paths`: Glob patterns for files Claude should skip reviewing
- `context`: Additional context about your codebase architecture
- `exclude`: PR exclusion rules (see below)
- `related_repos`: other `artsy/<name>` repos that related-repos experiment reviews can
  read, such as `artsy/metaphysics`. Read from the default branch, so changes apply
  once merged (see `related-repos-experiment/README.md`)

**PR Exclusions:**

Repos can configure custom PR exclusions to skip AI review for specific PRs:

```yaml
# .claude-review.yml
exclude:
  title_patterns:
    - "eigen query map" # Case-insensitive regex
    - "schema sync"
  disable_defaults: false # Set to true to only use repo patterns
```

- `title_patterns`: Array of regex patterns to match against PR titles (case-insensitive)
- `disable_defaults`: When `true`, only repo-specific patterns are used; default exclusions are disabled

Default exclusions:

- **Always excluded** (cannot be disabled): Draft PRs, bots (username contains `[bot]`), `dependabot`, `renovate`, PRs labeled `in-progress`
- **Title patterns** (disabled with `disable_defaults: true`): `^Deploy$` (exact match), `graphql schema` (contains)

**Complete Prompt Override:**

For full control over the review prompt, use the `prompt` field:

```yaml
prompt: |
  You are a security-focused code reviewer.

  Only look for:
  - SQL injection vulnerabilities
  - XSS vulnerabilities
  - Authentication/authorization issues

  Ignore style and formatting issues entirely.
```

**Experiments:**

Opt-in groups, each with a `participants.yml` and a label for single PRs.
`review/experiments.md` lists them with past experiments, who created each and the PR
that introduced it:

- Lean reviews (`ai-review-lean`): AGENTS.md and the diff in the prompt,
  re-reviews, model routing, fewer inline comments. See
  `lean-reviews-experiment/README.md`.
- Related-repos experiment (`ai-review-related-repos`): reads the other Artsy repos in
  the repo's `related_repos`, such as metaphysics when reviewing eigen. See
  `related-repos-experiment/README.md`.
- Security experiment (`security-review`): a security pass by a subagent. See
  `security-experiment/README.md`.
- Best-practices experiment (`ai-review-best-practices`): stack skills such as
  React Native best practices. See `best-practices-experiment/README.md`.
- Merge risk experiment (`ai-review-merge-risk`): a low, medium or high merge risk
  rating in the summary. See `merge-risk-experiment/README.md`.

**Security Notes:**

- Requires approval for external contributors to prevent prompt injection
- Read-only code access - Claude comments but cannot push changes
- Works with branch protection rules

**Trigger Recommendations:**

```yaml
on:
  pull_request:
    types: [opened, synchronize, ready_for_review, labeled, unlabeled]
    # Optional: skip docs-only PRs to reduce costs
    paths-ignore:
      - "**.md"
      - "docs/**"
```

`labeled`/`unlabeled` are required for the `in-progress` label exclusion below to take effect as soon as the label is added or removed, rather than waiting for the next push.

---

### link-pr-to-notion.yml

**Purpose**: Automatically link pull requests to Notion tasks referenced by short ID (e.g. `PM-42`) in the PR title, body, or commits

**Use Case**: Repositories that track work in Notion and want PRs automatically connected to their corresponding tasks

```yaml
uses: artsy/duchamp/.github/workflows/link-pr-to-notion.yml@main
secrets:
  notion-token: ${{ secrets.NOTION_TOKEN }}       # Required
  root-page-id: ${{ secrets.NOTION_ROOT_PAGE_ID }} # Required
```

**Features:**

- Scans PR title, body, and all commit messages for short IDs (e.g. `PM-42`, `ENG-7`)
- Discovers all teams and their task databases automatically via Notion API
- Appends the PR URL to the `PR Links` field on the matching Notion task
- Skips gracefully if the task is not found or the URL is already linked

**Secrets:**

- `notion-token` (required): Notion API integration token
- `root-page-id` (required): Notion root page ID used for team and database discovery

**Optional Inputs** (configure via the action directly if needed):

- `unique-id-property`: Name of the Unique ID property on Tasks databases (default: `"ID"`)
- `pr-links-property`: Name of the Rich Text property where PR URLs are stored (default: `"PR Links"`)
- `github-token`: GitHub token used to list PR commits (default: `${{ github.token }}`)

**Trigger Recommendations:**

```yaml
on:
  pull_request:
    types: [opened, edited]
```

**Required Secrets Setup:**

The `NOTION_TOKEN` and `NOTION_ROOT_PAGE_ID` secrets must be configured before this workflow can run:

1. **Organization-level secrets** (recommended for Artsy): Set once at https://github.com/organizations/artsy/settings/secrets/actions and available to all repos.
2. **Repository-level secrets**: Go to your repo → Settings → Secrets and variables → Actions → New repository secret.

---

### incident-standup-reminder.yml

**Purpose**: Post a Slack reminder to the current on-call participant(s) to facilitate standup

**Use Case**: Scheduled workflows that need to notify whoever is on-call right now, sourced from an incident.io schedule

```yaml
uses: artsy/duchamp/.github/workflows/incident-standup-reminder.yml@main
with:
  schedule-id: ${{ vars.INCIDENT_IO_SCHEDULE_ID }}
  node-version: "22"
  boundary-weekday: 1
  boundary-hour: 11
secrets:
  incident-io-api-key: ${{ secrets.INCIDENT_IO_API_KEY }}
  slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
```

**Features:**

- Queries incident.io's `/v2/schedule_entries` with a tight time window around "now" to find who is actually on call at the moment the workflow runs (incident.io has no dedicated "current on-call" endpoint, so the window is computed explicitly rather than relying on default query behavior)
- Anchors that query to a deterministic on-call shift-change boundary (`boundary-weekday`/`boundary-hour`, in America/New_York time) rather than the workflow's literal execution time — since GitHub's `schedule` trigger can fire a few minutes late, this guarantees the reminder always reflects who was on-call up to the boundary, not whoever the schedule just handed off to, regardless of exactly when the job happens to run
- Builds Slack mentions directly from each schedule entry's `slack_user_id` — no separate email-to-Slack-ID lookup step
- Posts the reminder via `8398a7/action-slack@v3` using the caller's `SLACK_WEBHOOK_URL`

**Inputs:**

- `schedule-id` (required): incident.io schedule ID to query
- `node-version` (optional): Node.js version to use
- `boundary-weekday` (optional): Day of week the on-call shift changes, `0` (Sunday) through `6` (Saturday). Default: `1` (Monday). Must match the day this workflow actually runs on — a mismatch (e.g. the cron schedule changes but this isn't updated) causes the run to fail loudly rather than silently anchor to the wrong day
- `boundary-hour` (optional): Hour of day the on-call shift changes, `0`-`23`, in America/New_York time. Default: `11` (11am ET)

**Secrets:**

- `incident-io-api-key` (required): incident.io API key with access to the schedule
- `slack-webhook-url` (required): Slack incoming webhook URL to post the reminder to

---

### incident-next-on-call.yml

**Purpose**: Post a Slack reminder to engineers whose on-call shift is starting soon, so they can prepare

**Use Case**: Scheduled workflows that need to give advance notice of upcoming on-call shifts, sourced from an incident.io schedule. Intended to be called **once per cron schedule** the caller runs on, each call passing its own literal target — see the two-job example below

```yaml
on:
  schedule:
    - cron: "0 14 * * MON"
    - cron: "0 14 * * THU"

jobs:
  monday-safety-cutoff:
    if: github.event.schedule == '0 14 * * MON'
    uses: artsy/duchamp/.github/workflows/incident-next-on-call.yml@main
    with:
      schedule-id: ${{ vars.INCIDENT_IO_SCHEDULE_ID }}
      target-weekday: 5 # Friday
      target-hour: 0 # midnight ET
    secrets:
      incident-io-api-key: ${{ secrets.INCIDENT_IO_API_KEY }}
      slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}

  thursday-rotation-boundary:
    if: github.event.schedule == '0 14 * * THU'
    uses: artsy/duchamp/.github/workflows/incident-next-on-call.yml@main
    with:
      schedule-id: ${{ vars.INCIDENT_IO_SCHEDULE_ID }}
      target-weekday: 1 # Monday
      target-hour: 11 # 11am ET
    secrets:
      incident-io-api-key: ${{ secrets.INCIDENT_IO_API_KEY }}
      slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
```

The specific values above reflect one real cadence (a generous Friday-midnight cutoff for the handoff-day run, a tight Monday-11am-ET target for the other) — see joule's `next-on-call.yml` for the fully-annotated production version.

**Features:**

- Queries incident.io's `/v2/schedule_entries` for a forward-looking window and includes only entries whose shift hasn't started yet (`start_at` after the run instant) — covers both regularly scheduled shifts and overrides, since incident.io merges both into the `final` array
- Looks ahead to a single caller-supplied `target-weekday`/`target-hour`, resolved to a deterministic UTC instant (DST-aware) regardless of the workflow's literal execution time — the workflow itself has no notion of "which day is this" or what the target means; that mapping lives entirely in the calling job's config
- A small internal margin is added past the target instant, so a shift starting exactly at that boundary is still included
- Silently skips posting to Slack (logs to the run's console output instead) when no one has an upcoming shift in the window, rather than posting an empty or awkward "nobody's up next" message
- Builds Slack mentions directly from each schedule entry's `slack_user_id` — no separate email-to-Slack-ID lookup step

**Inputs:**

- `schedule-id` (required): incident.io schedule ID to query
- `node-version` (optional): Node.js version to use
- `target-weekday` (required): Day of week to look ahead to, `0` (Sunday) through `6` (Saturday)
- `target-hour` (required): Hour of the target, `0`-`23`, in America/New_York time

**Secrets:**

- `incident-io-api-key` (required): incident.io API key with access to the schedule
- `slack-webhook-url` (required): Slack incoming webhook URL to post the reminder to

---

### incident-facilitate-review.yml

**Purpose**: Post a Slack notice picking a random on-call participant to facilitate the upcoming Incident Review meeting

**Use Case**: Scheduled workflows that need to select and notify a facilitator ahead of a biweekly Incident Review meeting, sourced from an incident.io schedule. Intended to be called from both a routine day-before cron and an occasional manual `workflow_dispatch` for off-week catch-up reviews — see the example below

```yaml
on:
  workflow_dispatch:
    inputs:
      meeting-date:
        description: "Override meeting date (YYYY-MM-DD) — only for a rare off-week catch-up review, leave blank otherwise"
        required: false
        type: string
  schedule:
    - cron: "0 14 * * WED"

jobs:
  facilitate-review:
    uses: artsy/duchamp/.github/workflows/incident-facilitate-review.yml@main
    with:
      schedule-id: ${{ vars.INCIDENT_IO_SCHEDULE_ID }}
      meeting-weekday: "4" # Thursday
      meeting-hour: "11"
      meeting-minute: "30"
      base-date: "2023-04-27"
      override-date: ${{ github.event.inputs.meeting-date }}
    secrets:
      incident-io-api-key: ${{ secrets.INCIDENT_IO_API_KEY }}
      slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
```

joule's real workflow sources these values from repo vars instead of literals, so they can be changed without a duchamp PR — see joule's `facilitate-incident-review.yml` for that version.

**Features:**

- Queries incident.io at the actual meeting instant, not the day the workflow runs, so a schedule change made between run and meeting is still honored
- Routine path (no `override-date`): runs the day before the meeting, computed in ET civil time (not raw UTC, since a cron's UTC firing instant can land on a different calendar date). Skips silently on an off-week; throws if tomorrow isn't `meeting-weekday` (cron/config drift)
- Manual catch-up path (`override-date` set): targets that date directly on any weekday, bypassing the on/off-week check — meant for a rare off-week catch-up review
- `base-date` anchors the every-other-week cadence via exact day-level arithmetic, so it never drifts no matter how old it gets
- Picks one random participant from whoever is actually on-call at the resolved meeting instant
- Posts an explicit `:warning:` notice instead of a silent/empty mention when nobody on-call is reachable on Slack

**Inputs:**

- `schedule-id` (required): incident.io schedule ID to query
- `node-version` (optional): Node.js version to use
- `meeting-weekday` (optional, `type: string`): Day of week the meeting runs, `0` (Sunday) through `6` (Saturday). Default: `4` (Thursday)
- `meeting-hour` (optional, `type: string`): Hour the meeting runs, `0`-`23`, in America/New_York time. Default: `11`
- `meeting-minute` (optional, `type: string`): Minute the meeting runs, `0`-`59`. Default: `30`
- `base-date` (required): `YYYY-MM-DD` date known to fall on an on-week, on the same weekday as `meeting-weekday`
- `override-date` (optional): `YYYY-MM-DD` to target directly for a manual catch-up review, bypassing the on/off-week check. Must resolve to a future date no more than 60 days out (catches a year typo)

`meeting-weekday`/`meeting-hour`/`meeting-minute` are `type: string`, not `type: number`, because GitHub Actions coerces an unset `type: number` input to `0` rather than falling back to the declared default ([actions/runner#2907](https://github.com/actions/runner/issues/2907)).

**Secrets:**

- `incident-io-api-key` (required): incident.io API key with access to the schedule
- `slack-webhook-url` (required): Slack incoming webhook URL to post the notice to

---

### daily-datadog-triage.yml

**Purpose**: Scan a repo's production errors in Datadog and open at most **one** pre-triaged GitHub issue per run

**Use Case**: Private repos that want a daily shortlist of production errors. Read-only — never edits code or opens a PR; fixes stay human-initiated

Copy `templates/run-daily-datadog-triage.yml` into the calling repo — it carries the schedule, secret names, and setup notes.

```yaml
jobs:
  triage:
    uses: artsy/duchamp/.github/workflows/daily-datadog-triage.yml@main
    secrets:
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
      dd-api-key: ${{ secrets.DD_TRIAGE_API_KEY }}
      dd-app-key: ${{ secrets.DD_TRIAGE_APP_KEY }}
      triage-issues-token: ${{ secrets.TRIAGE_ISSUES_TOKEN }}
```

**Features:**

- Aborts on public repos — write-ups quote stack traces and production data
- Deny-by-default tools: `pup`, read-only `git`, `gh issue`/`gh label`, plus a hook blocking credential reads. Issue writes use `triage-issues-token`; `GITHUB_TOKEN` gets only `contents: read`
- `pup` release and the `datadog-labs/agent-skills` SHA are pinned, so a scheduled run can't pick up new tooling or new model instructions
- Triage rules live in the skill, not this workflow

**One-time setup in the calling repo:**

1. Sync the `datadog-triage` skill to `.claude/skills/datadog-triage/` (fixed path — the run aborts if it's missing). Source of truth: [artsy/agent-tooling](https://github.com/artsy/agent-tooling) `plugins/artsy-artnet/skills/datadog-triage`; edit it there, never downstream.
2. Create the `triage`, `triage/fixed`, and `triage/rejected` labels.
3. Add the secrets below, and list the repo's Datadog services in its `CLAUDE.md`.

**Inputs:**

- `dd-site` (optional): Datadog site. Default: `datadoghq.com`
- `model` (optional): Default `claude-sonnet-5`; bump to `claude-opus-5` if write-ups come out thin
- `timeout-minutes` (optional): Whole-job timeout. Default: `30`

**Secrets:**

- `anthropic-api-key` (required): Anthropic API key for Claude Code
- `dd-api-key` (required): Datadog API key
- `dd-app-key` (required): Datadog app key, scoped `apm_read` + `error_tracking_read` — the run aborts in preflight without the latter
- `triage-issues-token` (required): `issues:write` on the calling repo only — no `contents:write`, no PR scope

---

### autofix-datadog.yml

**Purpose**: Turn **new** production errors from Datadog Error Tracking into draft PRs, each with a regression test and a fix, for a human to read before CI runs

**Use Case**: Private Rails repos (Gravity, Volt) whose errors have readable Ruby frames. Success is merged PRs, not PRs opened

Copy `templates/run-autofix.yml` and `templates/run-autofix-ci.yml` into the calling repo. They carry the schedule (Monday and Thursday), the dispatch inputs and the secret names.

```yaml
jobs:
  autofix:
    uses: artsy/duchamp/.github/workflows/autofix-datadog.yml@main
    with:
      services: "gravity gravity.grape gravity.sidekiq gravity.sneakers"
      dd-issue-id: ${{ inputs.dd-issue-id || '' }}
      dry-run: ${{ inputs.dry-run || false }}
    secrets:
      anthropic-api-key: ${{ secrets.ANTHROPIC_AUTOFIX_KEY }}
      dd-api-key: ${{ secrets.DD_AUTOFIX_API_KEY }}
      dd-app-key: ${{ secrets.DD_AUTOFIX_APP_KEY }}
      triage-issues-token: ${{ secrets.TRIAGE_ISSUES_TOKEN }}
      app-id: ${{ secrets.AUTOFIX_APP_ID }}
      app-private-key: ${{ secrets.AUTOFIX_APP_PRIVATE_KEY }}
```

**Jobs:**

1. `stale` (no model): closes `autofix` draft PRs idle for 28 days, deletes the branch, and says so on the triage issue.
2. `select` (no model): Error Tracking issues for `services` in `env:production`, first seen in the last 5 days. Drops issues that already have a `[triage] … (dd:<id>)` issue or the `autofix/attempted` label, network and infra errors, security errors (never autofixed), errors below `min-events` / `min-users`, and errors whose top in-app frame (taken from a trace stack when the raising frame is a gem) isn't under `app/` or `lib/`. Screens the message, endpoint and URL with `scan_text.py`. Keeps up to `issue-limit` by events and writes a packet per error. Every dropped error is listed with its reason in the step summary.
3. `triage` (model, read-only): the `datadog-triage` skill on select's candidates, with `ISSUE_LIMIT` and a JSON result. It opens the `[triage]` issues. A missing result, or a `status` other than `ok`, fails the run; each entry is checked against the candidates and the repo, and issue numbers come from GitHub.
4. `fix` (model, one job per issue, two at a time): the agent may read the repo and edit only `app/`, `lib/` (not `lib/tasks/`) and `spec/` (not the spec helpers or `spec/support/`). It cannot run commands other than `git log` and `git blame` with a fixed set of read-only flags, reach the network, or use MCP. It follows the vendored `diagnosing-bugs` and `pr` skills (`vendor/skills/`) as adapted in `scripts/autofix/prompt.md`, and writes a test first, then the fix, or skips.
5. `publish` (no model, fresh runner): applies the patches to the base commit and checks git's own view of them. It takes `meta.json` from select's artifact; the fix job supplies only the patches, `result.json`, `pr-body.md` and its cost. Then opens a draft PR with two `[skip ci]` commits (test, then fix), requests `reviewer` and the suspect author (from `git blame` on the top in-app frame), and comments on the triage issue. A rejected or skipped patch gets a comment with the reason instead.

**Publish rejects a patch unless:**

- the agent's decision is `fix`
- it changes at least one file under `spec/` and one outside it
- every path is in the allowlist above; no dot-files
- every file is a regular `100644` file: no symlinks, submodules, mode changes or binaries
- added plus removed lines stay within `max-lines`, spec lines counted at half weight
- it adds no `[DEBUG-…]` tags

Paths matching `sensitive-paths` still publish, labelled `autofix/sensitive` and noted under Merge Danger.

**Security model:**

- Error messages, URLs and params are attacker-controlled (Volt's Datadog holds SSTI and `/etc/passwd` probes). They are cut short, stripped of hidden characters and fenced as data, and screened before any model reads them.
- The fix job holds only the spend-capped Anthropic key and a read-only `github.token`. A PreToolUse hook (`scripts/autofix/fix-guard.sh`) resolves real paths and blocks everything outside the limits above, even if the repo's own Claude settings allow more. The repo's `.claude/settings.json` and `.mcp.json` are removed for that job, so no repo hook runs on files the agent writes.
- After the agent, the fix job runs only inline shell from the workflow. It builds the patches with git in a pristine clone the agent never saw.
- No agent-written code runs anywhere until a human adds `autofix/run-ci`. The PR body drops the agent's mentions, closing keywords, issue refs and links outside `app.datadoghq.com` and `github.com/artsy`; the title and commit messages drop all links too.
- GitHub's **Update branch** button, or any push without `[skip ci]`, also runs CI on the agent's code, so read the diff first. Add a branch ruleset on `autofix/*` that limits who can push.

**One-time setup in the calling repo:**

1. Sync the `datadog-triage` and `screen-untrusted-input` skills to `.claude/skills/` from [artsy/agent-tooling](https://github.com/artsy/agent-tooling). The run aborts without them.
2. Create the `triage`, `triage/fixed` and `triage/rejected` labels. Publish creates the `autofix*` labels.
3. Add the secrets below and set the repository variable `AUTOFIX_DRY_RUN=true`.
4. Add `run-autofix-ci.yml` (below).
5. Remove `AUTOFIX_DRY_RUN` once dry runs have produced at least three patches worth reviewing, and no sooner than two weeks in.

**Dry run and single-issue runs:** run the workflow by hand with `dry-run` checked, or set `AUTOFIX_DRY_RUN=true`. Everything runs except the writes in `publish`: no branch, PR, label or comment. The step summary and the `autofix-dry-run-<id>` artifact show the PR body or the rejection. Triage still opens its issues. To retry one error, or try one without triage, pass its Datadog issue id as `dd-issue-id`. That skips ranking, dedupe, the gates and triage, but not the screen.

**Inputs:**

- `services` (required): Datadog services to search, e.g. `gravity gravity.grape`
- `dd-site` (optional): Datadog site. Default: `datadoghq.com`
- `issue-limit` (optional): Most errors attempted per run. Default: `3`
- `min-events` / `min-users` (optional): Thresholds over the last 5 days. Defaults: `1` / `0`
- `max-lines` (optional): Patch size cap, spec lines at half weight. Default: `150`
- `sensitive-paths` (optional): Globs to label and flag, not block. Default: empty
- `triage-model` / `fix-model` (optional): Defaults `claude-sonnet-5-5` / `claude-opus-5-5`
- `reviewer` (optional): Always requested; assignee when there's no suspect author. Default: `MounirDhahri`
- `dd-issue-id` (optional): One Datadog issue, as above
- `dry-run` (optional): Stop before any write in publish. Default: `false`

**Secrets:**

- `anthropic-api-key` (required): A dedicated Anthropic key with a monthly spend limit
- `dd-api-key` / `dd-app-key` (required): Read-only Datadog keys, app key scoped `apm_read` + `error_tracking_read`
- `triage-issues-token` (required): `issues:write` on the calling repo only, for the triage skill
- `app-id` / `app-private-key` (required): The autofix GitHub App, with contents, pull-requests and issues write on the calling repo

---

### autofix-run-ci.yml

**Purpose**: Run the repo's CI on an autofix PR once someone has read it

**Use Case**: Every repo that uses `autofix-datadog.yml`. Autofix commits carry `[skip ci]`, so CI never runs agent-written code on its own

Copy `templates/run-autofix-ci.yml` into the calling repo. When someone with write access adds the `autofix/run-ci` label to an `autofix/*` PR, this pushes an empty commit (through the API, without checking out the code) on top of the head they labelled. If the branch moved since, the push fails. It listens on `pull_request_target`, because the head commit's `[skip ci]` suppresses `pull_request` runs; that is safe because it never checks out the PR's code.

```yaml
on:
  pull_request_target:
    types: [labeled]

jobs:
  run-ci:
    if: github.event.label.name == 'autofix/run-ci'
    uses: artsy/duchamp/.github/workflows/autofix-run-ci.yml@main
    secrets:
      app-id: ${{ secrets.AUTOFIX_APP_ID }}
      app-private-key: ${{ secrets.AUTOFIX_APP_PRIVATE_KEY }}
```

**Secrets:**

- `app-id` / `app-private-key` (required): The same GitHub App as `autofix-datadog.yml`

---

## Reusable Action

### setup-and-install

**Purpose**: Set up Node.js environment and install dependencies with Yarn version detection

**Location**: `.github/actions/setup-and-install/`

```yaml
- uses: artsy/duchamp/.github/actions/setup-and-install@main
  with:
    node-version: "22" # Node.js version (default: "22")
    install-from-caller: false # Install from caller directory (default: false)
```

**Features:**

- Automatically detects Yarn version (Classic vs Berry)
- Uses appropriate installation flags for each Yarn version
- Caches dependencies for faster subsequent runs
- Supports both repository root and `.tooling` directory installation

**Inputs:**

- `node-version` (optional): Node.js version to install
- `install-from-caller` (optional): Whether to install dependencies from calling repository

---

## Action Selection Guide

| Use Case                        | Recommended Action                   | Notes                                |
| ------------------------------- | ------------------------------------ | -------------------------------------|
| Basic Node.js project with Yarn | `run-danger-yarn.yml`                | Includes dependency checking         |
| Custom Danger.js rules          | `run-danger.yml`                     | Requires custom dangerfile.ts        |
| Automated releases              | `run-add-version-label.yml`          | Requires .autorc file                |
| Conventional commits            | `run-conventional-commits-check.yml` | Enforces commit standards            |
| Security vulnerability scanning | `run-npm-audit.yml`                  | Scans yarn.lock for vulnerabilities  |
| AI-powered code review          | `run-claude-review.yml`              | Uses Claude to review PRs            |
| Notion task tracking            | `link-pr-to-notion.yml`             | Links PRs to Notion tasks by short ID |
| Scheduled on-call Slack reminders | `incident-standup-reminder.yml`   | Sources current on-call from incident.io |
| Scheduled upcoming on-call reminders | `incident-next-on-call.yml`    | Notifies engineers ahead of their shift starting |
| Scheduled Incident Review facilitator selection | `incident-facilitate-review.yml` | Picks a random on-call participant to facilitate |
| Daily production error triage    | `daily-datadog-triage.yml`           | Private repos only; opens one issue per run |
| Draft fixes for new production errors | `autofix-datadog.yml` + `autofix-run-ci.yml` | Private Rails repos; a human reads each PR before CI runs |
| Custom workflows                | `setup-and-install` action           | Use as a step in custom workflows    |

## Security Considerations

- All actions run in isolated environments
- Secrets are only accessible to the specific workflow
- No sensitive data is logged or exposed
- Actions follow GitHub's security best practices

## Compatibility

### Node.js Versions

- Default: Node.js 22
- Supported: Node.js 16, 18, 20, 22
- LTS versions recommended for production

### Yarn Versions

- Yarn 1 (Classic): Full support
- Yarn 2+ (Berry): Full support with auto-detection

### GitHub Features

- Works with both public and private repositories
- Compatible with branch protection rules
- Supports required status checks
