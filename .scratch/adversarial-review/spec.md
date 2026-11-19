# Spec: Per-ticket cross-model adversarial review

**Status:** ready-for-agent

## Problem Statement

redeye implements each ticket with one agent and one model, and the
only thing standing between that agent's work and the integration
branch is the test command. The test command checks what the agent
chose to test. A model that misreads the ticket, or writes code with a
bug its own tests never exercise, gets merged.

The existing review pass does not close this gap. It runs once, after
the last wave, over everything merged in the run. By then the work is
already merged and later tickets have been built on top of it. It also
runs on the same model that wrote the code, so it tends to share that
model's blind spots.

As a redeye user, I want every ticket checked by a different model
before it can be marked done. The author model should have to answer
that model's objections, and none of this should change how redeye
behaves for anyone who has not asked for it.

## Solution

An optional **adversarial loop** that runs per ticket, configured in a
new `.redeye.json` file at the repo root.

When `.redeye.json` has an `adversarial` key, each ticket that passes
the test gate goes through at least one adversarial round before it can
merge:

1. The **review** model reads the ticket, the spec and the ticket
   branch's diff in a fresh process, and writes findings. It can read
   the repo and run the tests, but it cannot change anything.
2. The **implement** model, the same one that wrote the ticket, acts
   as the fixer. It fixes each finding with `/tdd`, or disputes it with
   a written reason.
3. The test gate runs again.
4. The next round's reviewer sees the record of open findings and the
   fixer's responses. For each one it confirms the fix, withdraws the
   finding, or keeps it open, and it may add new findings.

A ticket passes once a round ends with no open findings and at least
`minRounds` rounds have run. The reviewer has the final say on every
dispute: only the reviewer can withdraw a finding. If `maxRounds` is
reached with findings still open, the ticket goes to `ready-for-human`
and is not merged.

Every round is recorded in a per-ticket review log, a plain markdown
file under the feature's `.scratch/` directory, so the whole exchange
can be read, diffed and committed like any other redeye bookkeeping.

The `implement` and `review` values are command strings in the same
form as redeye's own command line, for example
`"pi -m tiiny/Qwen/Qwen3.6-35B-A3B-turbo"` or
`"claude -m opus --effort high"`. Different models and different
harnesses can be paired freely.

With no `adversarial` key, or no `.redeye.json` at all, redeye behaves
exactly as it does today.

## User Stories

1. As a redeye user, I want `redeye init` to ask whether I want
   adversarial loops, so that I can turn the feature on without writing
   config by hand.
2. As a redeye user who answers yes in `init`, I want to be asked for
   the implement and review commands and have them written to
   `.redeye.json`, so that the next run uses them.
3. As a redeye user who answers no in `init`, I want `.redeye.json`
   left without an `adversarial` key, so that redeye keeps working
   exactly as before.
4. As a redeye user with an existing `.redeye.json`, I want `init` to
   merge the `adversarial` key into it and keep my other keys, so that
   nothing I configured is lost.
5. As a redeye user, I want to write the implement and review roles as
   the same command strings I would type after `redeye`, so that I do
   not learn a second config syntax.
6. As a redeye user with `adversarial` configured, I want a bare
   `redeye` to use the `implement` command, so that I do not repeat the
   provider on every run.
7. As a redeye user, I want a provider given on the command line to
   override `implement` for that run, so that I can try another model
   without editing config.
8. As a redeye user, I want redeye to warn at startup when `implement`
   and `review` resolve to the same provider and model, so that I notice
   when I have lost the cross-model check.
9. As a redeye user, I want a malformed `.redeye.json`, or a role
   string with an unsupported flag, to stop the run before anything is
   created, so that a typo cannot launch a run with the wrong models.
10. As a redeye user, I want every ticket reviewed by the review model
    at least once before it is marked done, so that no ticket merges
    unchecked.
11. As a redeye user, I want the fixer to dispute a finding it believes
    is wrong, with a reason, so that a hallucinated finding does not
    force a bad change.
12. As a redeye user, I want only the reviewer to be able to withdraw a
    disputed finding, so that the author model cannot wave away real
    problems with its own code.
