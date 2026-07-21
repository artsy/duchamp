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
  model: "claude-opus-4-20250514" # Claude model (default)
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
