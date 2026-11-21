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
<!-- redeye:entry ticket=adversarial-review:4 attempt=1 outcome=done -->
## 2026-11-20 19:18 -- adversarial-review/04 attempt 1 -- done

Effort: medium. Agent exit: 0. Subagents: 0. Cost: $1.38. Checked items: "A ticket whose reviewer writes `No findings.` merges, and its review log has one round", "A ticket whose reviewer writes an open finding is not merged, its status is `ready-for-human`, its branch still exists, `progress.md` records it as not done, and the run exits 1", "A ticket blocked by an unresolved ticket is reported as blocked and does not run", "A reviewer that exits non-zero or writes unparseable findings fails the attempt, and the ticket goes through the existing retry path", "The reviewer runs with the review role's provider and model, and implementation runs with the implement role's", "The ticket review log round-trips through render and parse, neutralizes sentinel text in free-text fields, and drops malformed entries", "With no `adversarial` key, the agent invocations in a run match today's (no reviewer is spawned for a ticket)".

### Agent notes
# Ticket 04: review round gates each ticket

Almost all of this ticket was already on the branch from earlier
US-009..US-020 commits (round runner, unresolved outcome, ticket
review log, fake pi, setRoundLabel, AGENTS.md invariants). I mapped
each checklist item to existing tests and filled the gaps.

Already covered by existing tests:
- review log round-trip, sentinel neutralization, malformed drop
  (test/review.test.ts)