13. As a redeye user, I want a ticket that cannot converge within
    `maxRounds` to become `ready-for-human` with its branch kept, so
    that I can pick up where the models stopped.
14. As a redeye user, I want to set `maxRounds` and `minRounds` in
    `.redeye.json`, so that I can trade cost against scrutiny per
    project.
15. As a redeye user, I want a per-ticket review log that records every
    round's findings, fixes, disputes and verdicts, so that I can audit
    why a ticket passed or stopped.
16. As a redeye user, I want an interrupted run to resume a ticket's
    adversarial loop at the next round, so that a crash does not throw
    away finished review work.
17. As a redeye user, I want the status display to show which round a
    ticket is in and which role is running, so that a long loop does
    not look hung.
18. As a redeye user, I want `--dry-run` to show the implement and
    review roles and the round limits, so that I can check config
    without spending tokens.
19. As a redeye user with `adversarial` configured, I want the
    end-of-run review pass to use the review model as its reviewer and
    the implement model as its fixer, so that the final pass is
    cross-model too.
20. As a redeye user, I want `--no-review` to keep skipping only the
    end-of-run review pass, so that the per-ticket loop cannot be
    disabled by accident.

## Implementation Decisions

### Configuration

- New optional file `.redeye.json` at the repo root, read once at
  startup, before any git or worktree work and before the provider
  preflight. This keeps the existing invariant that a run creates
  nothing until it is worth starting.
- Shape:

  ```json
  {
    "adversarial": {
      "implement": "pi -m tiiny/Qwen/Qwen3.6-35B-A3B-turbo",
      "review": "claude -m opus --effort high",
      "maxRounds": 3,
      "minRounds": 1
    }
  }
  ```

- `implement` and `review` are required when `adversarial` is
  present. `maxRounds` defaults to 3, `minRounds` defaults to 1, both
  must be positive integers, and `minRounds` must not exceed
  `maxRounds`.
- A role string is a provider command followed by flags, parsed with
  the same option definitions as the run command. The allowed flags
  are `-m`/`--model`, `--effort`, `--max-turns` and `--prefer-subagent`.
  Any other flag or extra positional is a config error. Flags inside a
  role string win for that role. Run-wide CLI flags fill in whatever
  the string leaves out.
- A missing file or a missing `adversarial` key means the loop is off
  and every code path is unchanged. A file that is not valid JSON, an
  `adversarial` value of the wrong shape, or an invalid role string is
  a runtime error: exit 2 through `formatErrorMessage`, before any
  branch or worktree is created.
- When the loop is on, the run command's provider positional becomes
  optional. A bare `redeye` uses `implement`. A provider given on the
  command line overrides `implement` for that run and logs one line
  saying so. With no config and no provider, the usage error is
  unchanged.
- The provider preflight checks both role executables.
- If `implement` and `review` resolve to the same provider basename
  and the same model, redeye logs one warning at startup and runs
  anyway.

### `redeye init`

- After the tracker question, `init` asks a yes/no question, default
  no: whether to run an adversarial review loop on each ticket.
- On yes, it asks for the implement command and the review command
  (free-text input), validates both with the same role-string parser,
  and re-asks on an invalid string. It writes the `adversarial` key
  with explicit `maxRounds` and `minRounds` defaults, merging into an
  existing `.redeye.json` and keeping its other keys.
- On no, it does not create or modify `.redeye.json`.
- The file-writing part lives in `setup()` as a new option, so it can
  be tested without the interactive prompt.

### Where the loop runs

- The loop runs inside a ticket attempt, in the ticket's worktree,
  after the test gate passes and before the attempt reports the ticket
  ready to merge. A ticket reaches the wave merge only after the loop
  passes.
- Tickets in a wave run their loops concurrently under the existing
  `--concurrency` pool. Every reviewer and fixer process joins the
  existing process tracking, so the signal handler kills them.
- The in-place path (outside a git repo) has no test gate and no
  review today. It also has no adversarial loop. If `adversarial` is
  set there, redeye logs that the loop is skipped.

### A round

