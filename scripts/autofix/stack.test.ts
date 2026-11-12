import * as fs from "fs"
import * as path from "path"
import { inAppFrames, parseStack, repoPath } from "./stack"

const stack = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "__fixtures__", "datadog-span.json"),
    "utf8"
  )
).data[0].attributes.custom.error.stack

describe("parseStack", () => {
  it("keeps file, line and method, and drops the message on the first line", () => {
    const frames = parseStack(stack)
    expect(frames).toHaveLength(5)
    expect(frames[0]).toEqual({
      file: "/usr/local/bundle/gems/grape-2.4.0/lib/grape/endpoint.rb",
      line: 58,
      method: "UnboundMethod#bind_call",
    })
    expect(JSON.stringify(frames)).not.toContain("undefined method")
  })

  it("reads the older backtick quoting", () => {
    expect(parseStack("/app/lib/x.rb:3:in `foo'")).toEqual([
      { file: "/app/lib/x.rb", line: 3, method: "foo" },
    ])
  })

  it("skips lines that are not frames", () => {
    expect(parseStack("NoMethodError\n  something else")).toEqual([])
  })
})

describe("repoPath", () => {
  it.each([
    ["/app/app/models/artwork.rb", "app/models/artwork.rb"],
    ["/app/lib/tasks/x.rake", "lib/tasks/x.rake"],
    ["app/models/artwork.rb", "app/models/artwork.rb"],
  ])("maps %s to %s", (file, expected) => {
    expect(repoPath(file)).toBe(expected)
  })

  it.each([
    "/usr/local/bundle/gems/grape-2.4.0/lib/grape/endpoint.rb",
    "/usr/local/lib/ruby/3.4.0/monitor.rb",
    "/app/vendor/bundle/ruby/3.4.0/gems/x/lib/x.rb",
    "/app/../etc/passwd",
    "<internal:kernel>",
  ])("treats %s as not first-party", file => {
    expect(repoPath(file)).toBeNull()
  })
})

it("lists in-app frames in stack order", () => {
  expect(inAppFrames(parseStack(stack)).map(frame => frame.path)).toEqual([
    "app/presenters/collector_profile_presenter.rb",
    "app/api/v1/me_endpoint.rb",
  ])
})
