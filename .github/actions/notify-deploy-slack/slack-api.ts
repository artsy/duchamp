interface SlackPostMessageResponse {
  ok: boolean
  ts?: string
  error?: string
}

export async function postSlackMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<string> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false,
    }),
  })

  const data = (await response.json()) as SlackPostMessageResponse
  if (!data.ok || !data.ts) {
    throw new Error(`Slack API error: ${data.error ?? "unknown error"}`)
  }

  return data.ts
}
