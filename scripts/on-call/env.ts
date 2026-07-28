export const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} env var is not set.`)
  }
  return value
}

export const readIntEnv = (
  name: string,
  defaultValue: number,
  range: { min: number; max: number }
): number => {
  const raw = process.env[name]
  const value = raw ? Number.parseInt(raw, 10) : defaultValue

  if (Number.isNaN(value) || value < range.min || value > range.max) {
    throw new Error(
      `Invalid ${name}: "${raw}". Must be an integer between ${range.min} and ${range.max}.`
    )
  }

  return value
}

export const requireIntEnv = (
  name: string,
  range: { min: number; max: number }
): number => {
  const raw = requireEnv(name)
  const value = Number.parseInt(raw, 10)

  if (Number.isNaN(value) || value < range.min || value > range.max) {
    throw new Error(
      `Invalid ${name}: "${raw}". Must be an integer between ${range.min} and ${range.max}.`
    )
  }

  return value
}
