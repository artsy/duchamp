# Deploy Slack Notifications

AI-generated "New changes just went live! 🥳" digests, posted to Slack when a Deploy PR is merged.

Slack channels subscribe to Artsy repos in a central config. When a Deploy PR merges in a subscribed repo, a GitHub Action collects the shipped PRs, asks Claude to write a plain-language digest, and posts it to the subscribed channels:

- **Top-level message**: link to the deploy PR, plus any genuinely new user-facing features. If there are none: "No new features this time — check the thread for fixes and improvements 🧵".
- **Thread reply**: everything else (bug fixes, chores, dependency bumps, test/tooling work), split into **Fixes** and **Improvements & Maintenance**.

Each item gets a short plain-language title, a one-sentence description a non-engineer can understand, and links to the PR (plus its Jira/Notion ticket if the PR body mentions one).

## How it works

1. A repo (e.g. `artsy/volt`) has a small workflow that calls duchamp's reusable [`deploy-notification.yml`](../.github/workflows/deploy-notification.yml) whenever a PR is closed.
2. The reusable workflow only proceeds when the PR was **merged** and its **base branch is the release branch** (default: `release`) — that's what identifies a Deploy PR.
3. [`scripts/deploy-notification.ts`](../scripts/deploy-notification.ts) then:
   - looks up the repo in [`deploy-notifications.yml`](../deploy-notifications.yml) (exits quietly if no channel is subscribed),
   - lists the commits contained in the deploy PR and extracts the shipped PR numbers (squash merges and merge commits),
   - fetches each shipped PR's title and description from the GitHub API,
   - sends everything to the Claude API, which returns the two Slack messages as JSON,
   - posts the top-level message and the thread reply to every subscribed channel via `chat.postMessage`.

## Subscribing a channel to a repo

Open a PR against [`deploy-notifications.yml`](../deploy-notifications.yml) in this repo:

```yaml
subscriptions:
  artsy/<repo>:
    channels:
      - "#your-channel"
    # Optional: domain hints that make the digest better
    context: |
      <Glossary, product-area names, grouping hints for Claude.>
```

Then invite the Slack bot to the channel: `/invite @<bot-name>`.

If the repo isn't emitting notifications yet, also do the one-time repo setup below.

## One-time setup per repo

1. Copy [`templates/run-deploy-notification.yml`](../templates/run-deploy-notification.yml) to `.github/workflows/deploy-notification.yml` in the repo.
2. If deploy PRs merge into a branch other than `release`, set the `release-branch` input.
3. Make sure the repo has access to the `ANTHROPIC_API_KEY` and `SLACK_BOT_TOKEN` secrets (see below).

## One-time org setup (what else is needed)

These things exist outside this repo and must be set up once:

1. **Slack app / bot**
   - Create a Slack app in the Artsy workspace (or reuse an existing bot).
   - Add the `chat:write` bot scope and install the app to the workspace.
   - Invite the bot to every subscribed channel.
2. **Secrets** (GitHub org-level secrets recommended, so every repo can use them):
   - `ANTHROPIC_API_KEY` — Claude API key (already used by the AI PR review workflow).
   - `SLACK_BOT_TOKEN` — the Slack app's bot token (`xoxb-...`).

## Configuration reference

`deploy-notifications.yml` (in duchamp):

| Key | Description |
| --- | --- |
| `subscriptions.<owner/repo>.channels` | Slack channels to notify (bot must be a member). |
| `subscriptions.<owner/repo>.context` | Optional free-text hints for Claude (glossary, product areas, grouping rules). |

Reusable workflow inputs (set in the calling repo's workflow):

| Input | Default | Description |
| --- | --- | --- |
| `release-branch` | `release` | Base branch that identifies a Deploy PR. |
| `model` | `claude-opus-4-8` | Claude model used to write the digest. |

## Testing locally

Preview the Claude prompt for a real deploy PR without any API keys (uses your `gh` CLI auth; nothing is sent to Claude or Slack):

```bash
npx ts-node scripts/test-deploy-notification.ts artsy/volt 11796
```

Status output goes to stderr, the prompt to stdout, so you can pipe it — e.g. `| pbcopy` and paste into Claude to preview the digest.

## Limitations

- Shipped PRs are detected from commit messages in the deploy PR (squash merges `(#123)` and merge commits `Merge pull request #123`). Direct commits without a PR reference are not summarized.
- Digests cover at most 50 shipped PRs per deploy.
- Channels are looked up against duchamp's `main` branch at run time, so subscription changes take effect on the next deploy without touching the consumer repo.
