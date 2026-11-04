---
name: merge-risk
description: "Rate the risk of merging a pull request as low, medium or high, with a blast-radius read of what the change could break beyond the diff. Use when the review prompt asks for a Merge Risk block."
---

# Merge risk

Rate how risky it is to merge this PR, and write the result as a Merge Risk block in the
review summary. The verdict says whether the code is right. Merge risk says how bad it
is if it isn't. A clean PR can still be high risk, and a PR with nits can be low.

Rate the whole PR against its base branch, even on a re-review of a few commits.

## Blast radius

Do this first. It decides the Impact rating and the "Safe because" line.

Listing the callers is not the job; grep does that in a second. The job is the breakage
grep won't show you.

1. **Read the change.** The diff, the symbols it adds, changes and deletes, and what
   it now does differently, including what the diff doesn't spell out.
2. **Find the one fact it's safe because of.** Most changes that look risky are safe
   because of a single fact, such as "this call only drops cache entries that are
   already dead". If it holds, most risky cases clear at once. Spend your time here,
   not on a long list of maybes.
3. **Look where grep stops.** Read the source of the library the change calls, in
   `node_modules` or the vendored copy, and check its pinned version and any local
   patch. Work out when things run: microtasks, unmount and teardown, background
   jobs. Follow what a symbol search misses: the JSON an API returns, a GraphQL field
   a client reads, a DB column, a wire format, another service reading the same data,
   a feature flag, code three hops downstream.
4. **Be honest about each risk.** Give it a real chance of happening and a real cost
   if it does. Keep the risks you confirmed. Note what you checked and cleared. Cite a
   real `file:line`; a search that finds nothing is still an answer. Never make up a
   caller or an API.

### How far you proved it

Take each fact the change's safety depends on as far down this list as you can, and
say where it stopped:

1. **Said so.** Worthless on its own.
2. **Pointed at the line.** A real `file:line`, or the library's own source.
3. **Walked it.** You traced the failure step by step and it doesn't reach.

You can't run code in this review, so you stop at 3. When a fact matters and you
couldn't walk it, mark it unproven, and name the test or script that would prove it
under "Before you merge".

## Categories

Each category gets a verdict. Low risk looks like this:

- **Alignment (poor ⚠️ / decent 👀 / good ✅):** the code matches the PR description
  and the linked issue, when there is one. Behaviour assumptions and drive-by changes
  are written down.
- **Impact (large ⚠️ / medium 👀 / small ✅):** the scope is contained and away from
  sensitive code. Use the blast radius above: layout shifts, breakage for consumers,
  other screens that render the same component, other services that read the same
  data.
  - Sensitive areas carry outsized risk whatever the diff size: auth, permissions,
    payments, PII, secrets, data migrations, dependency bumps, and infra or config
    changes. Flag any the PR touches, and call out anything that widens access, weakens
    validation or logs sensitive data.
- **Verification (poor ⚠️ / decent 👀 / good ✅):** the behaviour is verified, where
  that applies. Read the PR description (`gh pr view`) for evidence.
  - Changes to what users see need end-to-end proof: screenshots or recordings,
    before and after where possible. Changes that could affect performance need
    profiling. Without them, Verification is poor.
  - Edge cases are tested, or written down when they aren't. When only a note covers
    one, read the code and link to it.
- **Rollback cost (high ⚠️ / medium 👀 / low ✅):** the change can be undone once
  merged. A two-way door you can walk back through is low. One-way doors, such as
  destructive migrations, deleted data, published API contracts other teams consume,
  or app releases users must update past, are high.
- **Error detection (poor ⚠️ / decent 👀 / good ✅ / N/A ✅):** if this breaks in
  production, someone finds out before users report it. Look for swallowed errors and
  fallbacks that hide breakage. Critical flows should be monitored.

## Score

Score each verdict: ⚠️ = 3, 👀 = 2, ✅ = 1. Weights: Impact 2, Verification 2, Rollback
cost 1.5, Error detection 1, Alignment 1.

Score = Σ(verdict × weight) / Σ(weights)

- low: below 1.5
- medium: 1.5 to below 2.25
- high: 2.25 and above

Keep the numbers to yourself. Don't put the score or the sum in the review.

## Output

Put this block in the summary comment, right after `### Summary`:

```
### Merge Risk: <low | medium | high>

**Safe because:** <the one fact>; <pointed at the line | walked it | unproven>

**Alignment:** <verdict>
- <gap that adds risk, with a file:line link where it helps>
**Impact:** <verdict>
- <gap>
**Verification:** <verdict>
- <gap>
**Rollback cost:** <verdict>
- <gap>
**Error detection:** <verdict>
- <gap>

**Before you merge:** <the cheapest test or check that would catch the real bug>
```

- List gaps only. A category with nothing to add is one line with its verdict.
- Keep bullets short. Two or three per category at most.
- A blast-radius risk that is a real bug in this PR is a finding. Post it with the
  usual severity rules and refer to it here; don't write it twice.
- Leave out "Before you merge" when nothing is worth checking.
