// .github/scripts/npm-audit-report.js
const fs = require("fs");

async function run() {
  const threshold = process.env.SEVERITY_THRESHOLD?.toLowerCase() || "critical";
  const levels = ["low", "moderate", "high", "critical"];
  const thresholdIndex = levels.indexOf(threshold);
  if (thresholdIndex === -1) {
    throw new Error(`Invalid severity threshold: ${threshold}`);
  }

  const lines = fs.readFileSync("audit.json", "utf8").trim().split("\n");
  const advisories = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((obj) => obj && obj.children && obj.children.Severity)
    .map((obj) => ({
      module: obj.value,
      severity: obj.children.Severity.toLowerCase(),
      versions: obj.children["Vulnerable Versions"],
      id: obj.children.ID,
      title: obj.children.Issue,
      url: obj.children.URL || "",
    }))
    .filter((adv) => levels.indexOf(adv.severity) >= thresholdIndex);

  if (advisories.length === 0) {
    console.log(`No ${threshold} or higher advisories found in JSON.`);
    return;
  }

  let body = "## 🔒 NPM Audit Results\n";
  body += `Vulnerabilities detected at severity **${threshold}** or higher:\n\n`;

  for (const adv of advisories) {
    body += `- **${adv.module}** ${adv.versions}\n`;
    body += `  - Severity: ${adv.severity}\n`;
    body += `  - ID: ${adv.id}\n`;
    body += `  - Title: ${adv.title}\n`;
    body += `  - URL: ${adv.url}\n\n`;
  }

  console.log("::set-output name=body::" + body.replace(/\n/g, "%0A"));
  process.exitCode = 1; 
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