- **Review step.** The review role runs in a fresh process with a
  prompt built from the ticket body, its spec, the diff from the merge
  base to the ticket branch head (excluding `.scratch/`, as the
  existing reviewer does), and the open entries of the ticket review
  log. It shares the read-only rules and the confinement rules from
  `rules.ts`. It writes its verdicts and findings to the findings file
  in the existing checklist form (`- [ ] summary` with indented
  detail). For each open finding from the previous round it must give
  one of three verdicts: confirmed fixed, withdrawn, or still open.
  `No findings.` is valid only when no prior findings are open.
- **Fix step.** Runs only when findings are open. The implement role
  gets the open findings and the reviewer's detail, fixes each with
  `/tdd`, and marks it `[x]` when fixed. To dispute a finding, it
  leaves the finding unchecked and writes the reason in its notes
  file. This is the existing fixer contract, unchanged.
- **Test gate.** After the fix step, the test command runs in the
  worktree. A failure gets the existing fix-retry treatment: another
  fix attempt with the previous failure in its prompt, then failure
  after the attempts run out.
- A fixer's `[x]` does not close a finding. The next round's reviewer
  has to confirm the fix. A dispute does not close a finding either.
  Only the reviewer's withdrawal closes a disputed finding.

### Outcomes

- **Pass.** A round in which the reviewer leaves nothing open, after
  at least `minRounds` rounds. The ticket continues to merge exactly
  as today.
- **Unresolved.** `maxRounds` reached with findings open. The ticket's
  `**Status:**` is set to `ready-for-human`, it is recorded in
  `progress.md` with `done:false`, its branch is kept, and its worktree
  is removed. It is not retried in this run. Its dependents show as
  blocked through the existing non-agent-ticket path. The run exits 1
  because tickets were left unfinished.
- **Failed.** The reviewer exits non-zero, times out or writes
  unparseable findings after its retries, or the fixer cannot get the
  tests passing after its fix attempts. The ticket fails the attempt
  the same way a failed test gate does today: `done:false` in
  `progress.md`, and the existing ticket retry policy applies.
- Unlike the end-of-run review pass, the loop is a gate, not advisory.
  Its errors decide the ticket's outcome. The `AGENTS.md` invariant
  that says "the review pass is advisory" must be narrowed to the
  end-of-run pass, and a new invariant must describe the loop as a
  gate.

### Ticket review log

- One append-only markdown file per ticket under the feature's
  `.scratch/` directory, in a `reviews/` subdirectory named after the
  ticket file. Entries open with a `<!-- redeye:... -->` sentinel line,
  following the conventions of `review.md` and `learnings.md`. Sentinel
  text inside free-text fields is neutralized, and the parser drops
  malformed entries instead of throwing.
- Each round's entry records the round number, the review and
  implement role strings, the branch head reviewed, every finding with
  its verdict, the fixer's response to each finding (fixed, or
  disputed with its reason), the test gate result, and the branch head
  after the fix.
- The log is committed with the other bookkeeping files at every
  terminal point (`git add --force`, as the existing bookkeeping is).

### Resume

- When a ticket starts and its branch already exists from an
  interrupted run, redeye reads the ticket review log. If the log's
  last recorded branch head matches the branch head and the loop has
  no terminal entry, redeye recreates the worktree on that branch and
  resumes at the next round, skipping implementation.
- In every other case, the existing behavior holds: the stale worktree
  and branch are removed and the ticket starts fresh.

### End-of-run review pass

- Unchanged when `adversarial` is not set.
- When `adversarial` is set, the reviewer runs with the review role and
  the fixer with the implement role. `--no-review` still skips it and
  has no effect on the per-ticket loop.

### Display and dry run

- While a ticket is in the loop, its row stays in the running state
  and its label shows the round and role, for example
  `review 2/3` or `fix 2/3`.
- `--dry-run` prints the implement and review role strings, which one
  a command-line provider overrides, `maxRounds`, `minRounds`, and the
  same-model warning if it applies.

### Modules

- A new config module loads and validates `.redeye.json` and parses
  role strings. It has no value imports from the orchestrator.
- The review module gains the round prompts, the round runner and the
  ticket review log's render and parse functions. It keeps taking
  `spawnAgent` and the process registry as injected deps, and keeps
  importing only types from the orchestrator.
