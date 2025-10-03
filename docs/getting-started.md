# Getting Started with duchamp

This guide will help you integrate duchamp's reusable GitHub Actions into your Artsy repository.

## Overview

Duchamp provides standardized workflows for common development tasks across Artsy repositories. By using these shared actions, teams can:

- Maintain consistency across projects
- Reduce duplication of workflow configuration
- Benefit from centralized updates and improvements
- Follow Artsy engineering best practices automatically

## Prerequisites

Before using duchamp actions, ensure your repository has:

1. **GitHub Actions enabled** in your repository settings
2. **Required secrets configured** (detailed below)
3. **Node.js project structure** (for Node.js-related actions)
4. **Appropriate branch protection rules** if using automated labeling

## Required Secrets

Most duchamp actions require the following secret to be configured in your repository:

### DANGER_GITHUB_API_TOKEN

This token allows Danger.js to comment on pull requests and perform repository operations.

**Setup:**

1. Go to your repository's Settings > Secrets and variables > Actions
2. Click "New repository secret"
3. Name: `DANGER_GITHUB_API_TOKEN`
4. Value: Contact [@amonkhouse](https://github.com/amonkhouse) or [@mc-jones](https://github.com/mc-jones) for the token value

## Basic Integration

### Step 1: Create Workflow Files

Create workflow files in your repository's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows
```

### Step 2: Add Basic Actions

Start with the most common workflows:

#### Danger.js Checks (Recommended for all Node repos)

```yaml
# .github/workflows/danger.yml
name: Danger Checks

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  danger:
    uses: artsy/duchamp/workflows/run-danger-yarn.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

#### Version Labeling (For repos with auto-release)

```yaml
# .github/workflows/version-label.yml
name: Version Label

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  version-label:
    uses: artsy/duchamp/workflows/run-add-version-label.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Step 3: Repository-Specific Configuration

#### For Auto-Release Integration

If your repository uses automated releases, create an `.autorc` file:

```json
{
  "plugins": ["npm", "released"],
  "labels": {
    "Version: Major": "major",
    "Version: Minor": "minor",
    "Version: Patch": "patch",
    "Version: Trivial": "skip-release"
  }
}
```

#### For Custom Danger Configuration

Create a `dangerfile.ts` in your repository root for custom checks:

```typescript
// dangerfile.ts
import { danger, warn, fail } from "danger";

// Example: Ensure PR has description
if (!danger.github.pr.body || danger.github.pr.body.length < 10) {
  warn("Please add a description to your PR.");
}

// Example: Check for large PRs
const bigPRThreshold = 500;
if (danger.github.pr.additions + danger.github.pr.deletions > bigPRThreshold) {
  warn(
    `This PR is quite large (${
      danger.github.pr.additions + danger.github.pr.deletions
    } lines). Consider breaking it into smaller PRs.`
  );
}
```

## Advanced Configuration

### Custom Node Version

```yaml
jobs:
  danger:
    uses: artsy/duchamp/workflows/run-danger-yarn.yml@main
    with:
      node-version: "18" # Use Node 18 instead of default 22
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Custom Dangerfile Path

```yaml
jobs:
  danger:
    uses: artsy/duchamp/workflows/run-danger.yml@main
    with:
      dangerfile: "scripts/dangerfile.ts" # Custom path
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Installing Dependencies from Calling Repository

```yaml
jobs:
  danger:
    uses: artsy/duchamp/workflows/run-danger.yml@main
    with:
      install-from-caller: true # Install deps from your repo, not duchamp
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

## Troubleshooting

### Common Issues

1. **Missing DANGER_GITHUB_API_TOKEN**: Workflows will fail if this secret is not configured
2. **Permission errors**: Ensure the token has appropriate repository permissions
3. **Node version conflicts**: Specify a compatible Node version if your project requires a specific version

### Getting Help

- Review existing workflow runs for error messages
- Contact [@amonkhouse](https://github.com/amonkhouse) or [@mc-jones](https://github.com/mc-jones)
- Ask in [#product-sapphire](https://artsy.slack.com/messages/product-sapphire) 🔒

## Next Steps

- Review [available actions](./actions.md) for additional workflows
- See [examples](./examples.md) for real-world usage patterns
