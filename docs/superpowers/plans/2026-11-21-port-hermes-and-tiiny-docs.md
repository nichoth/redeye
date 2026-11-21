# Port Hermes Support and Tiiny Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the `hermes` harness and the Hermes/Tiiny README
sections from branch `redeye_tiiny` onto `wip`, without the
continue-branch and provider-error feature.

**Architecture:** Do not `git merge redeye_tiiny`: that would bring
the continue-branch feature (US-001..US-009 on that branch) and drop
`wip`'s `src/tiiny.ts`. Instead, take the code and tests of commit
`edb0ed0` (they apply cleanly to `wip`) and hand-port the README
sections, which conflict.

**Tech Stack:** TypeScript, Node >= 24, @substrate-system/tapzero.

**Spec:** none written. Scope comes from the conversation of
2026-11-21 and is recorded in Global Constraints below. Source
material: `git show edb0ed0 e45504d` and the uncommitted README diff
in `../redeye_tiiny` (`git -C ../redeye_tiiny diff README.md`).

## Global Constraints

- Work on branch `wip`. Do not merge or rebase `redeye_tiiny`.
- Out of scope: everything from `redeye_tiiny` commits `71b56db`
  through `9c41569` -- `continueWorktree`, `CONTINUE_RULE`,
  `piTurnError`, the provider-error and skipped outcomes, their
  tests and mocks, the AGENTS.md lines about them, and the README
  text that depends on them (the "A retry or a new `redeye` run
  continues the ticket's branch" paragraph, the "Retries continue
  the ticket branch" paragraph, the rewritten 404 note, and the
  `--timeout 7200 --retries 3` command changes).
- Keep `wip`'s existing README text for the 404 `[!WARNING]` and
  the `--timeout 900 --retries 1` commands. They describe `wip`'s
  behavior.
- Keep `src/tiiny.ts` and `test/tiiny.test.ts` on `wip` untouched.
- The `hermes` argv is exactly
  `['--yolo', 'chat', '--query-file', '-', '--quiet']`, then
  `--model <m>` when a model is given.
- Docs: no em dashes, no `→`. TypeScript: no lines over 80
  columns, no space between colon and type.
- Run `npm run build` before `npm test`.

## Review Focus

1. `--effort` with hermes: `hermes` has no effort ladder, so
   `spawnAgent` must add no effort flag and must not throw. Test in
   Task 1.
2. `hermes` given as a full path (`/usr/local/bin/hermes`) must get
   the same args as the bare name. Covered by the Task 1
   `getProviderArgs` test.
3. The prompt reaches hermes on stdin, not as a `@file` argument
   (only `pi` uses a prompt file). Covered by the Task 1 argv test:
   argv ends with `--model some/model` and has no `@` entry.
4. README anchors: the two new table-of-contents links must match
   the generated heading slugs (`#hermes`, `#hermes--local-model`).
   Checked by hand in Task 2.
5. `--max-turns` / `--prefer-subagent` with hermes already warn and
   drop through the generic non-claude paths
   (`src/orchestrator.ts` `spawnAgent`, `src/index.ts`). No change;
   no new test.

---

### Task 1: `hermes` provider args

**Files:**
- Modify: `src/orchestrator.ts` (`PROVIDER_ARGS`, near line 812)
- Test: `test/orchestrator.test.ts`

**Interfaces:**
- Consumes: `getProviderArgs(cmd:string):string[]`,
  `spawnAgent(opts)` (existing), `test/mock-agent-echo-args.js`
  (existing; writes its argv as a JSON line to the log).
- Produces: `PROVIDER_ARGS.hermes`.

- [ ] **Step 1: Take the tests and code from `edb0ed0`**

```bash
git cherry-pick -n edb0ed0
git checkout HEAD -- README.md
git status -s   # expect only src/orchestrator.ts and
                # test/orchestrator.test.ts staged
```

This adds the `hermes` entry (with its comment) to
`PROVIDER_ARGS` and two tests:
`getProviderArgs - hermes runs one chat turn from stdin` and
`spawnAgent: hermes gets --model after the chat subcommand`.
If the cherry-pick reports a conflict in either `.ts` file, stop and
report it; the trial run on 2026-11-21 applied cleanly.

- [ ] **Step 2: Add the effort test** in `test/orchestrator.test.ts`,
right after the spawnAgent hermes test, modeled on it:

```ts
test('spawnAgent: hermes ignores --effort', async t => {
    // same setup as the hermes --model test, plus effort:'high'
    // ...
    t.deepEqual(
        argv.slice(2),
        [
            '--yolo', 'chat', '--query-file', '-',
            '--quiet', '--model', 'some/model',
        ],
        'no effort flag is added for hermes'
    )
})
```

- [ ] **Step 3: Check the tests fail without the code**

Temporarily remove the `hermes:` line from `PROVIDER_ARGS`, then
`npm run build && npm test`. Expected: the three hermes tests FAIL.
Restore the line.

- [ ] **Step 4: Build, test, lint**

Run: `npm run build && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts test/orchestrator.test.ts
git commit -m "feat: hermes provider args"
```

### Task 2: README -- Hermes sections and provider docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 (the argv the docs describe).

Source text is on `redeye_tiiny`:
`git show redeye_tiiny:README.md` plus the worktree's uncommitted
edit (`git -C ../redeye_tiiny diff README.md`). Use the worktree
wording where the two differ ("Run Hermes with a Tiiny box").

- [ ] **Step 1: Add the two example sections**

Insert `### Hermes` and `### Hermes + Local Model`, each preceded by
`---`, between the "Keep Your Machine Awake" text and
`### Claude Opus 4.6` (around line 241). Copy both sections verbatim
from `redeye_tiiny`, including the `config.yaml` example, the
`TIINY_API_KEY` tip, the `model_aliases` note from `e45504d`, and
the closing note that links `#local-model-with-pi`.

- [ ] **Step 2: Table of contents**

Under `- [Examples](#examples)`, after the `Mac OS` line, add:

```markdown
  * [Hermes](#hermes)
  * [Hermes + Local Model](#hermes--local-model)
```

Do not take any other TOC lines from `redeye_tiiny`; `wip`'s
Tiiny entries are already correct.

- [ ] **Step 3: Command-line docs**

In the flags table, the `[provider]` row example list becomes
`` `claude`, `codex`, `pi`, `hermes` ``. After the `pi` bullet in
the provider-args notes (around line 670), add the `hermes` bullet
from `redeye_tiiny`:

```markdown
  * `hermes`: `--yolo chat --query-file - --quiet` (prompt read
    from stdin; `--quiet` makes the turn one-shot so hermes exits
    when done; `--yolo` skips approval prompts)
```

- [ ] **Step 4: Verify the diff is docs-only and in scope**

Run: `git diff README.md`
Expected: only additions from Steps 1-3. No changes to the
`Local Model With pi` section, the 404 warning, or any
`--timeout`/`--retries` value. `grep -n "—\|→" README.md` finds
nothing new. Open the README preview and click both new TOC links.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: hermes and hermes with a Tiiny box"
```

### Task 3: Final check

- [ ] **Step 1:** `npm run build && npm test && npm run lint` --
all pass.
- [ ] **Step 2:** `git diff 7a2186c --stat` lists only
`src/orchestrator.ts`, `test/orchestrator.test.ts`, `README.md`
(and this plan). `src/tiiny.ts` is unchanged.
- [ ] **Step 3:** Leave `redeye_tiiny` and its worktree as they
are. Deleting them is the user's call.
