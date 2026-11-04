# Merge risk experiment

An opt-in addition to the [AI PR review](../review/README.md). Reviews of PRs in it
add a Merge Risk block to the summary: a low, medium or high rating of how bad it is if
the change turns out wrong, with a blast-radius read of what it could break beyond the
diff. It is separate from the other [experiments](../review/experiments.md): a PR can
be in any mix of them.

## Joining

1. **Enrol.** Add your GitHub login to `participants.yml` and open a PR. Every PR you
   author then gets the block, in any repo using the shared workflow. Case does not
   matter.
2. **Per PR.** Add the `ai-review-merge-risk` label to a single PR. It takes effect on
   the next push.

Leaving is the same in reverse: remove your login, or drop the label.

## What the review adds

Right after `### Summary`:

```
### Merge Risk: medium

**Safe because:** the rail's only consumers pass `artworks` through
`ArtworkRail.tsx:41`, which this PR keeps; walked it

**Alignment:** good ✅
**Impact:** medium 👀
- `ArtworkRail` also renders on Home and Artist pages (`HomeArtworkRail.tsx:18`)
**Verification:** poor ⚠️
- No before/after screenshots or recording of the rail on a device
**Rollback cost:** low ✅
**Error detection:** decent 👀
- A blank rail would not throw; nothing reports an empty render

**Before you merge:** scroll the Home rail on Android with 50+ artworks.
```

- **Five categories.** Alignment with the description, Impact, Verification, Rollback
  cost and Error detection, each rated ⚠️ / 👀 / ✅. A weighted score, kept out of the
  comment, gives the overall rating; Impact and Verification count double.
- **Blast radius behind Impact.** The reviewer looks for breakage grep won't show:
  library source, API and GraphQL shapes, DB columns, feature flags, code a few hops
  away. It names the one fact the change is safe because of and how far it proved it.
  It can't run code here, so "walked it" is as far as it goes; anything less is
  marked unproven, and "Before you merge" names the check that would settle it.
- **Whole PR.** The rating covers the PR against its base branch, even on a re-review
  of the latest commits.
- **Separate from the verdict.** The verdict says whether the code is right. Merge risk
  says how bad it is if it isn't, so an approved PR can still be high risk. A real bug
  found along the way is posted as a normal finding, not repeated in the block.

## How it works

`inMergeRisk` in `scripts/build-review-prompt.ts` checks the group, and
`formatMergeRiskSection` adds a "Merge Risk" section to the prompt telling the reviewer
to run the `merge-risk` skill. The skill lives in
`../.claude/experiment-skills/merge-risk/`, and the workflow copies it to the runner
only for these reviews, so a review outside the experiment can't load it.

The skill adapts two MIT skills: [Warp's `merge-risk`](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/merge-risk/SKILL.md)
for the rubric, and [Cursor's `blast-radius`](https://github.com/cursor/plugins/blob/bb68f2365eceafa0cb2d253112f675acf5f144cc/pstack/skills/blast-radius/SKILL.md)
for the method. Its `SOURCE.md` lists what changed; `LICENSE` holds both notices.

## Knowing it ran

Every review metric carries `merge_risk:true|false`: true when the prompt asked for the
block. `ai_pr_review.skill_calls` tagged `skill:merge-risk` shows whether the reviewer
loaded the skill. If the skill is missing on the runner, the summary says
`Merge Risk: skipped, skill not found` instead of leaving the block out. The rating
itself isn't sent to Datadog yet.
