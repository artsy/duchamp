import { fetchVariant, NO_VARIANT, parseVariant, prSessionId } from "./unleash"

const FLAG = "ai-review-replies"

const toggle = (variant: string, enabled = true) => ({
  toggles: [
    {
      name: "other-flag",
      enabled: true,
      variant: { name: "x", enabled: true },
    },
    { name: FLAG, enabled, variant: { name: variant, enabled: true } },
  ],
})

describe("prSessionId", () => {
  it("joins the repo and PR number", () => {
    expect(prSessionId("artsy/eigen", "123")).toBe("artsy/eigen#123")
  })

  it("is empty when either is missing", () => {
    expect(prSessionId(undefined, "123")).toBe("")
    expect(prSessionId("artsy/eigen", "")).toBe("")
  })
})

describe("parseVariant", () => {
  it("returns the flag's variant, lowercased", () => {
    expect(parseVariant(toggle("Treatment"), FLAG)).toBe("treatment")
  })

  it("is none when the flag is missing, off or has no variants", () => {
    expect(parseVariant({ toggles: [] }, FLAG)).toBe(NO_VARIANT)
    expect(parseVariant(toggle("treatment", false), FLAG)).toBe(NO_VARIANT)
    expect(
      parseVariant(
        {
          toggles: [
            {
              name: FLAG,
              enabled: true,
              variant: { name: "disabled", enabled: false },
            },
          ],
        },
        FLAG
      )
    ).toBe(NO_VARIANT)
  })

  it("is none for a malformed body or an unsafe name", () => {
    expect(parseVariant(null, FLAG)).toBe(NO_VARIANT)
    expect(parseVariant({ toggles: "nope" }, FLAG)).toBe(NO_VARIANT)
    expect(parseVariant(toggle("a\nreplies=true"), FLAG)).toBe(NO_VARIANT)
  })
})

describe("fetchVariant", () => {
  const request = {
    url: "https://unleash.example/proxy",
    key: "frontend-key",
    flag: FLAG,
    sessionId: "artsy/eigen#123",
  }

  it("asks the proxy with the PR as sessionId and the key as Authorization", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => toggle("control"),
    })

    await expect(fetchVariant(request, fetchImpl)).resolves.toBe("control")

    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe(
      "https://unleash.example/proxy?sessionId=artsy%2Feigen%23123&appName=duchamp-ai-review"
    )
    expect(init.headers.Authorization).toBe("frontend-key")
  })

  it("is none without a URL, key or session, and doesn't call out", async () => {
    const fetchImpl = jest.fn()

    await expect(
      fetchVariant({ ...request, url: "" }, fetchImpl)
    ).resolves.toBe(NO_VARIANT)
    await expect(
      fetchVariant({ ...request, key: undefined }, fetchImpl)
    ).resolves.toBe(NO_VARIANT)
    await expect(
      fetchVariant({ ...request, sessionId: "" }, fetchImpl)
    ).resolves.toBe(NO_VARIANT)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("is none on an error status or a failed request", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      fetchVariant(
        request,
        jest.fn().mockResolvedValue({ ok: false, status: 401 })
      )
    ).resolves.toBe(NO_VARIANT)
    await expect(
      fetchVariant(request, jest.fn().mockRejectedValue(new Error("timeout")))
    ).resolves.toBe(NO_VARIANT)
  })
})
