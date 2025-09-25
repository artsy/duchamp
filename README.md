# duchamp
Reusable Github actions for the Artsy org.

## Available Workflows

### 🔒 NPM Audit
Runs yarn audit and comments on PRs with vulnerability findings.

```yaml
name: Run NPM Audit

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    paths:
      - "yarn.lock"

jobs:
  npm-audit:
    uses: artsy/duchamp/.github/workflows/run-npm-audit.yml@main
    # Optional inputs:
    # with:
    #   node-version: "22"              # Default: "22"
    #   fail-on-vulnerabilities: true   # Default: true
    #   severity-threshold: "critical"     # Default: "critical" (options: critical, high, moderate, low)
```

### Danger Checks
Runs Danger CI for PR checks.

### Conventional Commit PR Titles
Validates PR titles follow conventional commit format.
