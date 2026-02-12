# Configurable PR Exclusions for Claude AI Review

Adds the ability for repos to configure custom PR exclusions via `.claude-review.yml`.

## Problem

Some repos have automated PRs (e.g., metaphysics "eigen query map" PRs) that don't need AI review. Previously, exclusions were hardcoded in the workflow.

## Solution

Repos can now add custom title patterns to exclude:

```yaml
# .claude-review.yml
exclude:
  title_patterns:
    - "eigen query map"
```

## Changes

- `scripts/check-pr-exclusions.js` - New script to check title exclusions
- `.github/workflows/claude-review.yml` - Reads repo config and applies exclusions
- `docs/actions.md` - Documents the new `exclude` option

## Default Exclusions (unchanged)

- Draft PRs
- Bot authors (`[bot]`, `dependabot`, `renovate`)
- Titles: exact "Deploy", contains "graphql schema"

## Config Options

| Option | Description |
|--------|-------------|
| `exclude.title_patterns` | Array of regex patterns (case-insensitive) |
| `exclude.disable_defaults` | Set `true` to disable default title patterns |
