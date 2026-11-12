# Vendored skills

Two skills from [mattpocock/skills](https://github.com/mattpocock/skills), copied
unchanged at commit `5863806dd4e15c63174bee4e7515a4256792ecfa` (2026-11-12). MIT
licence in `LICENSE`.

| Here | Upstream path |
| --- | --- |
| `diagnosing-bugs/` | `skills/engineering/diagnosing-bugs/` |
| `pr/` | `skills/engineering/pr/` |

Left out: `diagnosing-bugs/scripts/hitl-loop.template.sh`. The autofix agent has no
shell and no human in the loop.

Only `autofix-datadog.yml`'s fix job installs these. The agent there cannot run
commands, so parts of `diagnosing-bugs` (build and run a feedback loop, ask the
user) don't apply; `scripts/autofix/prompt.md` says which parts to skip. Change that
prompt, not these files.

To update: copy the two directories from a newer commit, drop the HITL script again,
update the SHA above, and read the diff before merging. These files steer the agent.
