# Contributing to duchamp

We welcome contributions to duchamp! This document provides guidelines for contributing to this repository.

## Getting Started

### Prerequisites

- Node.js 22+
- Yarn
- TypeScript knowledge
- Familiarity with GitHub Actions
- Understanding of Danger.js

### Development Setup

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/your-username/duchamp.git
   cd duchamp
   ```

2. **Install dependencies**:
   ```bash
   yarn install
   ```

3. **Verify TypeScript compilation**:
   ```bash
   npx tsc --noEmit
   ```

## Making Changes

### Types of Contributions

We welcome the following types of contributions:

1. **Bug fixes** in existing actions or workflows
2. **New reusable actions** that benefit multiple Artsy repositories  
3. **Documentation improvements** 
4. **Performance optimizations**
5. **Security enhancements**

### Before You Start

1. **Check existing issues** to see if your idea is already being discussed
2. **Open an issue** for new features to discuss the approach
3. **Contact maintainers** for major changes via Slack or GitHub

### Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our guidelines below

3. **Test your changes** (see Testing section)

4. **Commit using conventional commits**:
   ```bash
   git commit -m "feat: add new action for xyz"
   ```

5. **Push and create a pull request**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Guidelines

### Code Style

- **TypeScript**: All new code should be written in TypeScript
- **Formatting**: Use Prettier defaults (no custom configuration needed)
- **Naming**: Use descriptive names for functions, variables, and files
- **Comments**: Document complex logic and external dependencies

### Workflow Standards

- **Inputs**: Always provide sensible defaults for optional inputs
- **Outputs**: Document all outputs and their purposes
- **Secrets**: Never log or expose secret values
- **Error handling**: Provide clear error messages and appropriate exit codes

### Documentation Requirements

For any new action or significant change:

1. **Update README.md** if the change affects the main functionality
2. **Add action documentation** to `docs/actions.md`
3. **Provide usage examples** in `docs/examples.md`
4. **Include inline comments** for complex logic

### Example Code Structure

When adding new Danger.js functionality:

```typescript
// Import dependencies at the top
import { danger, warn, fail } from "danger"

// Export configuration objects when applicable
export const config = {
  // Configuration options
}

// Main function should be exported as default
export default async function yourFeatureName() {
  // Early returns for conditions that skip processing
  if (!shouldRun()) {
    console.log("Skipping because condition not met")
    return
  }

  try {
    // Main logic here
    await performAction()
  } catch (error) {
    console.error("Error in your feature:", error)
    fail("Your feature failed to execute properly")
  }
}

// Helper functions
function shouldRun(): boolean {
  return true // Your logic here
}

async function performAction() {
  // Implementation
}
```

## Testing

### Manual Testing

Since duchamp provides reusable actions, testing requires using them in actual workflows:

1. **Create a test repository** or use an existing Artsy repository
2. **Reference your branch** in the workflow:
   ```yaml
   uses: your-username/duchamp/.github/workflows/your-action.yml@your-branch
   ```
3. **Create test pull requests** to trigger the workflows
4. **Verify expected behavior** in workflow runs and PR comments

### Automated Testing

While we don't have unit tests for GitHub Actions, ensure your TypeScript compiles:

```bash
# Check compilation
npx tsc --noEmit

# Run Danger locally (requires DANGER_GITHUB_API_TOKEN)
npx danger ci --dry-run
```

### Integration Testing

Before merging:

1. **Test in multiple repositories** if possible
2. **Verify backward compatibility** with existing users
3. **Check performance impact** on workflow execution time
4. **Validate error scenarios** and error messages

## Pull Request Process

### PR Requirements

- [ ] **Descriptive title** using conventional commit format
- [ ] **Detailed description** explaining the change and motivation
- [ ] **Link to related issues** if applicable
- [ ] **Documentation updates** for user-facing changes
- [ ] **Testing evidence** (screenshots, workflow run links)
- [ ] **Backward compatibility** considered and maintained

### PR Template

When creating a pull request, include:

```markdown
## Description
Brief description of what this PR does.

## Motivation
Why is this change needed?

## Changes Made
- List specific changes
- Include any breaking changes
- Note any new dependencies

## Testing
- [ ] Tested in development environment
- [ ] Verified TypeScript compilation
- [ ] Tested with actual repository workflow
- Link to test workflow run: [link]

## Documentation
- [ ] Updated README.md if needed
- [ ] Updated docs/actions.md for new actions
- [ ] Added examples to docs/examples.md
- [ ] Added inline code documentation

## Checklist
- [ ] Follows conventional commit format
- [ ] Maintains backward compatibility
- [ ] Includes appropriate error handling
- [ ] No secrets or sensitive data exposed
```

### Review Process

1. **Automated checks** will run on your PR
2. **Maintainer review** by [@amonkhouse](https://github.com/amonkhouse) or [@mc-jones](https://github.com/mc-jones)
3. **Community feedback** from other Artsy engineers
4. **Testing validation** in real-world scenarios

## Release Process

### Version Labels

The repository uses automated version labeling:

- `Version: Major` - Breaking changes to existing actions
- `Version: Minor` - New actions or significant features
- `Version: Patch` - Bug fixes and minor improvements  
- `Version: Trivial` - Documentation or non-functional changes

### Versioning Strategy

- **Main branch** contains the latest stable version
- **Tagged releases** for major versions (v1.0.0, v2.0.0, etc.)
- **Semantic versioning** for all releases

## Code of Conduct

### Our Standards

- **Be respectful** in all interactions
- **Provide constructive feedback** in reviews
- **Help others learn** and grow
- **Focus on the code**, not the person
- **Ask questions** when something is unclear

### Reporting Issues

For code of conduct violations:
1. Contact [@amonkhouse](https://github.com/amonkhouse) or [@mc-jones](https://github.com/mc-jones) privately
2. Use [#practice-platform](https://artsy.slack.com/messages/practice-platform) 🔒 for general concerns
3. Follow Artsy's internal reporting procedures

## Getting Help

### Where to Ask Questions

- **GitHub Issues** - For bugs, feature requests, and technical questions
- **Slack #practice-platform** 🔒 - For general discussion and quick questions  
- **Direct message** - Contact maintainers for sensitive topics

### Useful Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Danger.js Documentation](https://danger.systems/js/)
- [Artsy Engineering README](https://github.com/artsy/README)
- [Conventional Commits](https://www.conventionalcommits.org/)

## Maintainers

- **Primary**: [@mc-jones](https://github.com/mc-jones) - Platform Practice Lead
- **Secondary**: [@amonkhouse](https://github.com/amonkhouse) - Platform Practice  

### Maintainer Responsibilities

- Review and merge pull requests
- Release new versions
- Maintain documentation
- Support users and contributors
- Monitor security and performance

## Recognition

Contributors to duchamp are recognized in:
- GitHub contributor graphs
- Release notes for significant contributions
- Artsy engineering team shout-outs
- Internal engineering documentation

Thank you for contributing to duchamp and helping improve Artsy's engineering practices! 🎨