<!-- redeye:review from=c13b0ac6543f62a4fb195367f60537201852f4f3 to=2b6185ea5eaed9139e254e6f3884bc3accc4ec82 status=fixed -->
## 2026-11-20 19:59 -- review c13b0ac..2b6185e -- 2 of 5 fixed
- [ ] A resumed adversarial loop never runs the install command, so the fix-step test gate runs in a worktree with no dependencies
    src/orchestrator.ts:2406-2444. The resume branch calls `addWorktreeForBranch` and goes straight to `runAdversarialLoop`. The fresh path runs `runInstall` first (src/orchestrator.ts:~2460). `runTicketFixStep` (src/review.ts:1550-1680) only passes `installCmd` into the prompt and never runs it. Failing case: an npm project (`detectInstallCmd` returns `npm ci`, and `node_modules` is untracked) whose resumed round has open findings. The fixer's `npm test` in the new worktree fails because modules are missing, every fix attempt fails, and the ticket fails with `reason:'tests'`. The reviewer is also told to run tests in that same worktree. No resume test sets `installCmd`.
- [ ] Committing each review-log entry races with other tickets' git commits in the base checkout, and a lost commit blocks the resume it was added for
    src/orchestrator.ts:2101-2115 (`recordEntry`) calls `commitProgress` on `opts.repoRoot` while other tickets in the wave run their own loops (`--concurrency` > 1) and call `saveProgress`. `commitProgress` (src/progress.ts:235) runs `git add` and `git commit` with no queue, so two concurrent calls can collide on `.git/index.lock`. The second call fails, and the error is only logged ("Failed to commit review log"). If the run is interrupted before the end-of-wave sweep (src/orchestrator.ts:3605), the log is left modified or untracked. `isDirty` (src/worktree.ts:500) counts both, so the next run stops with "Working tree is dirty" and cannot resume. AGENTS.md says per-entry commits exist to prevent exactly this. These commits need to be serialized, like `worktreeQueue`. The same race also makes `saveProgress` commits more likely to fail.
- [x] With a command-line provider override, the review log records the config's implement string, not the role that actually ran
    src/index.ts:888-891 passes `implementStr: adversarial.implementStr` even when `roles.overridden` is true. `runAdversarialLoop` writes `implement: adv.implementStr` into every round entry (src/orchestrator.ts ~2165). Failing case: `.redeye.json` has `"implement":"pi -m qwen"` and the user runs `redeye claude -m opus`. The fixer is claude/opus, but every round in `.scratch/<feature>/reviews/<ticket>.md` says `pi -m qwen`. The spec requires each round entry to record the role strings in use.
- [ ] Resume ignores a recorded failing test gate and can merge a branch whose tests fail
    src/orchestrator.ts:2000-2060 (`detectResume`). The fix-fail path writes a round entry with `testResult:'fail'` and `fixHead`, then a separate `failed` terminal entry (src/orchestrator.ts ~2325-2345), and each entry is committed on its own. If the run is interrupted between the two commits, the last round's `fixHead` matches the branch head and there is no terminal entry. The next run therefore resumes at round+1 and skips the test gate. If the reviewer then leaves nothing open, the ticket merges with failing tests. `detectResume` should not resume when `lastRound.testResult === 'fail'`.
- [x] The review role gets `--prefer-subagent` (and `--max-turns`) even when its provider does not support them
    src/config.ts:145 (`resolveRoles`) merges run-wide CLI flags into the review role. src/index.ts:708-716 warns and drops `preferSubagent` only for the implement provider. Failing case: `redeye claude --prefer-subagent x` with review `pi -m ...`. `runTicketReviewRound` passes `adv.review.preferSubagent` to `subagentRule` (src/review.ts:1203, 1311), so the pi reviewer's prompt tells it to use a subagent it does not have. This breaks the AGENTS.md invariant that provider-specific options warn and are dropped on providers without them.

### Fix
- attempts: 1 of 4
- effort: medium
- agent exit code: 0
- result: merged

# Review-fix notes

## Finding 1 (resume skips install) -- fixed
- src/orchestrator.ts: extracted `installDeps` (install + failed
  outcome), called on both the fresh and the resume path.
- Test: review-integration "resume - a resumed loop runs the install
  command in the recreated worktree".

## Finding 4 (resume ignores a failing test gate) -- fixed
- `detectResume` returns null when the last round has
  `testResult === 'fail'`, so the ticket starts fresh.
- Test: review-integration "resume - a last round with a failing test
  gate starts fresh".
- Committed together with finding 1 (same file, same test helper).

## Finding 2 (review-log commits race) -- fixed
- src/progress.ts: `commitProgress` now runs on a module-level
  `commitQueue` (same pattern as `worktreeQueue`).
- src/orchestrator.ts: `commitTicketFiles` (the other base-checkout
  commit) now goes through `commitProgress`, so it joins the queue.
- Test: progress "commitProgress calls made at once all commit their
  files" (8 concurrent calls; failed with index.lock before).

## Finding 5 (review role keeps --prefer-subagent on non-claude) -- fixed
- src/config.ts: `resolveRoles` now drops `preferSubagent` from any
  role (implement or review) whose provider basename is not claude
  and returns `warnings` (deduped per provider).
- src/index.ts: prints `roles.warnings` where the implement-only drop
  used to be; same warning text as before.
- `--max-turns` was not changed: `spawnAgent` already warns and drops
  it per spawn for non-claude providers, so the reviewer never gets it.
- Tests: config "resolveRoles - prefer-subagent ..." (three cases).

## Finding 3 (review log records the config implement on override) -- fixed
- src/config.ts: new `renderRoleString(role)`; `resolveRoles` returns
  `implementStr` -- the config string when no CLI provider, else the
  rendered merged CLI role (e.g. `claude -m sonnet`).
- src/index.ts: passes `roles.implementStr` into `adversarial`.
  The "overrides implement (<config string>)" lines still show the
  config string, on purpose.
- Tests: config "resolveRoles - the implement string names the role
  that runs"; integration "a CLI provider overrides implement in a run
  and says so" now also checks the review log's implement field.
---
