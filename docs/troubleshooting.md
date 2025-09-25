# Troubleshooting Guide

This guide helps resolve common issues when using duchamp actions in your repositories.

## Quick Diagnosis

### Action Failed Immediately

**Symptoms**: Workflow fails within the first few seconds without running Danger.js

**Most Likely Causes**:
1. Missing `DANGER_GITHUB_API_TOKEN` secret
2. Incorrect workflow syntax
3. Referencing non-existent duchamp action

**Quick Fix**:
```bash
# Check your workflow file syntax
cat .github/workflows/your-workflow.yml

# Verify secret exists in repository settings
# Go to: Settings > Secrets and variables > Actions
```

### Danger.js Errors

**Symptoms**: Action runs but Danger.js reports errors or fails to comment

**Most Likely Causes**:
1. Token lacks required permissions
2. Custom dangerfile has syntax errors
3. Repository configuration issues

**Quick Fix**:
```bash
# Test Danger locally
npx danger pr --dry-run
```

## Common Issues

### 1. Missing DANGER_GITHUB_API_TOKEN

**Error Message**:
```
Error: Input required and not supplied: danger-token
```

**Solution**:
1. Go to your repository's Settings
2. Navigate to "Secrets and variables" > "Actions"
3. Add new repository secret:
   - Name: `DANGER_GITHUB_API_TOKEN`
   - Value: Contact [@amonkhouse](https://github.com/amonkhouse) or [@mc-jones](https://github.com/mc-jones)

### 2. Permission Denied Errors

**Error Message**:
```
Error: Resource not accessible by integration
```

**Causes**:
- Token doesn't have required permissions
- Repository has restrictive settings

**Solution**:
1. Verify token has these permissions:
   - Read access to repository
   - Write access to pull requests
   - Write access to issues (for labeling)

2. Check repository settings:
   - Actions are enabled
   - Token permissions match requirements

### 3. TypeScript Compilation Errors

**Error Message**:
```
TS2307: Cannot find module 'danger'
```

**Solution**:
```bash
# Install dependencies in the right location
yarn install

# If using install-from-caller: true
cd your-repo
yarn add -D danger @types/node
```

### 4. Custom Dangerfile Not Found

**Error Message**:
```
Could not find dangerfile at path: custom-dangerfile.ts
```

**Solution**:
1. Verify the file exists at the specified path
2. Check the dangerfile input in your workflow:
   ```yaml
   with:
     dangerfile: "path/to/your/dangerfile.ts"  # Must be exact path
   ```

### 5. Node Version Conflicts

**Error Message**:
```
The engine "node" is incompatible with this module
```

**Solution**:
```yaml
# Specify compatible Node version
uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
with:
  node-version: "18"  # Use your project's Node version
```

### 6. Yarn Version Issues

**Error Messages**:
```
error Package manager is not supported
error An unexpected error occurred: "ENOENT: no such file or directory, open 'package.json'"
```

**Solution**:
The setup-and-install action should handle this automatically, but if issues persist:

```yaml
# For Yarn 1 (Classic)
- run: yarn install --frozen-lockfile

# For Yarn 2+ (Berry)  
- run: yarn install --immutable
```

### 7. Auto-Release Configuration Missing

**Error Message**:
```
Skipping, because this repo does not have an .autorc file
```

**Solution**:
Create `.autorc` file in repository root:
```json
{
  "plugins": [
    "npm",
    "released"
  ],
  "labels": {
    "Version: Major": "major",
    "Version: Minor": "minor",
    "Version: Patch": "patch",
    "Version: Trivial": "skip-release"
  }
}
```

### 8. Labels Already Exist Warning

**Error Message**:
```
HttpError: Validation Failed: Label already exists
```

**Solution**:
This is usually harmless. The action will use existing labels instead of creating new ones. If labels have wrong colors/descriptions:

1. Delete existing version labels manually
2. Re-run the workflow to create them with correct formatting

### 9. Rate Limiting

**Error Message**:
```
API rate limit exceeded for user
```

**Solution**:
1. Wait for rate limit to reset (usually 1 hour)
2. Consider using a different token with higher limits
3. Reduce frequency of workflow runs if possible

### 10. Large PR Timeout

**Error Message**:
```
The operation was canceled
```

**Solution**:
```yaml
# Increase timeout for large repositories
jobs:
  danger:
    timeout-minutes: 15  # Default is 5 minutes
    uses: artsy/duchamp/.github/workflows/run-danger-yarn.yml@main
```

## Debugging Steps

### Step 1: Check Workflow Syntax

```bash
# Validate YAML syntax
yamllint .github/workflows/your-workflow.yml

# Or use GitHub's validation
git push origin your-branch  # GitHub will validate on push
```

### Step 2: Verify Repository Setup

```bash
# Check required files exist
ls -la .autorc          # For version labeling
ls -la dangerfile.ts    # For custom Danger rules
ls -la package.json     # For Node.js projects
```

### Step 3: Test Locally

```bash
# Install dependencies
yarn install

# Test TypeScript compilation
npx tsc --noEmit

# Test Danger (requires token)
export DANGER_GITHUB_API_TOKEN="your-token"
npx danger ci --dry-run
```

### Step 4: Check Workflow Logs

1. Go to your repository's "Actions" tab
2. Click on the failed workflow run
3. Expand the failing job
4. Look for specific error messages

### Step 5: Test with Minimal Configuration

Create a minimal workflow to isolate issues:

```yaml
# .github/workflows/debug.yml
name: Debug

on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: artsy/duchamp/.github/actions/setup-and-install@main
      - run: echo "Setup successful"
```

## Performance Issues

### Slow Installation

**Symptoms**: Dependencies take a long time to install

**Solutions**:
1. **Use caching** (automatically enabled in setup-and-install)
2. **Clean lockfile**:
   ```bash
   rm yarn.lock
   yarn install
   ```
3. **Check for large dependencies** in package.json

### Timeout Issues

**Symptoms**: Workflows timeout after 6 minutes

**Solutions**:
1. **Increase timeout**:
   ```yaml
   jobs:
     danger:
       timeout-minutes: 10
   ```
2. **Optimize dangerfile** to avoid expensive operations
3. **Use path filters** to avoid unnecessary runs

## Security Issues

### Token Exposure

**Never do**:
- Log token values
- Include tokens in error messages
- Commit tokens to version control

**If token is exposed**:
1. Immediately revoke the token
2. Generate a new token
3. Update repository secrets
4. Notify security team

### Permission Issues

**Symptoms**: Actions work inconsistently across repositories

**Check**:
1. Token has consistent permissions across repos
2. Repository settings allow Actions
3. Branch protection rules don't conflict

## Getting Additional Help

### Before Asking for Help

1. **Check this troubleshooting guide** thoroughly
2. **Review workflow logs** for specific error messages
3. **Test with minimal configuration** to isolate the issue
4. **Check recent changes** that might have caused the issue

### How to Ask for Help

When reporting issues, include:

1. **Full error message** from workflow logs
2. **Workflow configuration** (remove sensitive data)
3. **Repository configuration** (.autorc, package.json, etc.)
4. **Steps to reproduce** the issue
5. **Expected vs actual behavior**

### Where to Get Help

- **GitHub Issues**: For bugs and feature requests
- **Slack #practice-platform** 🔒: For quick questions
- **Direct contact**: [@amonkhouse](https://github.com/amonkhouse) or [@mc-jones](https://github.com/mc-jones)

### Emergency Support

For critical issues blocking deployments:
1. **Slack #practice-platform** 🔒 immediately
2. **Disable the failing workflow** temporarily
3. **Contact maintainers** directly

## Frequently Asked Questions

### Q: Can I use duchamp actions in private repositories?
**A**: Yes, duchamp actions work with both public and private repositories.

### Q: Do I need to install Danger.js in my repository?
**A**: No, duchamp actions include Danger.js. Only install it locally if you want to test dangerfiles.

### Q: Can I use multiple duchamp actions in one workflow?
**A**: Yes, you can use multiple actions in the same workflow file.

### Q: How do I update to new versions of duchamp?
**A**: Update the version reference in your workflow file (e.g., `@main` to `@v2.0.0`).

### Q: Can I contribute fixes to duchamp?
**A**: Yes! See our [contributing guide](./contributing.md) for details.

## Known Limitations

1. **GitHub API rate limits** may affect large repositories
2. **Node.js version compatibility** depends on your project requirements
3. **Yarn 3+ PnP mode** may require additional configuration
4. **Monorepo support** may need custom configuration

## Reporting Bugs

When reporting bugs to duchamp:

1. **Use GitHub Issues** in this repository
2. **Include reproduction steps** and examples
3. **Tag as bug** and provide severity level
4. **Mention affected actions** specifically

Your bug reports help make duchamp better for everyone!