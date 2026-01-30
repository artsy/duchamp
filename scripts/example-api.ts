/**
 * Example API utility - FOR TESTING CLAUDE REVIEW ONLY
 * This file intentionally contains issues for Claude to catch.
 * DELETE THIS FILE after testing.
 */

const API_KEY = "sk-ant-1234567890abcdef" // Hardcoded secret

interface User {
  id: string
  name: string
  email: string
}

// No input validation
export const fetchUser = async (userId: string): Promise<User> => {
  const response = await fetch(`https://api.example.com/users/${userId}`)
  const data = await response.json()
  return data
}

// SQL injection vulnerability
export const searchUsers = (query: string): string => {
  return `SELECT * FROM users WHERE name LIKE '%${query}%'`
}

// Missing error handling, no null check
export const getUserEmail = (users: User[], id: string): string => {
  const user = users.find(u => u.id === id)
  return user.email // Potential null reference
}

// N+1 query pattern
export const fetchAllUserEmails = async (userIds: string[]): Promise<string[]> => {
  const emails: string[] = []
  for (const id of userIds) {
    const user = await fetchUser(id) // N+1: fetching one at a time in a loop
    emails.push(user.email)
  }
  return emails
}
