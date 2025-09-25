# Usage Examples

This document provides real-world examples of how to use duchamp actions in different scenarios.

## Common Workflow Patterns

### Basic Node.js Project

For a standard Node.js project using Yarn:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  danger:
    name: Danger Checks
    uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}

  version-label:
    name: Version Label
    uses: artsy/duchamp/.github/workflows/run-add-version-label.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Library with Auto-Release

For libraries that use automated releases:

```yaml
# .github/workflows/release.yml
name: Release

on:
  pull_request:
    branches: [main]

jobs:
  version-label:
    name: Add Version Label
    uses: artsy/duchamp/.github/workflows/run-add-version-label.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}

  conventional-commits:
    name: Check Conventional Commits
    uses: artsy/duchamp/.github/workflows/run-conventional-commits-check.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

Required `.autorc` configuration:

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

### Custom Danger Rules

For projects needing custom Danger.js checks:

```yaml
# .github/workflows/danger.yml
name: Danger

on: [pull_request]

jobs:
  danger:
    uses: artsy/duchamp/.github/workflows/run-danger.yml@main
    with:
      dangerfile: "scripts/dangerfile.ts"
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

Example custom `scripts/dangerfile.ts`:

```typescript
import { danger, warn, fail, markdown } from "danger";

// Check PR size
const bigPRThreshold = 500;
const totalLines = danger.github.pr.additions + danger.github.pr.deletions;

if (totalLines > bigPRThreshold) {
  warn(
    `This PR is quite large (${totalLines} lines). Consider breaking it into smaller PRs.`
  );
}

// Require tests for new features
const hasSourceChanges = danger.git.modified_files.some(
  (file) => file.includes("src/") && file.endsWith(".ts")
);
const hasTestChanges = danger.git.modified_files.some(
  (file) => file.includes("test/") || file.includes("spec/")
);

if (hasSourceChanges && !hasTestChanges) {
  warn("Consider adding tests for your changes.");
}

// Check for TODOs in new code
danger.git.created_files.forEach((file) => {
  if (file.endsWith(".ts") || file.endsWith(".js")) {
    // This would need file content checking - simplified for example
    warn(
      `New file added: ${file}. Make sure it doesn't contain TODO comments.`
    );
  }
});

// Encourage documentation updates
const hasReadmeChanges = danger.git.modified_files.includes("README.md");
if (!hasReadmeChanges && hasSourceChanges) {
  warn("Consider updating README.md if this change affects usage.");
}
```