- no adversarial key -> no reviewer (review-integration)
- review role provider/model vs implement role (integration.test.ts,
  ticket 02's "bare redeye" CLI test)

Added (tests pass against existing code, so these were test-after,
not red-first; the behaviour pre-existed):
- CLI test, maxRounds 1 + fake pi "finding": exit 1, ready-for-human,
  change not merged, ticket branch kept, worktree removed,
  progress.md done:false, dependent 02 never runs and is listed,
  01 not retried with --retries 1.
- review-integration: unparseable and exit1 reviewer fail attempt 1,
  retry passes (log terminals failed, pass; implementation ran twice).
- clean-review test now asserts the change is on the base branch.

No src changes were needed.

---
<!-- redeye:entry ticket=adversarial-review:5 attempt=1 outcome=done -->
## 2026-11-20 19:29 -- adversarial-review/05 attempt 1 -- done

Effort: medium. Agent exit: 0. Subagents: 0. Cost: $2.13. Checked items: "A finding the fixer marks `[x]` stays open when the next reviewer keeps it open".

### Agent notes
# Ticket 05: fix rounds with verdicts and disputes

The loop (fix step, verdict prompt, round limits, unresolved) was
already on the branch from the US-014..US-018 commits. Work here is
closing test gaps against each checklist item and documenting the
round rules.

Helper: `.redeye/one.sh <suite> '<test name prefix>'` runs one test
from a temp copy (not committed).

Item 1 (fix + confirm, two rounds): the mock fixer's `pass` mode
prints `[x] mock finding one`, which never matches the pi finding,
so no test exercised a recorded `fixed` response. Added mock fixer
mode `fix-all` (marks every finding in its prompt) and assertions:
round 1 records fixerResponse fixed, testResult pass, a new fixHead;
round 2 reviews that head; change and fix are on main. Red
(fixerResponse undefined) -> green by the mock change only; src was
already right.

Item 2 (dispute + withdraw): added assertions that round 1 records
fixerResponse disputed with the notes text as reason, testResult
pass, the round-2 reviewer prompt carries the reason, and the change
is on main. Passed first run (test-after; behaviour pre-existed).

Item 3 (dispute kept until maxRounds): the runWavesIsolated test
"round limits - maxRounds reached" already covered status, branch,
progress and fixer-not-after-final-review, but not exit 1. Added a
CLI test (integration.test.ts, last test): fake claude delegating to
mock-agent-review (dispute), fake pi finding,verdict-open,
maxRounds 2. Asserts exit 1, implemented once, fixer once,
ready-for-human, unmerged, branch kept, committed log has both rounds
(disputed then still-open) and an unresolved terminal. Passed first
run (test-after). Seen but not touched: the finish summary for this
run says "0 completed, 1 failed, 1 need a human" -- the unresolved
ticket appears to be counted in "failed" too. Out of scope here.

Item 4 (minRounds 2): existing "round limits - minRounds 2" test
already checked two rounds, reviewer twice, pass terminal. Added that
the change is on main and no fixer ran. Test-after.

Item 5 (fixer keeps failing tests): strengthened "per-ticket fix -
fixer test failures fail the attempt and ticket retries": exactly 4
fixer runs (2 fix attempts x 2 ticket attempts with --retries 1),
the retried fix prompts carry FIX_FAILURE_TEXT.tests, both attempts
end with a failed terminal, status not ready-for-human, progress
done:false, nothing merged. Test-after.

Item 6 ([x] stays open): the existing test used fixer mode `pass`,
which never marked the pi finding, so it did not test a fixer [x] at
all. Switched to `fix-all,fix-all`, asserted round 1 records
fixerResponse fixed, round 2 verdict still-open, and the fixer runs
again (2 fixer runs). The fixed assertion is red under `pass`.

Docs (no test, docs-only): README `.redeye.json` section now lists
the round steps, the fixer contract, that only the reviewer closes a
finding, reviewer failure, and what each log entry records.
AGENTS.md: note on mock-agent-review fixer modes (`fix-all`).

Final gate: `npm run build && npm test` exit 0, no `not ok`. Lint
clean. No src/ changes were needed: the loop was already correct.

Pre-existing, not touched: `tsc --noEmit -p .` reports type errors
in test files (display.test.ts `never`, integration.test.ts display
stubs missing `setRoundLabel`); esbuild does not type-check, so the
suite still runs.

---
<!-- redeye:entry ticket=adversarial-review:7 attempt=1 outcome=done -->
## 2026-11-20 19:30 -- adversarial-review/07 attempt 1 -- done

Effort: medium. Agent exit: 0. Subagents: 0. Cost: $0.97. Checked items: "With `adversarial` configured, the end-of-run reviewer runs with the review role's provider and model, and the end-of-run fixer runs with the implement role's", "Without `adversarial`, the end-of-run reviewer and fixer run with the run's provider, as today", "With `adversarial` configured and `--no-review`, no end-of-run review runs, but each ticket is still reviewed by the per-ticket loop".

### Agent notes
# Ticket 07: end-of-run review pass uses both roles

The src side was already on the branch: `ReviewPassOpts` has separate
`reviewer`/`fixer` `ReviewRole`s, `runWavesIsolated` builds the
reviewer from `opts.adversarial.review` (else the run role) and the
fixer from the run role (which is the implement role, since
runExecute reads it from resolveRoles). `index.ts` passes
`review: undefined` on `--no-review` and still passes `adversarial`.

No src changes. Added tests in test/review-integration.test.ts
(test-after, the behaviour pre-existed; I confirmed the first test
fails when the reviewer is switched back to the run role):
- adversarial + review on: fake pi (review role, model rev-model)
  runs the ticket round and the end-of-run review; the mock
  (implement role) runs the ticket and the end-of-run fix.
- adversarial + review off: only the ticket round reviews; no
  end-of-run review, fix, or review.md.
- "without adversarial" is covered by the existing AC6.1 test.

---
<!-- redeye:entry ticket=adversarial-review:6 attempt=1 outcome=done -->
## 2026-11-20 19:43 -- adversarial-review/06 attempt 1 -- done

Effort: medium. Agent exit: 0. Subagents: 0. Cost: $2.52. Checked items: none.

### Agent notes
# Ticket 06: resume an interrupted loop

Resume was already on the branch (`detectResume`,
`runAdversarialFromResume`, `addWorktreeForBranch` on
`worktreeQueue`) with in-process tests in
review-integration.test.ts that hand-build the interrupted state
and commit the review log themselves.

Helper: `.redeye/one.sh <suite> '<test name prefix>'` runs one
test (not committed). Run `npm run build` first for CLI tests.

## Item 1 (interrupted run resumes and merges)

Read the item as "a real interrupted run", so added a CLI test
(integration.test.ts, last test): fake pi `finding,hang,...`, wait
until the round 2 reviewer starts, SIGINT, rerun.

Red: the rerun exited 1 with "Working tree is dirty". The loop
appended to `.scratch/<f>/reviews/<ticket>` in the base checkout but
only committed it at terminal points, so an interrupt left it
untracked and the dirty-tree check blocked every later run. Resume
could never happen after a real interrupt.

Fix: the loop commits the log after every entry it appends
(`recordEntry` in `runAdversarialLoop`, via `commitProgress`;
failure is logged, like saveProgress).

Refactor first (own commit): the fresh and resume paths had two
copies of the whole round loop; merged into `runAdversarialLoop`
with a `start` round, so the fix lands once. review-integration
suite green before and after.

Added fake pi response `hang` (test/mock-agent-pi.js).

## Items 2 and 3 (head mismatch / terminal entry start fresh)

Behaviour and tests already existed ("resume - branch head mismatch
starts fresh", "resume - log ends in terminal starts fresh"). These
were test-after, so checked them by mutation: disabling the head
check, and ignoring terminals, each makes its test fail
("ticket agent ran (fresh start)"). Added an assertion to each
that the stale branch's commit is not on main after the run.
No src change.

## Wrap-up

Docs: README `.redeye.json` section explains resume and per-entry
commits; AGENTS.md notes per-entry log commits, the shared
`runAdversarialLoop`, and the fake pi `hang` response.
Final gate: build + `npm test` exit 0, no `not ok`; lint clean.

Left alone: concurrent per-entry commits from tickets in the same
wave can hit git's index.lock, the same risk `saveProgress` already
has. A failed commit is logged, not fatal.

---
