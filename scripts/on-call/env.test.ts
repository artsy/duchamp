import { readIntEnv, requireEnv, requireIntEnv } from "./env"

describe("requireEnv", () => {
  const originalEnv = process.env
  afterEach(() => {
    process.env = originalEnv
  })

  it("returns the value when set", () => {
    process.env = { ...originalEnv, FOO: "bar" }
    expect(requireEnv("FOO")).toBe("bar")
  })

  it("throws when unset", () => {
    process.env = { ...originalEnv, FOO: undefined }
    expect(() => requireEnv("FOO")).toThrow("FOO env var is not set.")
  })
})

describe("readIntEnv", () => {
  const originalEnv = process.env
  afterEach(() => {
    process.env = originalEnv
  })

  it("parses the env var when set", () => {
    process.env = { ...originalEnv, FOO: "5" }
    expect(readIntEnv("FOO", 1, { min: 0, max: 10 })).toBe(5)
  })

  it("falls back to the default when unset", () => {
    process.env = { ...originalEnv, FOO: undefined }
    expect(readIntEnv("FOO", 7, { min: 0, max: 10 })).toBe(7)
  })

  it("throws when out of range", () => {
    process.env = { ...originalEnv, FOO: "11" }
    expect(() => readIntEnv("FOO", 1, { min: 0, max: 10 })).toThrow(
      'Invalid FOO: "11". Must be an integer between 0 and 10.'
    )
  })

  it("throws when not an integer", () => {
    process.env = { ...originalEnv, FOO: "abc" }
    expect(() => readIntEnv("FOO", 1, { min: 0, max: 10 })).toThrow(
      'Invalid FOO: "abc". Must be an integer between 0 and 10.'
    )
  })
})

describe("requireIntEnv", () => {
  const originalEnv = process.env
  afterEach(() => {
    process.env = originalEnv
  })

  it("parses the env var when set", () => {
    process.env = { ...originalEnv, FOO: "5" }
    expect(requireIntEnv("FOO", { min: 0, max: 10 })).toBe(5)
  })

  it("throws when unset", () => {
    process.env = { ...originalEnv, FOO: undefined }
    expect(() => requireIntEnv("FOO", { min: 0, max: 10 })).toThrow(
      "FOO env var is not set."
    )
  })

  it("throws when out of range", () => {
    process.env = { ...originalEnv, FOO: "11" }
    expect(() => requireIntEnv("FOO", { min: 0, max: 10 })).toThrow(
      'Invalid FOO: "11". Must be an integer between 0 and 10.'
    )
  })
})
