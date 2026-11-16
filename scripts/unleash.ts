import * as fs from "fs"

/**
 * Random A/B assignment for review experiments, from Artsy's Unleash.
 *
 * Asks the Unleash proxy which variant of a flag this PR gets. The proxy works the
 * variant out on the server, so this script needs no SDK and no hashing of its own. The
 * stickiness is `sessionId`, set to `<repo>#<pr>`, so every review of a PR lands in the
 * same arm.
 *
 * The proxy key is a frontend key, the kind Artsy's web apps send to browsers, so it is
 * read from an org variable rather than a secret. That lets the shared workflow use it
 * without every calling repo passing a secret, and fork PRs get it too.
 *
 * Anything going wrong, such as no URL, no key, a timeout or the flag being off, gives
 * `none`: the PR is left out of the A/B test and the review runs as it would without it.
 */

/** The Unleash flag that splits PRs for the replies experiment. */
export const REPLIES_FLAG = "ai-review-replies"

/** The arm for a PR that Unleash didn't assign. */
export const NO_VARIANT = "none"

const TIMEOUT_MS = 5000

/** Variant names reach a GITHUB_OUTPUT line and a Datadog tag, so keep them plain. */
const VARIANT_PATTERN = /^[a-z0-9_-]{1,40}$/

export interface VariantRequest {
  url: string | undefined
  key: string | undefined
  flag: string
  sessionId: string
}

/** The PR as Unleash's sessionId: `artsy/eigen#123`. Empty when either is missing. */
export const prSessionId = (
  repo: string | undefined,
  prNumber: string | undefined
): string => (repo && prNumber ? `${repo}#${prNumber}` : "")

/**
 * The variant name in a proxy response, or `none`. The proxy lists only flags that are
 * on, so a missing flag means off. A disabled variant means the flag has no variants.
 */
export const parseVariant = (body: unknown, flag: string): string => {
  const toggles = (body as { toggles?: unknown })?.toggles
  if (!Array.isArray(toggles)) {
    return NO_VARIANT
  }

  const toggle = toggles.find(
    entry => (entry as { name?: unknown })?.name === flag
  ) as
    | { enabled?: boolean; variant?: { name?: unknown; enabled?: boolean } }
    | undefined
  const name = toggle?.variant?.name
  if (
    !toggle?.enabled ||
    !toggle.variant?.enabled ||
    typeof name !== "string"
  ) {
    return NO_VARIANT
  }

  const variant = name.toLowerCase()
  return VARIANT_PATTERN.test(variant) ? variant : NO_VARIANT
}

/** Asks the proxy for this PR's variant of the flag. Never throws. */
export const fetchVariant = async (
  request: VariantRequest,
  fetchImpl: typeof fetch = fetch
): Promise<string> => {
  if (!request.url || !request.key || !request.sessionId) {
    return NO_VARIANT
  }

  try {
    const url = new URL(request.url)
    url.searchParams.set("sessionId", request.sessionId)
    url.searchParams.set("appName", "duchamp-ai-review")
    const response = await fetchImpl(url, {
      headers: { Authorization: request.key, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error(`Warning: Unleash answered ${response.status}`)
      return NO_VARIANT
    }
    return parseVariant(await response.json(), request.flag)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: Failed to ask Unleash for a variant: ${message}`)
    return NO_VARIANT
  }
}

const main = async (): Promise<void> => {
  const replies = await fetchVariant({
    url: process.env.UNLEASH_PROXY_URL,
    key: process.env.UNLEASH_PROXY_KEY,
    flag: REPLIES_FLAG,
    sessionId: prSessionId(
      process.env.GITHUB_REPOSITORY,
      process.env.PR_NUMBER
    ),
  })
  console.log(`Replies variant: ${replies}`)

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `replies_variant=${replies}\n`)
  }
}

if (require.main === module) {
  void main()
}
