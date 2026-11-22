# Overnight Runs on a Local Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ticket attempt continues the ticket branch left by an
earlier attempt or run, and a `pi` provider error stops the run.

**Architecture:** `runTicketAttempt` checks whether the ticket
branch has commits not on the base branch; if so it checks the branch
out with a new `continueWorktree` (no reset, base merged in) and adds
a continue rule to the prompt. `spawnAgent` reads the last assistant
`message_end` in the `pi` JSON stream; a final `stopReason: "error"`
becomes a `provider-error` outcome, which stops the ticket's retries
and the wave loop in `runWavesIsolated`.

**Tech Stack:** TypeScript, Node >= 24, ESM, git,
`@substrate-system/tapzero`.

**Spec:** `docs/superpowers/specs/2026-11-20-tiiny-overnight-design.md`

## Global Constraints

- Lines no longer than 80 columns. No space between colon and type
  (`opts:{ a:string }`). Ternaries break after `?` and `:`.
- No em dashes or arrow characters in docs or comments; use `--` and
  `->`.
- A new `test/<name>.test.ts` must be added to `TESTS` in
  `scripts/test.sh`. A new `src/` module must be added to the second
  esbuild call in `build-esm`. Prefer adding to existing files.
- `npm run build` before `npm test` when `src/` changed. Every test
  repo sets `user.name` and `user.email` in its own git config.
- Tests must not assert on exact prose. Compare against the exported
  rule function's output, exit codes, files and git state.
- Only `runWavesIsolated` (the git path) changes. `runWaves` (no git)
  is out of scope.
- The adversarial resume path (`detectResume`) keeps priority over
  continuing a branch.

## Review Focus

1. A leftover branch from an earlier run whose base gained a
   `redeye: start` commit: the base is merged in and the branch's
   commits are kept. (Task 1)
2. Base and leftover branch conflict: the merge is aborted, the
   worktree is clean on the branch, the attempt still runs. (Task 1)
3. `pi` retries a transient error and then succeeds: an error
   `message_end` earlier in the stream must not stop the run; only
   the last assistant message counts. (Task 3)
4. A ticket branch already merged into base (no commits ahead) takes
   the fresh path, not the continue path. (Task 2)
5. A provider error mid-wave: tickets in that wave that already
   finished are still merged; tickets not started stay
   `ready-for-agent`; the end-of-run review pass is skipped. (Task 4)

---

### Task 1: `continueWorktree`

**Files:**
- Modify: `src/worktree.ts` (next to `addWorktreeForBranch`, ~400)
- Test: `test/worktree.test.ts`

**Interfaces:**
- Consumes: `addWorktreeForBranch`, `buildBranchName`, `isAncestor`
  from `src/worktree.ts`.
- Produces:

```ts
export type ContinuedWorktree = {
    worktreePath:string
    branchName:string
    // 'up-to-date': base already an ancestor of the branch
    // 'merged': base merged into the branch
    // 'conflict': merge aborted, branch left as it was
    base:'up-to-date'|'merged'|'conflict'
}

export function continueWorktree (opts:{
    repoRoot:string
    repoName:string
    baseBranch:string
    ticket:Ticket
}):Promise<ContinuedWorktree>
```

The worktree path is the same one `createWorktree` uses
(`<repoRoot>/../<repoName>.<feature->NN-<slug>`); extract that path
computation into a shared helper rather than copying it. Runs through
the same `enqueue` queue.

