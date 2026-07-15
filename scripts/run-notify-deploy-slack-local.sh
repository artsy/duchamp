#!/usr/bin/env bash
set -euo pipefail

# Local test runner for notify-deploy-slack.
#
# Usage:
#   ./scripts/run-notify-deploy-slack-local.sh [--dry-run] [deploy_pr_number] [slack_channel]
#
# Dry-run (write preview markdown, no Slack token needed):
#   ./scripts/run-notify-deploy-slack-local.sh --dry-run 11777
#
# Post to Slack:
#   export SLACK_BOT_TOKEN=xoxb-...
#   ./scripts/run-notify-deploy-slack-local.sh 11777 '#hack16-deploy-slack-notification'

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

DEPLOY_PR_NUMBER="${1:-11777}"
SLACK_CHANNEL="${2:-#hack16-deploy-slack-notification}"
REPO="${REPO:-artsy/volt}"
CONFIG_PATH="${CONFIG_PATH:-config/notify-deploy-slack.yml}"
EVENT_FILE="${EVENT_FILE:-/tmp/volt-deploy-event.json}"

if [[ "${DRY_RUN}" != "true" && -z "${SLACK_BOT_TOKEN:-}" ]]; then
  echo "Error: SLACK_BOT_TOKEN is not set." >&2
  echo "Use --dry-run to preview without Slack, or:" >&2
  echo "  export SLACK_BOT_TOKEN=xoxb-..." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required." >&2
  exit 1
fi

DEPLOY_URL="https://github.com/${REPO}/pull/${DEPLOY_PR_NUMBER}"

cat > "${EVENT_FILE}" <<EOF
{
  "pull_request": {
    "number": ${DEPLOY_PR_NUMBER},
    "title": "Deploy",
    "merged": true,
    "html_url": "${DEPLOY_URL}"
  }
}
EOF

yarn build:action:notify-deploy-slack >/dev/null

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry-run preview for ${DEPLOY_URL} (writes tmp/deploy-slack-preview-*.md)"
else
  echo "Running notify-deploy-slack for ${DEPLOY_URL} → ${SLACK_CHANNEL}"
fi

env \
  GITHUB_REPOSITORY="${REPO}" \
  GITHUB_EVENT_PATH="${EVENT_FILE}" \
  "INPUT_GITHUB-TOKEN=$(gh auth token)" \
  "INPUT_SLACK-BOT-TOKEN=${SLACK_BOT_TOKEN:-dry-run}" \
  "INPUT_SLACK-CHANNEL=${SLACK_CHANNEL}" \
  "INPUT_CONFIG-PATH=${CONFIG_PATH}" \
  "INPUT_DRY-RUN=${DRY_RUN}" \
  node .github/actions/notify-deploy-slack/dist/index.js

echo "Done."
