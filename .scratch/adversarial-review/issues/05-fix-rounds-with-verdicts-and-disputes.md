# 05: Fix rounds with verdicts and disputes

**What to build:** The full adversarial loop. When a review leaves
findings open and rounds remain, the implement role acts as the
fixer in the ticket's worktree. It fixes each finding with `/tdd`
and marks it `[x]`, or disputes it by leaving it unchecked and
writing the reason in its notes file. This is the existing fixer
contract, unchanged. The test gate then runs again, and a failure
gets the existing fix-retry treatment: another fix attempt with the
previous failure in its prompt, then failure after the attempts run
out.

The next round's reviewer sees the open findings and the fixer's
responses. For each one it gives a verdict: confirmed fixed,
withdrawn, or still open. It may add new findings. `No findings.`
is valid only when no prior findings are open. Neither a fixer's
`[x]` nor a dispute closes a finding. Only the reviewer's
confirmation or withdrawal does.

Outcomes:

- **Pass:** a round ends with nothing open and at least `minRounds`
  rounds have run.
- **Unresolved:** the review in round `maxRounds` leaves findings
  open. The fixer does not run after the final review, because no
  later reviewer would check its work. The ticket becomes
  `ready-for-human` as in ticket 04.
- **Failed:** the fixer cannot get the tests passing after its fix
  attempts, or the reviewer fails. The attempt fails, and the
  existing ticket retry policy applies.

While fixing, the ticket's label shows `fix 2/3`.

**Blocked by:** 04

**Touches:** `src/review.ts` (round runner loop, verdict-aware
review prompt, fix step reusing the `runFixer` contract inside the
ticket worktree, review log entries gain the fixer response, test
result and post-fix head); `src/rules.ts`; `src/orchestrator.ts`
(round runner call site in `runTicketAttempt`, test gate re-run);
`test/fake-pi/pi` and `test/mock-agent-*.js` (script fix, dispute
and failing-tests behavior); `test/review-integration.test.ts`
(`ENV_KEYS`); `test/review.test.ts`

**Status:** ready-for-agent

Notes:

- Every fixer process joins the existing process tracking.
- Each round entry in the review log records the fixer's response to
  each finding (fixed, or disputed with its reason), the test gate
  result and the branch head after the fix.
- Document the round rules in the README section on `.redeye.json`.

- [ ] A finding the fixer fixes and the next reviewer confirms lets
  the ticket merge after two rounds, and the log shows both rounds
- [ ] A finding the fixer disputes and the next reviewer withdraws
  lets the ticket merge
- [ ] A disputed finding the reviewer keeps open until `maxRounds`
  makes the ticket `ready-for-human`, unmerged, with its branch kept
  and the run exiting 1
- [ ] With `minRounds` set to 2, a clean first round is followed by
  a second review before the ticket merges
- [ ] A fixer whose changes keep failing the test gate fails the
  attempt, and the ticket goes through the existing retry path
- [ ] A finding the fixer marks `[x]` stays open when the next
  reviewer keeps it open