- [ ] **Step 1: Write the failing tests** in `test/worktree.test.ts`

  - `continueWorktree keeps the branch commits`: create the ticket
    branch with one commit adding `a.txt`, call `continueWorktree`;
    assert `a.txt` exists in the returned worktree, `base` is
    `'up-to-date'`, and the branch head did not change.
  - `continueWorktree merges a base that moved`: as above, then
    commit `b.txt` on base; assert both files exist in the worktree
    and `base` is `'merged'`.
  - `continueWorktree leaves the branch alone on a conflict`: branch
    and base both change line 1 of `c.txt`; assert `base` is
    `'conflict'`, `isDirty(worktreePath)` is false, and the branch
    head equals the head before the call.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && npm test`
Expected: the three new tests fail (`continueWorktree` is not a
function).

- [ ] **Step 3: Implement `continueWorktree`**

`addWorktreeForBranch`; if `isAncestor(worktreePath, baseBranch,
'HEAD')` return `'up-to-date'`; else `git merge --no-edit
<baseBranch>` in the worktree; on failure `git merge --abort` and
return `'conflict'`.

- [ ] **Step 4: Run the tests**

Run: `npm run build && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/worktree.ts test/worktree.test.ts
git commit -m "feat: continueWorktree checks out a ticket branch as it is"
```

---

### Task 2: Attempts continue the ticket branch

**Files:**
- Modify: `src/orchestrator.ts` (`runTicketAttempt`, ~2437, where
  `createWorktree` is called; `renderPrompt`, ~604)
- Modify: `src/rules.ts` (new rule)
- Test: `test/orchestrator.test.ts`, `test/integration.test.ts`
- Create: `test/mock-agent-continue.js`

**Interfaces:**
- Consumes: `continueWorktree`, `ContinuedWorktree` (Task 1);
  `localBranchExists`, `hasNewCommits` from `src/worktree.ts`.
- Produces:
  - `export const CONTINUE_RULE:string` in `src/rules.ts`. Content:
    a previous attempt left commits on this branch; run the test
    command first, read the ticket's history above, then continue
    from where it stopped instead of starting over.
  - `renderPrompt` opts gain `continued?:boolean`; when true,
    `CONTINUE_RULE` goes right after the `readDocsRule` line.

- [ ] **Step 1: Write the failing unit test** in
  `test/orchestrator.test.ts`

  `renderPrompt adds the continue rule only when continuing`: assert
  `renderPrompt(spec, ticket, { testCmd, continued: true })` includes
  `CONTINUE_RULE` and the call without `continued` does not.

- [ ] **Step 2: Write the failing integration tests** in
  `test/integration.test.ts`, using the fake pi
  (`FAKE_PI_DELEGATE`) and the existing repo helpers

  `test/mock-agent-continue.js`: if `progress.txt` exists in its cwd,
  append `seen` to it and create `pass.txt`; otherwise create
  `progress.txt`. Commit either way. The test command passes only
  when `pass.txt` exists.

  - `a retry continues the previous attempt's branch`: one ticket,
    `--retries 1`; assert exit 0, the base branch after merge has
    `progress.txt` containing `seen`, and the attempt-2 prompt
    recorded via `FAKE_PI_RECORD_DIR` includes `CONTINUE_RULE`.
  - `a new run continues a leftover branch`: run once with
    `--retries 0` (ticket fails), run again; assert the second run
    exits 0 and `progress.txt` on base contains `seen`.
  - `a branch already merged into base starts fresh`: create the
    ticket branch pointing at the base head; assert the recorded
    prompt does not include `CONTINUE_RULE`.

- [ ] **Step 3: Run them to see them fail**

Run: `npm run build && npm test`
Expected: the new tests fail.

- [ ] **Step 4: Implement**

In `runTicketAttempt`'s non-resume path: when
`localBranchExists(repoRoot, branchName) && hasNewCommits(repoRoot,
baseBranch, branchName)`, call `continueWorktree` (errors return
`{ kind: 'worktree-error' }` like `createWorktree`) and log one line
with the ticket filename, the branch, and the `base` result;
otherwise `createWorktree` as today. Pass `continued` to
`renderPrompt`.

- [ ] **Step 5: Run the tests**

Run: `npm run build && npm test`
Expected: all pass, including the existing adversarial and resume
suites.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator.ts src/rules.ts test/
git commit -m "feat: ticket attempts continue the ticket branch"
```

---

### Task 3: Read a provider error from the `pi` stream

**Files:**
- Modify: `src/orchestrator.ts` (`AgentResult` ~1034, `spawnAgent`
  ~1092)
- Test: `test/orchestrator.test.ts`

**Interfaces:**
- Produces:

```ts
// For one parsed pi JSON line: the error message when it is an
// assistant message_end with stopReason 'error', null when it is
// any other assistant message_end, undefined for every other line.
export function piTurnError (obj:unknown):string|null|undefined

