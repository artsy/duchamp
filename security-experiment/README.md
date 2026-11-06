# Security experiment

An opt-in addition to the [AI PR review](../review/README.md). Reviews of PRs in it
get a security pass by a subagent that reads only for security. It is separate from
the [lean reviews experiment](../lean-reviews-experiment/README.md): a PR can be in one, both or
neither.

## Joining

1. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author then gets the pass when it touches a sensitive file, in any repo using the
   shared workflow. Case does not matter.
2. **Per repo.** Add the repo's full name, such as `artsy/gravity`, under `repos` in
   `participants.yml`. Every PR in it then gets the pass on the same terms as an
   enrolled author's. gravity and metaphysics are in.
3. **Per PR.** Add the `security-review` label to a single PR. Adding it starts a full
   review straight away, and the pass covers every file the PR changes, not only
   sensitive ones.

Leaving is the same in reverse: remove your login or the repo, or drop the label.

## How it works

See [Security pass](../review/README.md#security-pass).
