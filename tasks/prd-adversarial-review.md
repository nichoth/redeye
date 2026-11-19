# PRD: Per-ticket cross-model adversarial review

Source: `.scratch/adversarial-review/spec.md` (status
ready-for-agent). The stories below are a finer split of tickets
01-07 in `.scratch/adversarial-review/issues/`. Each story names the
ticket it comes from. Stories are in dependency order: implement
them top to bottom.

## Introduction

redeye implements each ticket with one agent on one model. The only
check between that agent's work and the integration branch is the
test command, and the test command only checks what the agent chose
to test. If a model misreads the ticket, or writes a bug that its own
tests never exercise, that work gets merged.

The existing end-of-run review pass does not close this gap. It runs
once, after the last wave, when the work is already merged and later
tickets are built on top of it. It also uses the same model that
wrote the code, so it tends to share that model's blind spots.

This feature adds an optional **adversarial loop** that runs per
ticket. A second model (the **review** role) reviews each ticket's
branch before it can merge. The model that wrote the ticket (the
**implement** role) must fix each finding or dispute it in writing.
Only the reviewer can close a finding. The loop is configured in a
new `.redeye.json` file at the repo root. Without that configuration,
redeye behaves exactly as it does today.

### Terms

- **Role string:** a provider command followed by flags, written the
  same way as redeye's own command line. Examples:
  `"pi -m tiiny/Qwen/Qwen3.6-35B-A3B-turbo"`,
  `"claude -m opus --effort high"`.
- **Round:** one review step, then (if findings are open and rounds
  remain) one fix step and a re-run of the test gate.
- **Finding:** one checklist item the reviewer writes
  (`- [ ] summary` with indented detail).
- **Verdict:** the reviewer's ruling on a finding that was open
  from the previous round: confirmed fixed, withdrawn, or still
  open.
- **Dispute:** the fixer leaves a finding unchecked and writes its
  reason in its notes file.
- **Ticket review log:** an append-only markdown file per ticket
  that records every round.
- **Terminal entry:** a log entry that records a pass, an unresolved
  stop or a failure.

## Goals

- No ticket merges unchecked when `adversarial` is configured: every
  ticket gets at least `minRounds` reviews by the review model.
- The author model cannot close a finding against its own code. Only
  the reviewer can confirm a fix or withdraw a finding.
- A ticket that does not converge within `maxRounds` becomes
  `ready-for-human` with its branch kept, instead of being merged or
  thrown away.
- Every round is recorded in a plain markdown log that is committed
  with the rest of redeye's bookkeeping.
- An interrupted loop resumes at the next round without re-running
  implementation.
- With no `.redeye.json`, or no `adversarial` key in it, agent
  invocations and behavior are identical to today.

## Acceptance criteria that apply to every story

Each story's checklist ends with "Standard checks pass". That means
all of the following:

- `npm run lint` passes
- `npm run build` passes (this includes `tsc` type declarations)
- `npm test` passes (run after `npm run build`, since the CLI tests
  run `dist/index.js`)
- Any new `src/<name>.ts` module is added to the second esbuild call
  in `build-esm` in `package.json`
- Any new `test/<name>.test.ts` file is added to `TESTS` in
  `scripts/test.sh`
- Any new `FAKE_*` environment variable a test sets is added to that
  test file's key list (`FAKE_CLAUDE_KEYS`, `FAKE_ENV_KEYS` or
  `ENV_KEYS`)
- Tests assert observable results (ticket `**Status:**`, merged or
  not, branch exists or not, `progress.md`, review log contents,
  which role got which prompt, exit code). They do not assert prompt
  wording, log wording or internal call order.

## User Stories

### US-001: Parse role strings
*From ticket 01.*

**Description:** As a redeye user, I want to write the implement and
review roles as the same command strings I would type after
`redeye`, so that I do not have to learn a second config syntax.

