# 06: Resume an interrupted loop

**What to build:** When a ticket starts and its branch already
exists from an interrupted run, redeye reads the ticket's review
log. If the log's last recorded branch head matches the branch head
and the loop has no terminal entry, redeye recreates the worktree on
that branch and resumes at the next round, skipping implementation.
In every other case the existing behavior holds: the stale worktree
and branch are removed and the ticket starts fresh.

**Blocked by:** 05

**Touches:** `src/orchestrator.ts` (`runTicketAttempt` resume
check before `createWorktree`); `src/worktree.ts` (a queued way to
add a worktree on an existing branch, on `worktreeQueue`);
`src/review.ts` (round runner starts at a given round, reading the
log through its parser); `test/review-integration.test.ts`

**Status:** done

Notes:

- Every worktree create, remove and branch delete runs on
  `worktreeQueue`.
- A terminal entry is one that records a pass, an unresolved stop or
  a failure. The review log needs one written at every terminal
  point if ticket 05 did not already add it.

- [x] A run interrupted after a recorded round resumes that ticket
  at the next round without running implementation again, and the
  ticket can pass and merge
- [x] A ticket whose branch head no longer matches its review log
  starts fresh, with implementation running again
- [x] A ticket whose review log ends in a terminal entry starts
  fresh
