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
