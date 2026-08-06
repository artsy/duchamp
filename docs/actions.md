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
  model: "claude-opus-4-8" # Claude model (default)
  timeout-minutes: 30 # Maximum review time (default: 30)
secrets:
  anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }} # Required
```

**Features:**

- Full codebase context with `fetch-depth: 0`
- Customizable review focus via `.claude-review.yml` config file
- Configurable PR exclusions (see below)
- Comments directly on the PR with findings
- Default exclusions (configurable per-repo):
  - Draft PRs
  - Bot authors (dependabot, renovate, usernames containing `[bot]`)
  - PRs titled exactly "Deploy"
  - PRs with "graphql schema" in the title
  - PRs labeled `in-progress` (requires `labeled`/`unlabeled` in the caller's trigger `types`, see below)

**Inputs:**

- `model` (optional): Claude model to use for the review
- `timeout-minutes` (optional): Maximum time for the review job

**Secrets:**

- `anthropic-api-key` (required): Anthropic API key for Claude access

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

- `prompt`: Complete custom prompt (overrides everything else - use this for full control)
- `focus_areas`: Array of specific concerns for Claude to watch for (added to default prompt)
- `ignore_paths`: Glob patterns for files Claude should skip reviewing
- `context`: Additional context about your codebase architecture
- `exclude`: PR exclusion rules (see below)

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

**Personal Review Styles:**

Individuals can customize the *tone* of reviews on their own PRs, across every
repo that uses this workflow, without touching any repo's `.claude-review.yml`.

Add `review-styles/<your-github-login>.md` (lowercase) to the `duchamp` repo. It's
picked up automatically for PRs you author, based on `github.event.pull_request.user.login`.

```markdown
---
mode: augment
---
Be blunt and terse. Skip the summary on small PRs.
I care most about data-pipeline correctness and idempotency; flag anything
that could double-write or silently drop rows. UK English.
```

`mode` (optional, defaults to `augment`) controls how the file merges with the
default prompt:

- `augment` (default): keeps the full default prompt (guardrails, review format)
  and appends your content as a "Reviewer Style Preferences" section that takes
  precedence on tone.
- `replace_style`: keeps the default guardrails and review format, but swaps out
  the "How to write" tone guidance for your content.
- `override`: your content becomes the entire prompt - no guardrails or format
  are kept unless you write them yourself.

Precedence: a repo's `.claude-review.yml` `prompt:` field always wins over a
personal style (repo-wide override beats individual preference). Otherwise, a
repo's `focus_areas`/`context`/`ignore_paths` still apply under `augment` and
`replace_style` (scope stays with the repo, tone with the individual) but not
under `override`.

See [`review-styles/README.md`](../review-styles/README.md) for details.

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
