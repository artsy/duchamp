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
    branches: [ main ]

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
    branches: [ main ]

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
  "plugins": [
    "npm",
    "released"
  ],
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
import { danger, warn, fail, markdown } from "danger"

// Check PR size
const bigPRThreshold = 500
const totalLines = danger.github.pr.additions + danger.github.pr.deletions

if (totalLines > bigPRThreshold) {
  warn(`This PR is quite large (${totalLines} lines). Consider breaking it into smaller PRs.`)
}

// Require tests for new features
const hasSourceChanges = danger.git.modified_files.some(file => 
  file.includes('src/') && file.endsWith('.ts')
)
const hasTestChanges = danger.git.modified_files.some(file =>
  file.includes('test/') || file.includes('spec/')
)

if (hasSourceChanges && !hasTestChanges) {
  warn('Consider adding tests for your changes.')
}

// Check for TODOs in new code
danger.git.created_files.forEach(file => {
  if (file.endsWith('.ts') || file.endsWith('.js')) {
    // This would need file content checking - simplified for example
    warn(`New file added: ${file}. Make sure it doesn't contain TODO comments.`)
  }
})

// Encourage documentation updates
const hasReadmeChanges = danger.git.modified_files.includes('README.md')
if (!hasReadmeChanges && hasSourceChanges) {
  warn('Consider updating README.md if this change affects usage.')
}
```

## Repository-Specific Configurations

### React/Frontend Project

```yaml
# .github/workflows/frontend-checks.yml
name: Frontend Checks

on: 
  pull_request:
    paths:
      - 'src/**'
      - 'package.json'
      - 'yarn.lock'

jobs:
  danger:
    name: Dependency & PR Checks
    uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
    with:
      node-version: "18"  # Match your project's Node version
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup and Install
        uses: artsy/duchamp/.github/actions/setup-and-install@main
        with:
          node-version: "18"
          install-from-caller: true
          
      - name: Type Check
        run: yarn tsc --noEmit
        
      - name: Lint
        run: yarn lint
        
      - name: Test
        run: yarn test
```

### API/Backend Project  

```yaml
# .github/workflows/api-checks.yml
name: API Checks

on:
  pull_request:
    branches: [ main, staging ]

jobs:
  danger:
    name: Danger Checks
    uses: artsy/duchamp/.github/workflows/run-danger.yml@main
    with:
      dangerfile: "danger/dangerfile.ts"
      fail-on-errors: false  # Don't fail CI, just warn
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}

  version-label:
    name: Version Label
    if: github.base_ref == 'main'  # Only on PRs to main
    uses: artsy/duchamp/.github/workflows/run-add-version-label.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Monorepo Configuration

```yaml
# .github/workflows/monorepo-checks.yml  
name: Monorepo Checks

on:
  pull_request:

jobs:
  # Check package dependencies across the monorepo
  danger-root:
    name: Root Dependencies
    uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}

  # Custom checks for monorepo structure
  danger-custom:
    name: Monorepo Structure  
    uses: artsy/duchamp/.github/workflows/run-danger.yml@main
    with:
      dangerfile: "scripts/monorepo-dangerfile.ts"
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

## Advanced Examples

### Conditional Workflows

Run different checks based on changed files:

```yaml
name: Conditional Checks

on: [pull_request]

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      docs: ${{ steps.changes.outputs.docs }}
      src: ${{ steps.changes.outputs.src }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v2
        id: changes
        with:
          filters: |
            docs:
              - 'docs/**'
              - '*.md'
            src:
              - 'src/**'
              - 'package.json'

  docs-check:
    needs: changes
    if: ${{ needs.changes.outputs.docs == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Documentation changes detected"
      
  code-check:
    needs: changes  
    if: ${{ needs.changes.outputs.src == 'true' }}
    uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Multiple Node Versions

Test across multiple Node.js versions:

```yaml
name: Multi-Node Testing

on: [pull_request]

jobs:
  test:
    strategy:
      matrix:
        node-version: [18, 20, 22]
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup and Install
        uses: artsy/duchamp/.github/actions/setup-and-install@main
        with:
          node-version: ${{ matrix.node-version }}
          install-from-caller: true
          
      - name: Test
        run: yarn test

  danger:
    # Run danger once with default Node version
    uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Security-First Configuration

Enhanced security checks:

```yaml
name: Security Checks

on:
  pull_request:
    branches: [ main ]

jobs:
  danger:
    name: PR Checks
    uses: artsy/duchamp/.github/workflows/run-danger.yml@main  
    with:
      dangerfile: "security/dangerfile.ts"
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}

permissions:
  contents: read
  pull-requests: write
  checks: write
```

Example `security/dangerfile.ts`:

```typescript
import { danger, fail, warn } from "danger"

// Check for secrets in code
const secretPatterns = [
  /api[_-]?key/i,
  /password/i,
  /secret/i,
  /token/i
]

danger.git.created_files.concat(danger.git.modified_files).forEach(file => {
  // Check filename doesn't contain secrets
  secretPatterns.forEach(pattern => {
    if (pattern.test(file)) {
      warn(`File name "${file}" might contain sensitive information`)
    }
  })
})

// Require approval for dependency changes
const hasDependencyChanges = danger.git.modified_files.some(file =>
  file === 'package.json' || file === 'yarn.lock'
)

if (hasDependencyChanges) {
  warn('⚠️ Dependencies have changed. Please ensure security review.')
}

// Check for large file additions
danger.git.created_files.forEach(file => {
  // This is a simplified example - you'd need to check actual file sizes
  if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.pdf')) {
    warn(`Large file added: ${file}. Consider if this belongs in version control.`)
  }
})
```

## Tips and Best Practices

### Workflow Organization

1. **Separate concerns**: Use different workflow files for different purposes
2. **Name workflows clearly**: Use descriptive names like "Danger Checks" vs "CI"
3. **Use appropriate triggers**: Don't run expensive checks on every push

### Performance Optimization

1. **Path filtering**: Only run workflows when relevant files change
2. **Conditional jobs**: Skip unnecessary work using job conditions
3. **Caching**: The setup-and-install action includes caching automatically

### Error Handling

1. **fail-on-errors: false**: For non-critical checks that shouldn't break CI
2. **Multiple workflows**: Separate critical from non-critical checks
3. **Clear messaging**: Use descriptive Danger.js messages

### Security

1. **Minimal permissions**: Use least-privilege principle for workflow permissions
2. **Secret management**: Never expose secrets in logs or outputs
3. **Dependency scanning**: Regularly check for vulnerable dependencies