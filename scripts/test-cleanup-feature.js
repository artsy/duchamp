/**
 * Test file to verify AI review cleanup works correctly.
 * This file intentionally contains issues to trigger inline review comments.
 * DELETE THIS FILE AFTER TESTING.
 */

// FIXED: Now using environment variable instead of hardcoded key
const API_KEY = process.env.API_KEY

// FIXED: Added basic error handling
async function fetchUserData(userId) {
  try {
    const response = await fetch(`https://api.example.com/users/${userId}`)
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    console.error("Failed to fetch user:", error)
    return null
  }
}

// STILL BROKEN: SQL injection vulnerability (left intentionally)
function findUser(username) {
  const query = `SELECT * FROM users WHERE name = '${username}'`
  return database.execute(query)
}

// FIXED: Added null check
function processItems(items) {
  if (!items) return []
  return items.map(item => item?.name?.toUpperCase() ?? "UNKNOWN")
}

// NEW ISSUE: Infinite loop if condition never met
async function waitForCondition(checkFn) {
  while (!checkFn()) {
    await delay(100)
  }
  return true
}

// NEW ISSUE: Memory leak - growing array never cleared
const eventLog = []
function logEvent(event) {
  eventLog.push({ ...event, timestamp: Date.now() })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { fetchUserData, findUser, processItems, waitForCondition, logEvent }
