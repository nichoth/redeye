# 04: Review round gates each ticket (reviewer only)

**What to build:** The tracer bullet for the per-ticket loop. With
`adversarial` configured, each ticket that passes the test gate is
reviewed by the review role before it can be merged. The reviewer
runs in a fresh process in the ticket's worktree with a prompt built
from the ticket body, its spec and the diff from the merge base to
the ticket branch head (excluding `.scratch/`, as the existing
reviewer does). It can read the repo and run the tests but must not
change anything. It writes findings to the findings file in the
existing checklist form, or `No findings.`.

There is no fixer yet, so a single review decides the outcome:

- **Pass:** no findings. The ticket goes on to merge exactly as
  today.
- **Unresolved:** open findings. The ticket's status line becomes
  `ready-for-human`, `progress.md` records it with `done:false`, its
  branch is kept, its worktree is removed, it is not retried, its
  dependents show as blocked through the existing non-agent-ticket
  path, and the run exits 1.
- **Failed:** the reviewer exits non-zero, times out or writes
  unparseable findings after its retries. The attempt fails like a
  failed test gate (`done:false`), and the existing ticket retry
  policy applies.

Every review round is appended to a per-ticket review log under the
feature's `.scratch/` directory, in a `reviews/` subdirectory named
after the ticket file. The log is committed with the other
bookkeeping at every terminal point. While the review runs, the
ticket's row stays in the running state and its label shows the
round and role, for example `review 1/3`.

With no `adversarial` key, agent invocations match today's.

**Blocked by:** 02

**Touches:** `src/review.ts` (round review prompt, per-ticket round
runner taking `spawnAgent` and the registry as injected `ReviewDeps`,
ticket review log render and parse with `<!-- redeye:... -->`
sentinels); `src/rules.ts` (any new shared rule lines; reuse
`CONFINEMENT_RULES` and the read-only rules); `src/orchestrator.ts`
(`runTicketAttempt` calls the round runner after `runTestGate`,
`TicketOutcome` gains an `unresolved` kind, `runTicketAttempts` does
not retry it, `commitTicketFiles` includes the review log,
`HUMAN_STATUS`); `src/display.ts` (`Display` gains a way to show a
running ticket's round and role); new `test/fake-pi/pi` wrapper next
to `test/fake-claude/claude`; `test/review-integration.test.ts`
(new `FAKE_*` keys added to `ENV_KEYS`); `test/review.test.ts`;
`AGENTS.md`

**Status:** done

Notes:

- Add a fake `pi` wrapper so one run can give `implement` and
  `review` different providers, since `spawnAgent` picks provider
  behavior from the command's basename. The mock should record which
  role ran, and new `FAKE_*` variables should script the reviewer's
  per-round output (findings, `No findings.`, unparseable output,
  non-zero exit).
- Every reviewer process joins the existing process tracking
  (`runningAgents` or the registry), so the signal handler kills it.
- Each round entry records at least: the round number, both role
  strings, the branch head reviewed and every finding. Leave room in
  the format for the fixer response, test result and post-fix head
  that ticket 05 adds. Sentinel text in free-text fields is
  neutralized, and the parser drops malformed entries instead of
  throwing, like `review.md` and `learnings.md`.
- `AGENTS.md`: narrow the "review pass is advisory" invariant to the
  end-of-run pass, and add an invariant that the per-ticket loop is
  a gate whose errors decide the ticket outcome. Describe the ticket
  review log next to `learnings.md` and `review.md` under "Logs on
  disk".

- [x] A ticket whose reviewer writes `No findings.` merges, and its
  review log has one round
- [x] A ticket whose reviewer writes an open finding is not merged,
  its status is `ready-for-human`, its branch still exists,
  `progress.md` records it as not done, and the run exits 1
- [x] A ticket blocked by an unresolved ticket is reported as
  blocked and does not run
- [x] A reviewer that exits non-zero or writes unparseable findings
  fails the attempt, and the ticket goes through the existing retry
  path
- [x] The reviewer runs with the review role's provider and model,
  and implementation runs with the implement role's
- [x] The ticket review log round-trips through render and parse,
  neutralizes sentinel text in free-text fields, and drops malformed
  entries
- [x] With no `adversarial` key, the agent invocations in a run
  match today's (no reviewer is spawned for a ticket)
