module.exports = async ({ github, context, core }) => {
  const pr = context.payload.pull_request;
  const { owner, repo } = context.repo;
  const prNumber = pr.number;

  const conventionalCommitFormat = /^(fix|feat|build|chore|ci|docs|style|refactor|perf|test|revert)(?:\(.+\))?!?:.+$/;
  const MARKER = '<!-- cc-title-bot -->';

  const message = `${MARKER}
Hi there! :wave:
We use **Conventional Commit formatting** for PR titles, but your PR title does not appear to follow this.
Please update your title to follow [Conventional Commits](https://www.conventionalcommits.org) guidelines.
`;

  const allComments = await github.paginate(
    github.rest.issues.listComments,
    { owner, repo, issue_number: prNumber, per_page: 100 }
  );
  const existing = allComments.find(c =>
    typeof c.body === 'string' && c.body.includes(MARKER)
  );

  const titleIsValid = pr.title === 'Deploy' || conventionalCommitFormat.test(pr.title);

  if (!titleIsValid) {
    if (!existing) {
      await github.rest.issues.createComment({
        owner, repo, issue_number: prNumber, body: message
      });
    }
    else {
        core.info('PR title is invalid but reminder has already been posted; skipping reminder.');
      }
    core.setFailed('PR title does not follow Conventional Commit rules.');
    return;
  }

  if (existing) {
    await github.rest.issues.deleteComment({
      owner, repo, comment_id: existing.id
    });
    core.info('Conventional commit check passed, deleted existing comments.');
  }

  core.info('PR title is valid.');
};
