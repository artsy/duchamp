const fs = require("fs")

/**
 * Process NPM audit results and post them as a GitHub comment
 *
 * @param {Object} params - Parameters
 * @param {Object} params.github - GitHub API client from actions/github-script
 * @param {Object} params.context - GitHub context from actions/github-script
 * @param {Object} params.core - GitHub Actions core utilities from actions/github-script
 * @param {string} params.threshold - Severity threshold (low, moderate, high, critical)
 * @param {string} params.auditFilePath - Path to the audit JSON file
 */
async function commentVulnerabilities({
  github,
  context,
  core,
  threshold,
  auditFilePath = "audit.json",
}) {
  const thresholdLevel = threshold.toLowerCase()
  const levels = ["low", "moderate", "high", "critical"]
  const thresholdIndex = levels.indexOf(thresholdLevel)

  const lines = fs.readFileSync(auditFilePath, "utf8").trim().split("\n")
  const advisories = lines
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(obj => obj && obj.children && obj.children.Severity)
    .map(obj => ({
      module: obj.value,
      severity: obj.children.Severity.toLowerCase(),
      versions: obj.children["Vulnerable Versions"],
      id: obj.children.ID,
      title: obj.children.Issue,
      url: obj.children.URL || "",
    }))
    .filter(adv => levels.indexOf(adv.severity) >= thresholdIndex)

  if (advisories.length === 0) {
    console.log(`No ${thresholdLevel} or higher advisories found in JSON.`)
    return
  }

  let body = "## 🔒 NPM Audit Results\n"
  body += `Vulnerabilities detected at severity **${thresholdLevel}** or higher:\n\n`
  for (const adv of advisories) {
    body += `- **${adv.module}** ${adv.versions}\n`
    body += `  - Severity: ${adv.severity}\n`
    body += `  - ID: ${adv.id}\n`
    body += `  - Title: ${adv.title}\n`
    body += `  - URL: ${adv.url}\n\n`
  }

  // Check if there's already a comment with NPM Audit Results
  const comments = await github.rest.issues.listComments({
    issue_number: context.issue.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  })

  const existingComment = comments.data.find(
    comment => comment.body && comment.body.includes("## 🔒 NPM Audit Results")
  )

  if (existingComment) {
    // Update the existing comment
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existingComment.id,
      body,
    })
    console.log(`Updated existing comment #${existingComment.id}`)
  } else {
    // Create a new comment
    await github.rest.issues.createComment({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body,
    })
    console.log("Created new comment")
  }

  core.exportVariable("VULNS_FOUND", "true")
}

module.exports = { commentVulnerabilities }
