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
<!-- redeye:entry ticket=adversarial-review:3 attempt=1 outcome=done -->
## 2026-11-20 19:07 -- adversarial-review/03 attempt 1 -- done

Effort: medium. Agent exit: 0. Subagents: 0. Cost: $0.72. Checked items: "`setup()` given an adversarial config writes `.redeye.json` with `implement`, `review`, `maxRounds` and `minRounds`", "`setup()` given an adversarial config and an existing `.redeye.json` with other keys keeps those keys and adds `adversarial`", "`setup()` with no adversarial config leaves an existing `.redeye.json` untouched and creates none when it is absent".

### Agent notes
# Ticket 03: redeye init asks about adversarial loops

Most of this ticket was already on the branch from earlier commits
(US-007 `setup()` writes the adversarial key, the `init` prompts in
src/index.ts, a README paragraph). I checked each checklist item
against test/setup.test.ts; all three have real tests that pass:
- writes `.redeye.json` with implement/review/maxRounds/minRounds
- merges into an existing file and keeps its other keys
- with no adversarial config, leaves the file alone and creates none
No new tests were needed, so there was no red step for them.

Changes in this attempt (no test, per the ticket: the prompts stay
untested, like the tracker prompt):
- src/index.ts: moved the adversarial question to come right after
  the tracker question, as the spec says, ahead of the skill-overwrite
  prompts. Reworded it to "Run an adversarial review loop on each
  ticket?" Replaced the two copies of the validate closure with one
  `validateRoleString` (an inquirer validate that returns a string
  re-asks the question).
- README.md: the init paragraph now covers default no, re-asking on
  an invalid string, explicit round defaults, merging, and the no
  path.

Known, not fixed (out of scope): if an existing `.redeye.json` is not
valid JSON, `setup()` throws at the end, after skills and docs are
already installed. The init handler is async, so this exits 2 through
`.fail()`.

npm run lint, npm run build and npm test all pass.

---
<!-- redeye:entry ticket=adversarial-review:2 attempt=1 outcome=done -->
## 2026-11-20 19:09 -- adversarial-review/02 attempt 1 -- done

Effort: medium. Agent exit: 0. Subagents: 0. Cost: $1.58. Checked items: "A bare `redeye` in a repo whose `.redeye.json` configures `adversarial` runs tickets with the `implement` provider and model", "A provider on the command line overrides `implement` for that run and logs that it did", "A CLI flag the role string leaves out applies to that role; a flag set in the role string wins over the CLI flag", "A missing `review` executable makes the run exit 2 before any branch is created", "`implement` and `review` with the same provider and model produce the same-model warning in a run and in `--dry-run`", "`--dry-run` says when a command-line provider overrides `implement`", "A bare `redeye` with no `.redeye.json` still gives today's usage error".

### Agent notes
# Ticket 02: run with the implement role

Most of this ticket was already on the branch (earlier US-004/US-006
commits): optional `[provider]`, `.check()` usage error, override log
line, review preflight, same-model warning, dry-run lines, in-place
skip log, and their CLI tests. I verified each and filled the gap.

Gap fixed (TDD, red then green):
- Flag precedence was wrong: CLI `-m` beat the implement role's
  model, the implement role's `--effort`/`--max-turns`/
  `--prefer-subagent` were ignored, and the review role got no CLI
  fill-in. Added `resolveRoles` and `sameModel` to src/config.ts
  (unit tests in test/config.test.ts) and wired runExecute to them.
- The same-model warning now compares the merged roles (e.g.
  implement `claude`, review `claude -m opus`, CLI `-m opus` warns).
- New CLI-run tests in test/integration.test.ts: bare run uses the
  implement provider with role model winning over -m and CLI effort
  filling in, review (fake pi) gets the CLI model; CLI provider
  override in a real run logs the line and drops the role's model;
  same-model warning appears once in a real run that goes ahead.

Reading of vague criteria: a CLI provider replaces the implement
role whole, so the role string's flags do not carry over to it.

Files: src/config.ts, src/index.ts, test/config.test.ts,
test/integration.test.ts, README.md, AGENTS.md.

Running a subset of integration tests: copy the file with chosen
titles switched to `test.only`, bundle with esbuild, run with
GIT_CONFIG_GLOBAL pointing at a file with `useConfigOnly = true`.

---
