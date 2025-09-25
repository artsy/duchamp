# duchamp

This repository provides a centralized collection of GitHub workflows and tooling to use across Artsy's repositories.

## 🎯 Purpose

Duchamp provides shared GitHub Actions and Danger.js configurations that help enforce best practices across Artsy repositories, including:

- **Automated version labeling** for pull requests
- **Dependency management** checks via Danger
- **Standardized CI/CD workflows** for Node.js projects
- **Conventional commits** validation

## 🚀 Quick Start

### Using the Actions in Your Repository

To use duchamp's actions in your repository, reference them in your workflow files:

```yaml
# .github/workflows/danger.yml
name: Danger Checks
on:
  pull_request:

jobs:
  danger:
    uses: artsy/duchamp/.github/workflows/run-danger.yml@main
    secrets:
      danger-token: ${{ secrets.DANGER_TOKEN }}
```

### Available Actions

| Action                               | Description                    | Usage                               |
| ------------------------------------ | ------------------------------ | ----------------------------------- |
| `run-danger.yml`                     | General Danger.js checks       | For custom danger configurations    |
| `run-danger-yarn.yml`                | Yarn-specific Danger checks    | For Node.js projects using Yarn     |
| `run-add-version-label.yml`          | Auto-add version labels to PRs | For repositories using auto-release |
| `run-conventional-commits-check.yml` | Validate conventional commits  | For conventional commit compliance  |

## 📚 Documentation

For detailed documentation, see the [docs/](./docs/) directory:

- [Getting Started](./docs/getting-started.md) - Setup and basic usage
- [Available Actions](./docs/actions.md) - Detailed action reference
- [Examples](./docs/examples.md) - Real-world usage examples

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
```

### Testing Changes

To test changes you are adding on a branch, you can reference the workflow elsewhere and reference your branch name during the testing process:

```yaml
uses: artsy/duchamp/.github/workflows/YOUR-WORKFLOW.yml@YOUR-BRANCH
```

## 📞 Support

For questions or support:

- **Point persons**: [@amonkhouse](https://github.com/amonkhouse), [@mc-jones](https://github.com/mc-jones)
- **Issues**: [GitHub Issues](https://github.com/artsy/duchamp/issues)
- **Slack**: [#product-sapphire](https://artsy.slack.com/messages/product-sapphire)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

<a href="https://www.artsy.net/">
  <img align="left" src="https://avatars2.githubusercontent.com/u/546231?s=200&v=4"/>
</a>

This project is the work of engineers at [Artsy](https://www.artsy.net/), the world's leading and largest online art marketplace and platform for discovering art. One of our core [Engineering Principles](https://github.com/artsy/README/blob/master/culture/engineering-principles.md) is being [Open Source by Default](https://github.com/artsy/README/blob/master/culture/engineering-principles.md#open-source-by-default) which means we strive to share as many details of our work as possible.

You can learn more about this work from [our blog](https://artsy.github.io/) and by following [@ArtsyOpenSource](https://twitter.com/ArtsyOpenSource) or explore our public data by checking out [our API](https://developers.artsy.net/). If you're interested in a career at Artsy, read through our [job postings](https://www.artsy.net/jobs)!