- The orchestrator calls the round runner from the ticket attempt and
  handles the new `unresolved` outcome.
- `index.ts` loads config, resolves the effective implement role, and
  adds the `init` questions. `setup.ts` writes the config key.
- Prompt rule lines stay in `rules.ts` so the new prompts cannot drift
  from the ticket, fix and review prompts.
- New modules must be added to the standalone esbuild list in
  `package.json`, and new test files to `TESTS` in `scripts/test.sh`.

## Testing Decisions

- Good tests here drive redeye from the outside and assert observable
  results: a ticket's final `**Status:**`, whether its branch merged,
  what `progress.md` says, what the ticket review log contains, which
  role received which prompt, and the exit code. They do not assert
  prompt wording, log wording or internal call order.
- **Main seam: `runWavesIsolated` with mock agents**, as in
  `review-integration.test.ts`. Add a fake `pi` wrapper next to
  `fake-claude`. redeye picks provider behavior from the command's
  basename, so this lets one run give `implement` and `review`
  different providers and lets the mock record which role ran. New
  `FAKE_*` environment variables script per-round reviewer output
  (findings, verdicts, unparseable output) and fixer behavior (fix,
  dispute, failing tests). Any new key must be added to that test
  file's env key list. Cases to cover:
  - A clean first round passes and merges, and its log has one round.
  - A finding is fixed, confirmed next round, and the ticket merges
    after two rounds.
  - A disputed finding is withdrawn by the reviewer, and the ticket
    merges.
  - A disputed finding the reviewer keeps until `maxRounds` makes the
    ticket `ready-for-human`, unmerged with its branch kept, with
    dependents blocked and exit 1.
  - `minRounds` greater than 1 forces another round after a clean one.
  - Reviewer failure and a fixer that cannot get tests passing both
    fail the attempt and go through the existing retry path.
  - A run interrupted mid-loop resumes at the next round without
    re-running implementation.
  - With no `adversarial` key, the agent invocations match today's.
- **CLI subprocess seam** (`spawnCli` in `integration.test.ts`): a
  malformed `.redeye.json` and an invalid role string both exit 2
  before any branch is created. A bare `redeye` with config uses
  `implement`. A command-line provider overrides it. `--dry-run` shows
  both roles and the same-model warning.
- **`setup()` seam** (`setup.test.ts`): writing the `adversarial` key,
  merging into an existing `.redeye.json` without losing other keys,
  and leaving the file alone when the user declines. The `init`
  prompts themselves stay untested, like the existing tracker prompt.
- Pure tests for the role-string parser and the ticket review log's
  render and parse round-trip, in the style of `review.test.ts`,
  including sentinel neutralization and malformed-entry dropping.

## Out of Scope

- Test-backed disputes, where a disputed finding stands only if the
  reviewer produces a failing test. This needs a scratch worktree the
  reviewer can write to. It is planned as a follow-up.
- More than two roles, such as a separate fixer model or several
  reviewers per round.
- Automatic routing of the reviewer away from the author's model
  family. There is only the same-model warning.
- A CLI flag to turn the loop off for one run. Removing the
  `adversarial` key is the only off switch.
- Moving existing CLI flags into `.redeye.json`.
- Changing the GitHub Issues tracker flow. The loop runs on local
  tickets the same way it runs on any loaded selection, and nothing
  tracker-specific is added.
- Cost reporting for the loop beyond what the existing stats already
  collect from each agent run.

## Further Notes

- Background: this follows the "Verification-Driven Development"
  pattern (a builder model and a cynical reviewer model in a loop, with
  a fresh reviewer context each turn) and the cross-model
  finder/verifier design of `bluesky-social/roast`. The research behind
  the design decisions is in
  `../adversary/adversarial-review-tools-report.md`. Its main points:
  independence between author and reviewer models matters more than
  how many reviewers there are; the author should not be the final
  judge of findings against its own code; and extra debate rounds have
  diminishing or negative returns, which is why `maxRounds` defaults
  to 3.
- Exit codes keep their meaning: an `unresolved` ticket is an
  unfinished ticket, so it gives 1, not 2.
- Every new prompt must keep the existing confinement rules: agents
  stay inside their worktree and never push.
