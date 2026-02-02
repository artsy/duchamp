/**
 * Test file for Claude review - contains intentional issues
 * DELETE THIS FILE after testing
 */

// Hardcoded API key (security issue)
const API_SECRET = "sk-live-abc123xyz"

// SQL injection vulnerability
export const findUser = (name: string): string => {
  return `SELECT * FROM users WHERE name = '${name}'`
}

// Missing null check
export const getEmail = (user: { email?: string }): string => {
  return user.email.toLowerCase()
}

// N+1 query pattern
export const fetchAllUsers = async (ids: string[]): Promise<void> => {
  for (const id of ids) {
    await fetch(`/api/users/${id}`)
  }
}
