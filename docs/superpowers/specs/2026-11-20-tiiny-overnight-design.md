# Overnight runs on a local model (tiiny)

## Intent

Use the Tiiny box for free AI use: `redeye pi -m tiiny/...` should
finish tickets when left running unattended, overnight if needed. No
paid model is involved.

## What goes wrong today

Measured on the `roast` ts-rewrite feature, ticket 15, 2026-11-20:

- The box is slow. `Qwen3.6-35B-A3B-turbo` writes about 1,300 output
  tokens per minute, `Qwen3.8-27B` about 600. Prompt caching works
  with `--concurrency 1` (each turn reads only a few hundred new
  tokens), so output speed is the limit.
- Attempts on the 35B model ran 13-15 minutes, made 14-16 edits, and
  were killed by the default 900s timeout mid-work. The 27B model
  spent 12 minutes and 29 turns exploring before its first edit.
- A retry throws that work away. `addWorktreeNow` in
  `src/worktree.ts` runs `git branch -D` on the ticket branch before
  `git worktree add -b`, so attempt 2 starts from the base branch and
  repeats the exploration. A new `redeye` run does the same, and the
  feature was restarted six times that day.
- Several attempts ended "no commits, exit 0" in seconds. That
  matches the documented case where the model passed to `-m` is not
  the one loaded on the box: the box returns 404, `pi` exits 0, and
  the retries for the ticket are spent at once.

## Goals

1. A retry continues the previous attempt's work.
2. A new run continues a ticket's leftover branch.
3. A model or provider error stops the run instead of burning the
   queue.

## Non-goals

- Escalating to a paid model on the last attempt. That was option 1
  in the discussion; it can be layered on later.
- Splitting tickets. Ticket size is the spec author's call.
- New timeout logic. `--timeout` and `--retries` already exist.

## Anti-goals

- Continuing a branch that is not the ticket's own work.
- Throwing away a leftover branch's commits because the base
  branch moved. When the base has moved (every run adds a
  `redeye: start` commit), merge it into the branch first; on a
  conflict, abort that merge and continue on the branch as it is.
- Losing the ability to start a ticket clean.

## Approaches considered

1. Local first, escalate to Claude on the last attempt. Cheapest
   reliable option, but pays for Claude. Not picked.
2. Tiiny as reviewer only, via the existing `.redeye.json`
   `adversarial` block. Works today, small savings. Not picked.
3. Tiiny only, overnight, with retries that keep their work.
   **Picked**: free, and option 1 can later be built on top of it.

## Design

### 1. Continue the ticket branch

When a ticket attempt starts and the ticket branch
(`buildBranchName(repoName, ticket)`) exists with commits not on
the base branch, check it out with `addWorktreeForBranch` (no
reset) instead of `createWorktree`. Otherwise keep today's path.

This covers both retries in one run and a ticket whose branch was
left by an earlier run (goal 2). The adversarial resume path in
`runTicket` (`detectResume`) keeps priority over this.

To start a ticket clean, delete its branch.

### 2. Tell the agent

When the attempt continues a branch, the prompt gets a short rule:
a previous attempt left commits on this branch, run the test
command first, then continue from where it stopped instead of
starting over. The test-gate tail already written to
`learnings.md` tells it what failed.

### 3. Stop on a provider error

When the `pi` stream shows the agent ended on an error (for
example a 404 because the model is not loaded), the run stops with
a message naming the model and the error, and exits non-zero. It
does not record "no commits" and move to the next ticket, since
every later ticket would hit the same error.

### 4. Docs

The README's local-model section recommends a longer timeout and a
few retries for local models, for example `--timeout 7200
--retries 3`, and says that retries now continue the branch.

## Left to the builder

- How exactly `pi` reports a failed request in its JSON stream
  (expected: the last assistant `message_end` with
  `stopReason: "error"` and an `errorMessage`). Verify against a
  real 404 from the box, or `pi`'s source, before writing the
  check.
- Whether the same error check applies to `claude` and `codex`.
  Only `pi` is required.
- Where the "continued" flag lives so the prompt and logs can see
  it.
- The existing "no commits" path when continuing: an attempt that
  adds nothing on top of earlier commits still counts as progress
  for the test gate, since the branch has commits.