**Acceptance Criteria:**
- [ ] New module `src/config.ts` exports a role-string parser
- [ ] The parser uses the same option definitions as the yargs run
  command. The definitions are shared, not copied, so the two
  cannot drift
- [ ] `"claude -m opus --effort high --max-turns 40
  --prefer-subagent"` parses to provider `claude`, model `opus`,
  effort `high`, max turns 40, prefer-subagent true
- [ ] `--model` works as the long form of `-m`
- [ ] Any flag other than `-m`/`--model`, `--effort`, `--max-turns`
  and `--prefer-subagent` is rejected with an error
- [ ] An extra positional (for example `"claude opus"`) is rejected
- [ ] An empty string is rejected
- [ ] `src/config.ts` has no value imports from
  `src/orchestrator.ts`. `AGENTS.md`'s module-boundaries list
  names `config`
- [ ] Pure tests in new `test/config.test.ts`
- [ ] Standard checks pass

### US-002: Load and validate `.redeye.json`
*From ticket 01.*

**Description:** As a redeye user, I want a malformed `.redeye.json`
to stop the run before anything is created, so that a typo cannot
start a run with the wrong models.

**Acceptance Criteria:**
- [ ] `src/config.ts` exports a loader that reads `.redeye.json`
  from the repo root
- [ ] A missing file returns "loop off". So does a file with no
  `adversarial` key
- [ ] When `adversarial` is present, `implement` and `review` are
  required, and each must parse with the US-001 parser
- [ ] `maxRounds` defaults to 3 and `minRounds` defaults to 1
- [ ] A `maxRounds` or `minRounds` that is not a positive integer is
  rejected. So is a `minRounds` greater than `maxRounds`
- [ ] `runExecute` in `src/index.ts` loads the config once, before
  `resolveExecutable` and before any git or worktree work
- [ ] CLI test: a `.redeye.json` that is not valid JSON exits 2, and
  no branch or worktree is created
- [ ] CLI test: a role string with an unsupported flag exits 2, and
  no branch or worktree is created
