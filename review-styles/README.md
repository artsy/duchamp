# Personal review styles

The [Claude AI PR review](../docs/actions.md#run-claude-reviewyml) uses one default
prompt for everyone. If you want the review of *your* PRs to have a different tone
or emphasis, regardless of which repo the PR is in, add a file here.

## Setup

Create `review-styles/<your-github-login>.md` (lowercase) in this repo, e.g.
`review-styles/amonkhouse.md`. It's picked up automatically the next time a PR you
author is reviewed, in any repo that uses this workflow. No other setup needed.

## Format

Optional YAML frontmatter, then your style content in plain prose or bullets:

```markdown
---
mode: augment
---
Be blunt and terse. Skip the summary on small PRs.
I care most about data-pipeline correctness and idempotency; flag anything
that could double-write or silently drop rows. UK English.
```

If you omit the frontmatter, `mode` defaults to `augment`.

## Modes

- **`augment`** (default) - keeps the full default prompt (guardrails, review
  format, priority emojis) and appends your content as a "Reviewer Style
  Preferences" section, with a note that it wins on tone conflicts. Safest option;
  right for most people who just want a different voice or emphasis.
- **`replace_style`** - keeps the default guardrails and review format, but swaps
  out the "How to write" tone guidance for your content. Use this if you have
  strong, complete opinions on tone and don't want the default tone advice
  competing with yours.
- **`override`** - your content becomes the *entire* prompt. Nothing else is kept:
  no false-positive guardrails, no required review format, no posting
  instructions, unless you write them yourself. Only use this if you're
  deliberately writing a full replacement prompt (mirrors the repo-level `prompt:`
  field in `.claude-review.yml`, but scoped to you).

## Precedence

1. A repo's `.claude-review.yml` `prompt:` field (a full override for that repo)
   always wins over your personal style - it's a deliberate repo-wide decision.
2. Otherwise, your personal style is applied per its `mode`.
3. A repo's `focus_areas`, `context`, and `ignore_paths` still apply in `augment`
   and `replace_style` modes - scope stays with the repo, tone stays with you.
   They do not apply under `override`, since there is no base prompt left to
   append them to.

See `amonkhouse.md` in this directory for a worked example.
