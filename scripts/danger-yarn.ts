import yarn from "danger-plugin-yarn"

/**
 * Danger.js plugin for Yarn dependency management checks
 *
 * This function runs the danger-plugin-yarn plugin which provides:
 * - Warnings when lockfiles change without package.json changes
 * - Notifications about added/removed/updated dependencies
 * - Checks for security vulnerabilities in dependencies
 * - Warnings about large dependency additions
 *
 * @see https://github.com/orta/danger-plugin-yarn
 */
export default async function main() {
  await yarn()
}
