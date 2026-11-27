# Gemini experiment

An opt-in addition to the [AI PR review](../review/README.md). PRs in it get a second
review from Gemini Neon 4, run in Google's Antigravity CLI (`agy`), from the same prompt
and the same commit as Claude's. One comment shows the reviews side by side, and
Datadog tags every review by who wrote it, so the two can be compared on findings, cost
and speed. It is separate from the other [experiments](../review/experiments.md): a PR
can be in any mix of them.

Gemini runs in Google's own tool, so this compares Gemini-in-Antigravity with
Opus-in-Claude-Code: model and tool together. Google uses headless Antigravity for its
own GitHub PR reviews.

## What the PR shows

Claude's review is unchanged. Gemini's inline comments sit on the diff too, posted by
github-actions[bot] and starting with **Gemini:**. Then one comment, "AI reviews: Claude
| Gemini", with a column per reviewer: its summary, then one line per inline comment with
its `file:line`, then any it aimed at a line outside the diff. If a review failed, its column says so. A new push replaces the
comment and resolves the earlier **Gemini:** threads.

## Joining

1. **The repo passes the LiteLLM key.** Gemini goes through Artsy's LiteLLM gateway, with
   the key repos in the [LiteLLM experiment](../litellm-experiment/README.md) already
   pass. No other secret, and no change to the repo's `run-agent-review.yml`:

   ```yaml
   secrets:
     litellm-api-key: ${{ secrets.AI_REVIEW_LITELLM_API_KEY }}
   ```

2. **Enrol.** Add your GitHub login to `participants.yml`, or a repo (`owner/name`)
   under `repos` to enroll every PR in it, and open a PR. Case does not matter.
3. **Per PR.** Add the `ai-review-gemini` label to a single PR. It takes effect on the
   next push.

Without the key, or without a valid `base_url` in
`litellm-experiment/participants.yml`, enrolment does nothing and only Claude reviews.
Repos that pin duchamp to a commit SHA don't get this until they move the pin.

## How it runs

Three jobs in `.github/workflows/agent-review.yml`:

- **`review`** runs Claude, as before.
- **`gemini`** runs on its own runner at the same time. It checks out the PR without
  saving credentials, builds the same prompt and installs the same skills under
  `~/.agents/skills`. Two differences: re-reviews build on Gemini's own last review, never
  Claude's (see below); and it reads only public related repos, because it gets no
  related-repos token. It saves the PR's description and comments to a file
  (`scripts/save-pr.ts`), keeping only comments from the PR's author and people with
  write access, so bots (Claude included) and strangers are left out. Then it drops sudo,
  installs `agy` and runs it headless with `--model gemini-4-neon-high`,
  `--json-schema gemini-experiment/output-schema.json` and
  `--dangerously-skip-permissions`. It stops after 14 minutes. Every step continues on
  error, so its failures don't turn the check red, and a failed run still gets a column
  that says so. The `in-progress` label cancels it, as it does Claude's review.
- **`side-by-side`** waits for both, posts Gemini's inline comments and the comparison
  comment. It skips posting when a newer push cancelled this run's reviews.

`build-review-prompt.ts` adds a "Running in Antigravity" note to Gemini's copy of the
prompt (`formatAntigravityNote`). It covers only what Antigravity can't do the same way:
it can't post, so it returns JSON; it reads the PR from a file; it reads CLAUDE.md,
AGENTS.md and skills itself; it has no subagents, so it does the security read itself.

**Re-reviews.** The side-by-side comment is Gemini's memory: when Gemini returned a
review, the comment carries `<!-- ai-review-gemini-sha: <commit> -->` and wraps Gemini's
column in `<!-- gemini-review -->` markers. On the next push, `findPreviousGeminiReview`
reads them, and Gemini re-reviews the changes since its commit with its own column as its
earlier notes, on the same rules as Claude's re-reviews. It never reads Claude's summary,
or the replies to Claude's inline comments. If Gemini didn't return a review last time,
or only lockfiles changed and the comment lost its column, the next review is full.

The prompt can be longer than one command-line argument allows, so `agy -p` gets a short
instruction pointing at the prompt file.

## What the gateway needs

In LiteLLM's admin UI (artsy-litellm):

- Gemini Neon 4 under the public name `gemini-4-neon`, with the Google API key behind it,
  allowed on the key duchamp's callers use.
  It has to be Google's own ID: `agy` takes the effort in the model name
  (`gemini-4-neon-high`) and sends `gemini-4-neon`, with the effort in the request.
- The public host forwarding `/v1beta/models` (artsy/artsy-litellm#16) and Cloudflare
  letting it skip the WAF (artsy/infrastructure#1604).
- The Gemini-native API (`/v1beta/models/...:generateContent`), which `agy` speaks.
  `GOOGLE_GEMINI_BASE_URL` is the gateway's `base_url` with no version path, because the
  SDK adds `/v1beta` itself.

`agy` can't send custom headers yet
([google-antigravity/antigravity-cli#514](https://github.com/google-antigravity/antigravity-cli/issues/514)).
So LiteLLM can't split Gemini spend by repo or PR, and once the gateway's edge check
(`edge_header`) turns on, Gemini calls will be refused. Until #514 lands, the edge check
needs an exception for Gemini or the experiment pauses.

## Measuring it

- **Findings.** When the PR merges, the [outcome experiment](../outcome-experiment/README.md)
  judges every inline comment and tags it `reviewer:claude` or `reviewer:gemini`: addressed, 👍/👎 and replies. The repo must list `closed` in its
  trigger.
- **Cost and speed.** `scripts/gemini-usage.ts` sends the Gemini review's numbers under
  the same `ai_pr_review.*` names as Claude's, tagged `reviewer:gemini` and
  `model:gemini-4-neon`; Claude's carry `reviewer:claude`. The dashboard's "Reviewers"
  section compares them. Antigravity reports tokens but no cost, so `gemini-usage.ts`
  estimates it from tokens at Gemini Neon 4's list price ($3 input, $15 output, $0.15
  cached input per million) and tags it `cost:estimated`. Check it against LiteLLM's
  Usage page.
- `inline_comments` counts the comments Gemini returned, some of which may land off the
  diff; Claude's counts the ones it posted.

## Risks

- **Prompt injection from the PR.** Antigravity runs with every permission on a runner
  that holds the LiteLLM key. Anyone can comment on a public PR, so only comments from
  the PR's author and people with write access reach it; outside contributors' PRs are
  skipped, and forks don't get the key anyway. Before `agy` is even installed, the job
  removes passwordless sudo and locks the Docker socket, so it can't read tokens from the
  runner's memory; if sudo still works, Gemini doesn't run. The job holds no write token and no credentials on
  disk, and the key's budget and rate limits on the gateway cap the damage.
- **Headless stalls**
  ([google-antigravity/antigravity-cli#548](https://github.com/google-antigravity/antigravity-cli/issues/548)).
  Skipping permission prompts avoids them; the step timeout is the backstop.
- **Private code.** `agy` can reach the network, so the job mints no related-repos
  token and private related repos never land on its runner.
- **Unpinned CLI.** The installer takes no version, so every run gets the latest `agy`.
  The job logs `agy --version`. A breaking release fails Gemini's column, not Claude's
  review.
