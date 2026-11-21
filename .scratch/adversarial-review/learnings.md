<!-- redeye:entry ticket=adversarial-review:1 attempt=1 outcome=done -->
## 2026-11-20 18:58 -- adversarial-review/01 attempt 1 -- done

Effort: medium. Agent exit: 0. Subagents: 0. Cost: $0.92. Checked items: "A role string with a provider and the allowed flags parses to its provider, model, effort, max turns and prefer-subagent values; an unknown flag or an extra positional is rejected", "`maxRounds` and `minRounds` default to 3 and 1; a value that is not a positive integer, or `minRounds` greater than `maxRounds`, is rejected", "A missing `implement` or `review` inside `adversarial` is rejected", "A `.redeye.json` that is not valid JSON makes the run exit 2 and creates no branch or worktree", "An `adversarial` role string with an unsupported flag makes the run exit 2 and creates no branch or worktree", "`--dry-run` with `adversarial` configured prints the implement and review role strings, `maxRounds` and `minRounds`", "With no `.redeye.json`, or one without an `adversarial` key, a run behaves as it does today (existing integration tests stay green)".

### Agent notes
# Ticket 01: load and validate .redeye.json

Most of the ticket was already implemented on this branch by earlier
commits (US-001 parse role strings, US-002 load/validate, US-003
dry-run, US-005 merge with CLI): src/config.ts, test/config.test.ts,
spawnCli cases in test/integration.test.ts, README section,
package.json build list, scripts/test.sh TESTS, AGENTS.md
module-boundaries entry. I verified each checklist item has a real
test rather than re-implementing.

Gap found and fixed (TDD, red then green):
- `adversarial` of the wrong shape (string, null, number, array) used
  to return null (loop silently off). The spec says wrong shape is a
  runtime error, so loadConfig now throws. A top-level value that is
  not an object (e.g. `[]`) also throws.
- Files: src/config.ts, test/config.test.ts, README.md, AGENTS.md
  (tapzero async t.throws gotcha).

Pre-existing, not touched: `tsc --noEmit -p .` reports type errors
in test/display.test.ts, test/integration.test.ts,
test/orchestrator.test.ts, test/review.test.ts (out of scope).

---
