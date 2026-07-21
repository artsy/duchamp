import {
  loadDeploySlackConfig,
  parseDeploySlackConfig,
  resolveSubscription,
} from "./resolve-subscription"

describe("parseDeploySlackConfig", () => {
  it("parses repository subscriptions", () => {
    const config = parseDeploySlackConfig(`
subscriptions:
  artsy/volt:
    slack-channel: "#product-amber"
    project-name: Volt
`)

    expect(config.subscriptions["artsy/volt"]).toEqual({
      "slack-channel": "#product-amber",
      "project-name": "Volt",
    })
  })

  it("throws when subscriptions are missing", () => {
    expect(() => parseDeploySlackConfig("channels: {}")).toThrow(
      "Invalid deploy Slack config"
    )
  })
})

describe("resolveSubscription", () => {
  const config = parseDeploySlackConfig(`
subscriptions:
  artsy/volt:
    slack-channel: "#product-amber"
    project-name: Volt
`)

  it("returns the subscription for a configured repository", () => {
    expect(resolveSubscription(config, "artsy/volt")).toEqual({
      "slack-channel": "#product-amber",
      "project-name": "Volt",
    })
  })

  it("returns undefined for unconfigured repositories", () => {
    expect(resolveSubscription(config, "artsy/eigen")).toBeUndefined()
  })
})

describe("loadDeploySlackConfig", () => {
  it("loads the shared config file from the repository", () => {
    const config = loadDeploySlackConfig("config/notify-deploy-slack.yml")

    expect(config.subscriptions["artsy/volt"]).toEqual({
      "slack-channel": "#product-amber",
      "project-name": "Volt",
    })
  })
})
