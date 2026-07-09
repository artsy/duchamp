# Adopting the AGENTS.md lint in a repo

`artsy/duchamp` hosts a reusable GitHub Action that lints a repo's `AGENTS.md` —
the single, tool-agnostic source of truth for AI coding-agent guidance (Claude
Code, Cursor, Copilot, ...). Modern agents read `AGENTS.md` directly, so there
are no per-tool files to generate — just keep `AGENTS.md` clean.

Reference implementations: `artsy/agent-tooling`, `artsy/force`, `artsy/volt`.

## What you get

- **Lint** — on every PR that touches `AGENTS.md`, reject Claude-specific
  patterns (MCP tool names, `/plugin` commands, `CLAUDE_PLUGIN_ROOT`,
  `PreToolUse`, etc.). That content belongs in `CLAUDE.md`, not the shared file.

## Prerequisites

**An `AGENTS.md` at the repo root**, written tool-agnostically. Keep
Claude-specific content in `CLAUDE.md`. A good pattern is a thin `CLAUDE.md`
that imports `AGENTS.md`:

```md
<!-- CLAUDE.md -->
# <Repo> Development Guidelines

See @AGENTS.md for shared development guidance.

The following is Claude Code-specific and augments `AGENTS.md`:
- ...
```

## Steps

Create `.github/workflows/lint-agents-md.yml`:

```yaml
name: Lint AGENTS.md (via artsy/duchamp)

on:
  pull_request:
    paths:
      - AGENTS.md

jobs:
  lint:
    uses: artsy/duchamp/.github/workflows/lint-agents-md.yml@main
```

That's it — open a PR and the lint runs on any `AGENTS.md` change.
