# How long AI reviews have taken

How long the review job took in the repos that use the shared workflow, from its start
on 2026-01-29 to 2026-10-27. The numbers come from the Actions API, not job logs, so
they reach back past GitHub's 90 days of logs. They cover time only: cost, turns and
tokens exist from 2026-10-21 on, in the `REVIEW_USAGE` log lines and in Datadog.

## How the numbers were collected

```bash
yarn ts-node scripts/review-duration-history.ts \
  --repos eigen,exchange,force,forque,gravity,logic-core-data-access,logic-core-manager-product,metaphysics,motion,presentation-main-ui,react-native-starter-artnet,volt,duchamp \
  --since 2026-01-29 --until 2026-10-27 --per-week 10 --exclude-author MounirDhahri
```

- The 13 repos had 12,488 completed runs of `run-claude-review.yml`. A run shorter than
  60 seconds stopped at the check job (a draft, a bot, an in-progress label), which
  leaves 5,791 runs with a review.
- The script samples up to 10 of those per repo and week, spread across the week, and
  reads the review job's timings: 1,589 reviews. That keeps it to about 2,500 API
  calls, half the hourly limit.
- PRs by MounirDhahri are left out. They ran the review experiment, so those PRs often
  got a different setup from everyone else's.
- **Job** is the whole review job, including about a minute of checkout, installs and
  posting. **Claude step** is the "Run Claude Code Review" step alone. GitHub drops
  step timings from older runs, so that column starts in May.

## By month

| Month | Reviews | Repos | Job median | Job p90 | Claude step median (reviews with step timings) |
| --- | --- | --- | --- | --- | --- |
| 2026-01 | 20 | 2 | 2m 55s | 5m 02s | - |
| 2026-02 | 71 | 3 | 3m 07s | 4m 31s | - |
| 2026-03 | 117 | 4 | 2m 43s | 3m 59s | - |
| 2026-04 | 134 | 4 | 3m 21s | 5m 39s | - |
| 2026-05 | 122 | 4 | 3m 13s | 4m 58s | 2m 13s (87) |
| 2026-06 | 131 | 5 | 3m 22s | 5m 20s | 2m 24s (131) |
| 2026-07 | 180 | 7 | 4m 25s | 7m 38s | 3m 27s (180) |
| 2026-08 | 213 | 9 | 4m 04s | 7m 35s | 3m 06s (213) |
| 2026-09 | 303 | 11 | 3m 56s | 6m 11s | 3m 02s (303) |
| 2026-10 | 298 | 11 | 3m 31s | 6m 08s | 2m 40s (298) |

## What changed the numbers

- **January to June: about 3 minutes a job**, in 2 to 5 repos.
- **Weeks of Jul 27 and Aug 3: the slowest, 6m 03s and 7m 09s.** Reviews moved to
  Opus 5 (#108, Jul 27) and then to a two-pass review (#110, Jul 31). Reverting both
  (#112, Aug 6) brought the next week back to 3m 28s.
- **August and September: about 4 minutes**, as more repos joined (9 to 11).
- **October: 3m 31s**, faster than September. Every review has run on Opus 5.5 at high
  effort since #132 (Oct 19), and the diff has been in the prompt since #134 (Oct 21).
  [After #132](#after-132) has more on that change.

Other weeks move by 30 to 60 seconds with no change to the review, such as 4m 39s in
the week of Oct 12. Read anything smaller than that as noise.

## By week

| Week of | Reviews | Job median |
| --- | --- | --- |
| 2026-01-26 | 20 | 2m 55s |
| 2026-02-02 | 17 | 3m 10s |
| 2026-02-09 | 18 | 2m 40s |
| 2026-02-16 | 18 | 3m 15s |
| 2026-02-23 | 18 | 3m 47s |
| 2026-03-02 | 19 | 3m 10s |
| 2026-03-09 | 28 | 2m 45s |
| 2026-03-16 | 29 | 2m 27s |
| 2026-03-23 | 25 | 2m 52s |
| 2026-03-30 | 31 | 2m 55s |
| 2026-04-06 | 35 | 3m 37s |
| 2026-04-13 | 28 | 3m 40s |
| 2026-04-20 | 28 | 3m 15s |
| 2026-04-27 | 33 | 3m 19s |
| 2026-05-04 | 30 | 3m 35s |
| 2026-05-11 | 34 | 3m 15s |
| 2026-05-18 | 31 | 3m 01s |
| 2026-05-25 | 22 | 3m 05s |
| 2026-06-01 | 35 | 3m 44s |
| 2026-06-08 | 27 | 3m 04s |
| 2026-06-15 | 25 | 2m 59s |
| 2026-06-22 | 30 | 3m 29s |
| 2026-06-29 | 29 | 3m 09s |
| 2026-07-06 | 30 | 3m 50s |
| 2026-07-13 | 38 | 4m 06s |
| 2026-07-20 | 49 | 3m 45s |
| 2026-07-27 | 48 | 6m 03s |
| 2026-08-03 | 44 | 7m 09s |
| 2026-08-10 | 48 | 3m 28s |
| 2026-08-17 | 49 | 4m 01s |
| 2026-08-24 | 55 | 4m 12s |
| 2026-08-31 | 66 | 4m 21s |
| 2026-09-07 | 68 | 3m 31s |
| 2026-09-14 | 76 | 4m 03s |
| 2026-09-21 | 69 | 4m 04s |
| 2026-09-28 | 64 | 2m 57s |
| 2026-10-05 | 70 | 3m 22s |
| 2026-10-12 | 74 | 4m 39s |
| 2026-10-19 | 84 | 3m 21s |
| 2026-10-26 | 47 | 3m 31s (Monday and Tuesday only) |

## After #132

A separate look at Sep 30 to Oct 23 that reads every review, not a sample, and counts
the inline comments `claude[bot]` posted during each review job. #132 moved everyone
outside the experiment to the experiment's prompt and Opus 5.5 at high effort, so the
table covers those authors. It leaves out the experiment's participants, who already
had that setup, and MounirDhahri.

| Period | Reviews | Inline comments per review | Reviews with any inline comment | Claude step median / p90 | Job median |
| --- | --- | --- | --- | --- | --- |
| Sep 30 to Oct 19 (before #132) | 443 | 0.29 | 21% | 2m 47s / 5m 07s | 3m 44s |
| Oct 19 to 21 (#132 only) | 89 | 1.65 | 81% | 3m 11s / 5m 38s | 4m 16s |
| Oct 21 to 23 (after #134) | 112 | 1.81 | 82% | 2m 56s / 5m 57s | 3m 46s |

Inline comments went up in every repo, and time stayed about the same. The windows
after #132 are short, and they don't control for PR size.

## Caveats

- These are samples, and the repos in them change over time: two repos in January,
  eleven since September. A month's median moves when a slow or fast repo joins.
- Job time includes setup that changed over the year, such as installing a pinned
  Claude Code version from #126 until #132.
- The script counts a run as a review when it ran for 60 seconds or more and the
  review job succeeded. A review that failed is left out.
