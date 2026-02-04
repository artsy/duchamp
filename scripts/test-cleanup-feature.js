/**
 * Test file to verify AI review cleanup works correctly.
 * This file intentionally contains issues to trigger inline review comments.
 * DELETE THIS FILE AFTER TESTING.
 */

// Issue 1: Hardcoded API key (security issue - should trigger inline comment)
const API_KEY = "sk-1234567890abcdef"

// Issue 2: No error handling on async operation
async function fetchUserData(userId) {
  const response = await fetch(`https://api.example.com/users/${userId}`)
  const data = await response.json()
  return data
}

// Issue 3: SQL injection vulnerability
function findUser(username) {
  const query = `SELECT * FROM users WHERE name = '${username}'`
  return database.execute(query)
}

// Issue 4: Potential null reference
function processItems(items) {
  return items.map(item => item.name.toUpperCase())
}

// Issue 5: Race condition / no mutex
let counter = 0
async function incrementCounter() {
  const current = counter
  await delay(100)
  counter = current + 1
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { fetchUserData, findUser, processItems, incrementCounter }
