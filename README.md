# duchamp

Reusable GitHub Actions and Danger.js plugins for the Artsy organization. This repository provides a centralized collection of workflows and tooling to maintain consistency and quality across Artsy's repositories.

## 🎯 Purpose

Duchamp provides shared GitHub Actions and Danger.js configurations that help enforce best practices across Artsy repositories, including:

- **Automated version labeling** for pull requests
- **Dependency management** checks via Danger
- **Standardized CI/CD workflows** for Node.js projects
- **Conventional commits** validation

## 🏗 Architecture

This repository serves as a tooling hub that other Artsy repositories can reference. It contains:

- **Reusable GitHub Actions**: Workflows that can be called by other repositories
- **Danger.js plugins**: Automated PR checking and labeling
- **Shared configuration**: Common setup patterns for Node.js projects

## 🚀 Quick Start

### Using the Actions in Your Repository

To use duchamp's actions in your repository, reference them in your workflow files:

```yaml
# .github/workflows/danger.yml
name: Danger Checks
on: [pull_request]

jobs:
  danger:
    uses: artsy/duchamp/.github/workflows/run-danger.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_GITHUB_API_TOKEN }}
```

### Available Actions

| Action | Description | Usage |
|--------|-------------|--------|
| `run-danger.yml` | General Danger.js checks | For custom danger configurations |
| `run-danger-yarn.yml` | Yarn-specific Danger checks | For Node.js projects using Yarn |
| `run-add-version-label.yml` | Auto-add version labels to PRs | For repositories using auto-release |
| `run-conventional-commits-check.yml` | Validate conventional commits | For conventional commit compliance |

## 📚 Documentation

For detailed documentation, see the [docs/](./docs/) directory:

- [Getting Started](./docs/getting-started.md) - Setup and basic usage
- [Available Actions](./docs/actions.md) - Detailed action reference
- [Examples](./docs/examples.md) - Real-world usage examples
- [Contributing](./docs/contributing.md) - How to contribute
- [Troubleshooting](./docs/troubleshooting.md) - Common issues and solutions

## 🛠 Development

### Prerequisites

- Node.js 22+
- Yarn
- TypeScript

### Local Development

```bash
# Clone the repository
git clone https://github.com/artsy/duchamp.git
cd duchamp

# Install dependencies
yarn install

# Run TypeScript checks
npx tsc --noEmit
```

### Testing Changes

Since this repository provides reusable actions, testing requires using them in a test repository or creating test workflows.

## 🏷 Version Labels

This repository automatically applies version labels to PRs based on the changes:

- `Version: Major` - Breaking changes to consuming repositories
- `Version: Minor` - New features or actions
- `Version: Patch` - Bug fixes or minor improvements
- `Version: Trivial` - Documentation or non-functional changes

## 📋 Requirements

- Repositories must have a `.autorc` file to use version labeling
- Danger.js actions require `DANGER_GITHUB_API_TOKEN` secret
- Node.js actions default to Node 22 but support custom versions

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📞 Support

For questions or support:
- **Point persons**: [@amonkhouse](https://github.com/amonkhouse), [@mc-jones](https://github.com/mc-jones)
- **Issues**: [GitHub Issues](https://github.com/artsy/duchamp/issues)
- **Slack**: [#practice-platform](https://artsy.slack.com/messages/practice-platform) 🔒

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

<a href="https://www.artsy.net/">
  <img align="left" src="https://avatars2.githubusercontent.com/u/546231?s=200&v=4"/>
</a>

This project is the work of engineers at [Artsy](https://www.artsy.net/), the world's leading and largest online art marketplace and platform for discovering art. One of our core [Engineering Principles](https://github.com/artsy/README/blob/master/culture/engineering-principles.md) is being [Open Source by Default](https://github.com/artsy/README/blob/master/culture/engineering-principles.md#open-source-by-default) which means we strive to share as many details of our work as possible.

You can learn more about this work from [our blog](https://artsy.github.io/) and by following [@ArtsyOpenSource](https://twitter.com/ArtsyOpenSource) or explore our public data by checking out [our API](https://developers.artsy.net/). If you're interested in a career at Artsy, read through our [job postings](https://www.artsy.net/jobs)!