// AgentResult gains:
//   providerError?:string
// set only for pi, only when the LAST assistant message_end in the
// stream ended in error, and never when timedOut is true.
```

pi's format, verified in pi 1.6.0
(`pi-ai/dist/api/openai-completions.js`): `{"type":"message_end",
"message":{"role":"assistant","stopReason":"error",
"errorMessage":"..."}}`. A missing `errorMessage` becomes
`'unknown provider error'`.

- [ ] **Step 1: Write the failing tests**

  - `piTurnError reads an error message_end`: returns the
    `errorMessage`.
  - `piTurnError returns null for a successful message_end`:
    `stopReason: 'toolUse'` -> `null`.
  - `piTurnError ignores other lines`: `message_update`, a user
    `message_end`, and a non-object -> `undefined`.
  - `spawnAgent reports only a final pi error`: fake pi via
    `FAKE_PI_DELEGATE` to a mock that prints an error `message_end`
    then a `toolUse` one -> `providerError` undefined; a mock that
    prints only the error and exits 0 -> `providerError` equals its
    message.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && npm test`
Expected: the new tests fail.

- [ ] **Step 3: Implement** `piTurnError`, and in `spawnAgent`'s pi
  line handler keep the latest non-undefined result; set
  `providerError` in `finish` when it is a string and `!timedOut`.

- [ ] **Step 4: Run the tests**

Run: `npm run build && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts test/
git commit -m "feat: read a final provider error from the pi stream"
```

---

### Task 4: A provider error stops the run

**Files:**
- Modify: `src/orchestrator.ts` (`TicketOutcome` ~1851,
  `runTicketAttempt` after `spawnAgent`, `runTicketAttempts` ~3058,
  `attemptEntry` ~2942, `runWavesIsolated` pool ~3855 and wave
  outcome loop ~3938, end-of-run review)
- Test: `test/integration.test.ts`
- Create: `test/mock-agent-pi-error.js`

**Interfaces:**
- Consumes: `AgentResult.providerError` (Task 3).
- Produces: two new `TicketOutcome` members:

```ts
| {
    kind:'provider-error'
    message:string
    branchName:string
    agentRun:AgentRunRecord
}
| { kind:'skipped' }
```

- [ ] **Step 1: Write the failing integration tests**

`test/mock-agent-pi-error.js` prints one assistant `message_end`
with `stopReason: 'error'` and exits 0.

  - `a provider error stops the run`: two independent ready tickets,
    `--concurrency 1 --retries 2`; assert exit code 1, exactly one
    recorded invocation in `FAKE_PI_RECORD_DIR` (no retries, second
    ticket never started), and both ticket files still have status
    `ready-for-agent`.
  - `a provider error keeps the ticket branch`: the branch has a
    commit from an earlier run; after the error, the branch still
    exists at the same head.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && npm test`
Expected: the new tests fail.

- [ ] **Step 3: Implement**

  - `runTicketAttempt`: right after `spawnAgent`, when
    `agentResult.providerError` is set, remove the worktree quietly
    (the branch stays) and return `provider-error`.
  - `runTicketAttempts`: `stop: true` for `provider-error`.
  - `attemptEntry`: `provider-error` records outcome `'error'` with
    the message; `skipped` is never recorded.
  - `runWavesIsolated`: a `stop:{ reason:string|null }` local. The
    pool callback returns `{ kind: 'skipped' }` without running when
    `stop.reason` is set, and sets `stop.reason` from a
    `provider-error` result (message names `opts.model` and the
    error). In the outcome loop, `provider-error` and `skipped` leave
    the ticket's status and progress unchanged and add its key to
    `failedKeys`. Finished tickets in the wave merge as usual. After
    the wave, when `stop.reason` is set, log it and break. Skip the
    end-of-run review pass when stopped.
  - The returned `allDone` is false when stopped, so the CLI exits 1.

- [ ] **Step 4: Run the tests**

Run: `npm run build && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts test/
git commit -m "feat: a provider error stops the run"
```

---

### Task 5: Docs

**Files:**
- Modify: `README.md` (section "Local Model With `pi`" and
  "Run the Loop")
- Modify: `AGENTS.md` (Project Structure notes for `worktree.ts` and
  `orchestrator.ts`, and the "Last verified" date)

- [ ] **Step 1:** In the README, say that a retry or a new run
  continues the ticket branch, that deleting the branch starts the
  ticket clean, and that a model error (such as the 404 when `-m`
  does not match the loaded model) stops the run. Replace the
  WARNING about retries being used up in seconds. Recommend
  `--timeout 7200 --retries 3` in the local-model run commands.
- [ ] **Step 2:** Update `AGENTS.md` for `continueWorktree`, the
  `provider-error` and `skipped` outcomes, and the date.
- [ ] **Step 3:** `npm run lint`; expected: no errors.
- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: continuing branches and provider errors"
```