- [ ] Errors go through `formatErrorMessage` (no stack trace)
- [ ] Existing integration tests still pass unchanged (no config
  means today's behavior)
- [ ] The README has a short `.redeye.json` section that describes
  the file's shape and the role-string syntax
- [ ] Standard checks pass

### US-003: Show the config in `--dry-run`
*From ticket 01.*

**Description:** As a redeye user, I want `--dry-run` to show the
implement and review roles and the round limits, so that I can check
my config without spending tokens.

**Acceptance Criteria:**
- [ ] With `adversarial` configured, `--dry-run` prints the
  implement role string, the review role string, `maxRounds` and
  `minRounds`
- [ ] With no `adversarial` key, `--dry-run` output is unchanged
- [ ] The CLI test checks that the configured values appear in the
  output. It does not match surrounding wording
- [ ] Standard checks pass

### US-004: A bare `redeye` uses the implement role
*From ticket 02.*

**Description:** As a redeye user with `adversarial` configured, I
want a bare `redeye` to use the `implement` command, and a provider
given on the command line to override it, so that I do not repeat
the provider on every run but can still try another model.

**Acceptance Criteria:**
- [ ] The run command's provider positional becomes optional
  (`$0 [provider] [turns]`)
- [ ] With `adversarial` configured and no provider argument, tickets
  run with the implement role's provider and model
- [ ] With a provider argument, that provider is used for the run,
  and one line is logged saying it overrides `implement`
- [ ] `--dry-run` says when a command-line provider overrides
  `implement`
- [ ] With no config and no provider, the usage error is unchanged
  (exit 1 with help text)
- [ ] Every yargs command handler still returns a promise
- [ ] The resolved review role is passed through to the
  `runWavesIsolated` call site, but no reviewer is started yet
- [ ] The README usage section shows the provider as optional when
  `.redeye.json` sets `implement`
- [ ] Standard checks pass

### US-005: Merge role-string flags with run-wide CLI flags
*From ticket 02.*

**Description:** As a redeye user, I want flags inside a role string
to win for that role, and CLI flags to fill in whatever the string
leaves out, so that I can set run-wide defaults on the command line.

**Acceptance Criteria:**
- [ ] `src/config.ts` exports a pure function that merges a parsed
  role with the run's CLI options
- [ ] A flag set in the role string wins over the same CLI flag. For
  example, a role with `--effort high` and the CLI flag
  `--effort low` gives `high` for that role
- [ ] A flag the role string leaves out takes the CLI value
- [ ] The merge applies separately to the implement and review roles
- [ ] Pure tests in `test/config.test.ts`
- [ ] Standard checks pass

### US-006: Preflight both roles and warn on same model
*From ticket 02.*

**Description:** As a redeye user, I want both role executables
checked at startup, and a warning when both roles resolve to the
same model, so that I notice a missing binary or a lost cross-model
check before a run starts.

**Acceptance Criteria:**
- [ ] The provider preflight (`resolveExecutable`) checks both the
  implement and review executables
- [ ] CLI test: a missing review executable exits 2 before any branch
  is created
- [ ] When implement and review have the same provider basename and
  the same model, one warning is logged at startup and the run
  continues
- [ ] The same-model warning also appears in `--dry-run`
- [ ] On the in-place path (outside a git repo) with `adversarial`
  set, redeye logs that the loop is skipped and otherwise runs as
  today
- [ ] Standard checks pass

### US-007: `setup()` writes the `adversarial` key
*From ticket 03.*

**Description:** As a redeye user with an existing `.redeye.json`, I
want `init` to merge the `adversarial` key into the file and keep my
other keys, so that nothing I configured is lost.

**Acceptance Criteria:**
- [ ] `SetupOpts` in `src/setup.ts` gains an optional adversarial
  config
- [ ] Given that config, `setup()` writes `.redeye.json` with
  `implement`, `review`, `maxRounds` and `minRounds`. The two round
  values are written explicitly, even when they are the defaults
- [ ] Given that config and an existing `.redeye.json` with other
  keys, `setup()` keeps those keys and adds `adversarial`
- [ ] Without that config, `setup()` leaves an existing
  `.redeye.json` untouched, and creates none when it is absent
- [ ] Tests in `test/setup.test.ts`
- [ ] Standard checks pass

### US-008: `redeye init` asks about adversarial loops
*From ticket 03.*

**Description:** As a redeye user, I want `redeye init` to ask
whether I want adversarial loops and for the two commands, so that I
can turn the feature on without writing config by hand.

**Acceptance Criteria:**
- [ ] After the tracker question, `init` asks a yes/no question that
  defaults to no
- [ ] On yes, it asks for the implement command, then the review
  command, as free text
- [ ] Each answer is validated with the US-001 parser, and an invalid
  string is asked for again
- [ ] On yes, the answers are passed to `setup()` as the US-007
  option. On no, the option is not passed
- [ ] The prompts are not tested, like the existing tracker prompt
- [ ] The README mentions the new `init` question
- [ ] Standard checks pass

### US-009: Ticket review log format
*From ticket 04, with fields from tickets 05 and 06.*

**Description:** As a redeye user, I want a per-ticket review log
that records every round, so that I can audit why a ticket passed or
stopped.

**Acceptance Criteria:**
- [ ] `src/review.ts` exports render and parse functions for the
  ticket review log
- [ ] The log path is
  `.scratch/<feature>/reviews/<ticket file name>`
- [ ] Each entry opens with a `<!-- redeye:... -->` sentinel line,
  following the `review.md` and `learnings.md` conventions
- [ ] A round entry records the round number, both role strings, the
  branch head reviewed, and every finding with its verdict. It also
  has optional fields for the fixer's response to each finding
  (fixed, or disputed with a reason), the test gate result, and the
  branch head after the fix
- [ ] A terminal entry records pass, unresolved or failed
- [ ] Render then parse returns the same entries
- [ ] Sentinel text inside free-text fields is neutralized, so one
  entry cannot forge another
- [ ] The parser drops malformed entries instead of throwing
- [ ] Pure tests in `test/review.test.ts`
- [ ] Standard checks pass

### US-010: Fake `pi` provider for role tests
*From ticket 04.*

**Description:** As a redeye developer, I want a fake `pi` wrapper
next to `fake-claude`, so that one test run can give implement and
review different providers and record which role ran.

**Acceptance Criteria:**
- [ ] New `test/fake-pi/pi` is an `sh` wrapper around a mock agent
  script. Its basename makes `spawnAgent` take the pi branch
- [ ] The mock records which provider was invoked and with which
  model, in a form a test can read back
- [ ] New `FAKE_*` variables script the reviewer's output for each
  round: an open finding, `No findings.`, unparseable output, or a
  non-zero exit
- [ ] The new keys are added to `ENV_KEYS` in
  `test/review-integration.test.ts`
- [ ] Standard checks pass

### US-011: One review step gates each ticket
*From ticket 04.*

**Description:** As a redeye user, I want every ticket reviewed by
the review model at least once before it is marked done, so that no
ticket merges unchecked.

**Acceptance Criteria:**
- [ ] In `runTicketAttempt`, after `runTestGate` passes and before
  the attempt reports the ticket ready to merge, a round runner in
  `src/review.ts` runs the review step in the ticket's worktree
- [ ] The round runner takes `spawnAgent` and the process registry as
  injected deps, and imports only types from `src/orchestrator.ts`
- [ ] The reviewer prompt is built from the ticket body, its spec,
  and the diff from the merge base to the ticket branch head (minus
  `.scratch/`). It reuses `CONFINEMENT_RULES` and the read-only rules
  from `src/rules.ts`
- [ ] The reviewer runs with the review role's provider and model.
  Implementation runs with the implement role's
- [ ] The reviewer process joins existing process tracking, so the
  signal handler kills it
- [ ] `No findings.` lets the ticket merge as today. The log has one
  round and a pass entry
- [ ] A reviewer that exits non-zero, times out, or writes
  unparseable findings after its retries fails the attempt. The
  ticket gets `done:false` in `progress.md` and goes through the
  existing ticket retry policy
- [ ] Until US-012 lands, open findings also fail the attempt
- [ ] The ticket review log is committed with the other bookkeeping
  files at every terminal point (`git add --force`)
- [ ] With no `adversarial` key, a run's agent invocations match
  today's, and no reviewer is spawned
- [ ] Integration tests in `test/review-integration.test.ts` use
  `runWavesIsolated` with the mock agents
- [ ] Standard checks pass

### US-012: Unresolved outcome
*From ticket 04.*

**Description:** As a redeye user, I want a ticket that the reviewer
will not pass to become `ready-for-human` with its branch kept, so
that I can pick up where the models stopped.

**Acceptance Criteria:**
- [ ] `TicketOutcome` gains an `unresolved` kind
- [ ] For now, findings still open after the review step make the
  ticket unresolved (US-016 makes this "after `maxRounds`")
- [ ] An unresolved ticket's `**Status:**` becomes `ready-for-human`
- [ ] `progress.md` records it with `done:false`
- [ ] Its branch is kept, its worktree is removed, and it is not
  merged
- [ ] `runTicketAttempts` does not retry it in this run
- [ ] A ticket blocked by an unresolved ticket is reported as blocked
  and does not run (through the existing non-agent-ticket path)
- [ ] The run exits 1
- [ ] The log ends with an unresolved entry
- [ ] `AGENTS.md`: the "review pass is advisory" invariant is narrowed
  to the end-of-run pass. A new invariant says the per-ticket loop
  is a gate whose errors decide the ticket outcome. The ticket review
  log is described under "Logs on disk" next to `learnings.md` and
  `review.md`
- [ ] Standard checks pass

### US-013: Show the round and role in the status display
*From tickets 04 and 05.*

**Description:** As a redeye user, I want the status display to show
which round a ticket is in and which role is running, so that a long
loop does not look hung.

**Acceptance Criteria:**
- [ ] The `Display` interface in `src/display.ts` gains a way to set
  a running ticket's round label
- [ ] While the loop runs, the ticket's row stays in the running
  state
- [ ] The label shows the step, the round and `maxRounds`, for
  example `review 1/3` or `fix 2/3`
- [ ] `StatusDisplay` and `PlainDisplay` both implement it
- [ ] Test in `test/display.test.ts`: after a round label is set, the
  ticket is still in the running state and the label includes the
  round numbers. The test does not match the exact rendered text
- [ ] Standard checks pass

### US-014: Fix step with the implement role
*From ticket 05.*

**Description:** As a redeye user, I want the implement model to fix
or dispute each open finding and then pass the tests again, so that
review findings turn into real changes.

**Acceptance Criteria:**
- [ ] When findings are open and rounds remain, the implement role
  runs as the fixer in the ticket's worktree. It uses the existing
  `runFixer` contract: fix with `/tdd` and mark `[x]`, or dispute by
  leaving the finding unchecked and writing the reason in its notes
  file
- [ ] The fixer process joins existing process tracking
- [ ] After the fix step, the test gate runs again in the worktree
- [ ] On a test failure, the fixer runs again with the failure in its
  prompt (the existing fix-retry). When those attempts run out, the
  attempt fails and the existing ticket retry policy applies
- [ ] The round's log entry records the fixer's response to each
  finding, the test gate result, and the branch head after the fix
- [ ] The fake agent can script fix, dispute and failing-tests
  behavior through new `FAKE_*` keys
- [ ] Integration test: a fixer whose changes keep failing the test
  gate fails the attempt, and the ticket goes through the retry path
- [ ] Standard checks pass

### US-015: Verdicts on open findings
*From ticket 05.*

**Description:** As a redeye user, I want only the reviewer to be
able to close a finding, so that the author model cannot wave away
real problems with its own code, and a hallucinated finding can
still be withdrawn.

**Acceptance Criteria:**
- [ ] The next round's reviewer prompt includes the open findings and
  the fixer's response to each one
- [ ] For each finding that was open before, the reviewer gives
  exactly one verdict: confirmed fixed, withdrawn, or still open. It
  may also add new findings
- [ ] Reviewer output that is missing a verdict for a previously open
  finding counts as unparseable
- [ ] `No findings.` is accepted only when no prior findings are open
- [ ] A fixer's `[x]` does not close a finding. A dispute does not
  close one either
- [ ] Integration test: a finding the fixer marks `[x]` stays open
  when the next reviewer keeps it open
- [ ] Integration test: a finding the fixer fixes and the next
  reviewer confirms lets the ticket merge after two rounds, and the
  log shows both rounds
- [ ] Integration test: a finding the fixer disputes and the next
  reviewer withdraws lets the ticket merge
- [ ] Standard checks pass

### US-016: Round limits
*From ticket 05.*

**Description:** As a redeye user, I want to set `maxRounds` and
`minRounds`, so that I can trade cost against scrutiny per project.

**Acceptance Criteria:**
- [ ] A ticket passes when a round ends with nothing open and at
  least `minRounds` rounds have run
- [ ] With `minRounds` 2, a clean first round is followed by a second
  review before the ticket merges
- [ ] When the review in round `maxRounds` leaves findings open, the
  ticket is unresolved (US-012). The fixer does not run after that
  final review
- [ ] Integration test: a disputed finding the reviewer keeps open
  until `maxRounds` makes the ticket `ready-for-human`, unmerged,
  with its branch kept, and the run exits 1
- [ ] The README's `.redeye.json` section documents the round rules
- [ ] Standard checks pass

### US-017: Add a worktree on an existing branch
*From ticket 06.*

**Description:** As a redeye developer, I want a queued way to
recreate a worktree on a branch that already exists, so that resume
can reuse an interrupted ticket's branch safely.

**Acceptance Criteria:**
- [ ] `src/worktree.ts` exports a function that adds a worktree for
  an existing branch without resetting it
- [ ] It runs on `worktreeQueue`
- [ ] Test in `test/worktree.test.ts`: after the call, the worktree
  is checked out at the branch's existing head
- [ ] Standard checks pass

### US-018: Resume an interrupted loop
*From ticket 06.*

**Description:** As a redeye user, I want an interrupted run to
resume a ticket's adversarial loop at the next round, so that a
crash does not throw away finished review work.

**Acceptance Criteria:**
- [ ] In `runTicketAttempt`, before `createWorktree`, when the
  ticket's branch already exists, redeye reads the ticket review log
- [ ] Resume happens when the log's last recorded branch head matches
  the branch head and the log has no terminal entry. redeye then
  recreates the worktree with US-017 and starts the round runner at
  the next round, skipping implementation
- [ ] In every other case, the existing behavior holds: the stale
  worktree and branch are removed and the ticket starts fresh
- [ ] Integration test: a run interrupted after a recorded round
  resumes at the next round without running implementation again,
  and the ticket can pass and merge
- [ ] Integration test: a branch head that no longer matches the log
  starts fresh, and implementation runs again
- [ ] Integration test: a log that ends in a terminal entry starts
  fresh
- [ ] Standard checks pass

### US-019: Split the end-of-run review pass into two roles
*From ticket 07. This is a prefactor with no change in behavior.*

**Description:** As a redeye developer, I want `ReviewPassOpts` to
carry separate reviewer and fixer roles, so that the end-of-run pass
can run cross-model.

**Acceptance Criteria:**
- [ ] `ReviewPassOpts` replaces its single `agentCmd`/`model` with
  reviewer and fixer roles (provider, model, effort and related
  options)
- [ ] Both roles default to the run's provider
- [ ] `runReviewer`, `runFixer` and `runReviewPass` use their own
  role. Each role's effort ladder comes from its own provider
  (`runWithRetries` gets the role's command)
- [ ] Existing tests in `test/review-pass.test.ts` and
  `test/review-integration.test.ts` pass with only the needed
  changes to how options are built
- [ ] Standard checks pass

### US-020: The end-of-run pass uses both configured roles
*From ticket 07.*

**Description:** As a redeye user with `adversarial` configured, I
want the end-of-run review pass to use the review model as its
reviewer and the implement model as its fixer, and `--no-review` to
skip only that pass, so that the final pass is cross-model too and
the per-ticket loop cannot be disabled by accident.

**Acceptance Criteria:**
- [ ] With `adversarial` configured, `runWavesIsolated` passes the
  review role as the end-of-run reviewer and the implement role as
  the end-of-run fixer
- [ ] Without `adversarial`, the reviewer and fixer run with the run's
  provider, as today
- [ ] With `adversarial` and `--no-review`, no end-of-run review
  runs, but every ticket still goes through the per-ticket loop
- [ ] Standard checks pass

## Functional Requirements

### Configuration
- FR-1: redeye reads an optional `.redeye.json` at the repo root
  once per run, before the provider preflight and before any git or
  worktree work.
- FR-2: A missing file, or a file without an `adversarial` key,
  turns the loop off. Every code path is then unchanged.
- FR-3: When `adversarial` is present, it must have `implement` and
  `review` role strings. `maxRounds` (default 3) and `minRounds`
  (default 1) are optional positive integers, and `minRounds` must
  be no greater than `maxRounds`.
- FR-4: A role string is a provider command followed only by
  `-m`/`--model`, `--effort`, `--max-turns` and `--prefer-subagent`,
  parsed with the run command's option definitions. Anything else is
  a config error.
- FR-5: Invalid JSON, a wrong `adversarial` shape, or an invalid role
  string exits 2 through `formatErrorMessage`, before any branch or
  worktree is created.
- FR-6: Flags in a role string win for that role. Run-wide CLI flags
  fill in the flags the string leaves out.

### Running
- FR-7: With the loop on, the provider positional is optional. A
  bare `redeye` uses `implement`. A provider on the command line
  overrides `implement` for the run and logs one line saying so.
- FR-8: With no config and no provider, the usage error is
  unchanged (exit 1 with help text).
- FR-9: The preflight checks both role executables.
- FR-10: When both roles have the same provider basename and model,
  redeye logs one warning at startup and in `--dry-run`, and still
  runs.
- FR-11: `--dry-run` prints both role strings, which one a
  command-line provider overrides, `maxRounds`, `minRounds`, and the
  same-model warning if it applies.
- FR-12: On the in-place path (outside a git repo), the loop does
  not run, and redeye logs that it was skipped.

### `redeye init`
- FR-13: After the tracker question, `init` asks a yes/no question
  that defaults to no. On yes, it asks for the implement and review
  commands, validates each with the role-string parser, and asks
  again on an invalid string.
- FR-14: On yes, `setup()` writes `adversarial` with explicit
  `maxRounds` and `minRounds`, merging into an existing
  `.redeye.json` and keeping its other keys. On no, `.redeye.json`
  is not created or modified.

### The loop
- FR-15: The loop runs inside a ticket attempt, in the ticket's
  worktree, after the test gate passes and before the attempt reports
  the ticket ready to merge.
- FR-16: Tickets in a wave run their loops concurrently under
  `--concurrency`. Every reviewer and fixer process is tracked so the
  signal handler can kill it.
- FR-17: Review step: a fresh review-role process gets the ticket
  body, its spec, the merge-base-to-head diff (minus `.scratch/`) and
  the open log entries. It can read the repo and run the tests, but
  it must not change anything. It writes findings in the existing
  checklist form, with one verdict for each previously open finding.
- FR-18: Fix step: runs only when findings are open and the round is
  not `maxRounds`. The implement role fixes with `/tdd` and marks
  `[x]`, or disputes in its notes file. The test gate then re-runs,
  with the existing fix-retry on failure.
- FR-19: Only a reviewer's "confirmed fixed" or "withdrawn" verdict
  closes a finding.
- FR-20: Pass: a round ends with nothing open after at least
  `minRounds` rounds. The ticket merges as today.
- FR-21: Unresolved: findings remain open after the review in round
  `maxRounds`. The ticket becomes `ready-for-human`, gets
  `done:false` in `progress.md`, keeps its branch, has its worktree
  removed, is not retried, its dependents show as blocked, and the
  run exits 1.
- FR-22: Failed: the reviewer exits non-zero, times out or writes
  unparseable output after its retries, or the fixer cannot get the
  tests passing. The attempt fails with `done:false`, and the
  existing ticket retry policy applies.

### Log, resume and end-of-run pass
- FR-23: Each ticket has an append-only review log at
  `.scratch/<feature>/reviews/<ticket file name>`, with sentinel-led
  entries, neutralized sentinel text, and a parser that drops
  malformed entries. It is committed with `git add --force` at every
  terminal point.
- FR-24: When a ticket's branch already exists, its log has no
  terminal entry, and the log's last branch head matches the branch
  head, redeye recreates the worktree on that branch and resumes at
  the next round. Otherwise it starts fresh, as today.
- FR-25: With the loop on, the end-of-run review pass uses the review
  role as reviewer and the implement role as fixer. `--no-review`
  skips only that pass.

## Non-Goals (Out of Scope)

- Test-backed disputes, where a disputed finding stands only if the
  reviewer produces a failing test. This needs a scratch worktree the
  reviewer can write to, and is planned as a follow-up.
- More than two roles, such as a separate fixer model or several
  reviewers per round.
- Automatically steering the reviewer away from the author's model
  family. There is only the same-model warning.
- A CLI flag to turn the loop off for one run. Removing the
  `adversarial` key is the only off switch.
- Moving existing CLI flags into `.redeye.json`.
- Changes to the GitHub Issues tracker flow.
- Cost reporting for the loop beyond what the existing stats already
  collect from each agent run.

## Technical Considerations

- **Module boundaries.** `src/config.ts` has no value imports from
  `src/orchestrator.ts`. `src/review.ts` keeps taking `spawnAgent`
  and the process registry as injected deps, and imports only types
  from the orchestrator. Update the module-boundaries list in
  `AGENTS.md`.
- **Nothing is created before the run is worth starting.** Config
  loading and validation happen before `prepareIntegrationBranch`,
  next to the zero-ready stop, the preflight and the dirty-tree
  check.
- **Prompt rules.** New prompt rules go in `src/rules.ts`, and every
  new prompt keeps `CONFINEMENT_RULES`: agents stay in their worktree
  and never push.
- **Worktree operations.** Every worktree create, remove and branch
  delete, including the US-017 resume path, runs on `worktreeQueue`.
- **Exit codes keep their meaning.** An unresolved ticket is an
  unfinished ticket, so the run exits 1, not 2.
- **Gate, not advisory.** Unlike learnings, stats and the end-of-run
  pass, the per-ticket loop decides ticket outcomes. `AGENTS.md`
  must say so (US-012).
- **Test seams.** The main seam is `runWavesIsolated` with mock agents
  in `test/review-integration.test.ts`, with `test/fake-pi/pi` next
  to `test/fake-claude/claude`. CLI behavior goes through `spawnCli`
  in `test/integration.test.ts`. Config writing goes through
  `setup()` in `test/setup.test.ts`. Parsers get pure tests.
- **Background.** The design follows "Verification-Driven
  Development" (builder and cynical reviewer in a loop, with a fresh
  reviewer context each turn) and the cross-model finder/verifier
  design of `bluesky-social/roast`. Research is in
  `../adversary/adversarial-review-tools-report.md`. Independence
  between author and reviewer matters more than the number of
  reviewers. Extra debate rounds have diminishing returns, which is
  why `maxRounds` defaults to 3.

## Success Metrics

- With `adversarial` configured, every merged ticket has a review log
  with at least `minRounds` rounds and a pass entry.
- No ticket reaches the wave merge with an open finding.
- With no `adversarial` key, the existing test suite passes without
  changes to its assertions, and agent invocations match today's.
- An interrupted run that is resumed does not re-run implementation
  for a ticket whose log matches its branch head.
- A config error never leaves a branch or worktree behind.

## Open Questions

1. **Retry after a failed loop.** When a loop fails and the ticket
   retry policy starts a new attempt, does the new attempt append to
   the same review log with round numbers starting again at 1? Or
   does it start a new log section, or truncate the log? Resume keys
   off "no terminal entry", so a failed attempt has to write a
   terminal entry before the retry starts.
2. **Fixer timeout.** The spec says a reviewer timeout is a failure.
   The existing invariant says a timed-out implementing agent is not
   a failure: its changes are auto-committed and go through the test
   gate. Does a timed-out fixer follow the invariant (auto-commit,
   then the test gate), or does it fail the attempt?
3. **Provider-specific flags in role strings.** `--max-turns` and
   `--prefer-subagent` warn and are dropped on providers without
   them. Should `"pi --max-turns 40"` in `.redeye.json` also warn and
   drop, or be a config error, since the config is checked up front?
4. **Whether to review an unchanged branch.** If the fixer disputes
   every finding and makes no commits, the next round reviews the
   same branch head. Is that intended, or should a round with no new
   commits skip straight to verdicts on the disputes? The current
   reading is that the reviewer runs normally.
