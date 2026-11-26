# Backlog of anomalies

Open anomalies, gaps and decisions (coding rules `workflow-git.md` §Backlog). Kinds: `explain`, `do`, `deferred`.
Next number: highest `Z-nn` in this file and `docs/archive/` + 1:
`grep -ohE 'Z-[0-9]+' docs/backlog.md docs/archive/*.md 2>/dev/null | sort -t- -k2 -n | tail -1`

| Z-nn | subject | kind | since |
|---|---|---|---|
| Z-1 | Checks of coding rules 1.36.0-1.46.2 not in place yet | do | 2026-11-26 |

### Z-1 Checks of coding rules 1.36.0-1.46.2 not in place yet (2026-11-26) – do

- Seen: 2026-11-26, rule-set update to coding-rules 1.46.2; these checks of the new rules are missing.
- Known facts: missing are the result stamp of `check` and a `pre-commit` hook that runs it and is never bypassed
  (1.36.0); `verify` errors on new skip/focus markers in tests (1.36.0); `test --changed`, the `where` script, a
  time limit on every external command of the scripts and the module index at the top of `docs/architecture.md`
  (1.38.0); agent hooks in the agent settings file (1.41.0, operator file).
- Next step: add the scripts and hooks; the operator adds the hooks to the agent settings file.
