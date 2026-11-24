# Copy Local Files Into Worktrees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every worktree redeye creates gets the launch checkout's
gitignored `.agents/`, `.env` and `.dev.vars`, before install and
before the agent starts.

**Architecture:** A new module, `src/localfiles.ts`, decides which
root-level files to copy (pure git queries) and copies them. The two
private functions in `src/worktree.ts` that run `git worktree add`
(`addWorktreeNow`, `addWorktreeForBranchNow`) call it right after the
add, so all five worktree entry points (fresh ticket, continued
branch, resumed adversarial loop, review, review-fix) get the files
with no call-site plumbing. `src/index.ts` warns once, before the
run, about candidates it will not copy.

**Tech Stack:** TypeScript, Node >= 24 (`fs.cpSync`), git CLI,
@substrate-system/tapzero via `test/shard.js`.

**Spec:** inline, from the design conversation of 2026-11-23:

- Copy `.agents/` only when git ignores it in the launch checkout.
  A tracked `.agents/` is already in the worktree.
- Copy `.env` and `.dev.vars` from the repo root only. No
  subdirectories.
- The copy happens after the worktree is created and before the
  install step and the agent spawn.
- Install in worktrees uses `npm ci --prefer-offline --no-audit
  --no-fund`. `detectInstallCmd` (`src/testcmd.ts:32`) already
  returns exactly that when `package-lock.json` exists, and
  `test/testcmd.test.ts` ("detectInstallCmd - npm lockfile")
  already pins it. No change. The no-lockfile fallback stays
  `npm install ...`, because `npm ci` fails without a lockfile.

## Global Constraints

- Candidates are exactly `.agents`, `.env`, `.dev.vars`, relative
  to the repo root. Nothing else, nothing nested.
- Copy a candidate only when it exists in the repo root, has no
  tracked paths, and `git check-ignore` reports it ignored. Copying
  an unignored file would let `git add -A` (the timeout
  auto-commit, the agent) commit a secret.
- A candidate that exists, is untracked, and is not ignored is
  "skipped": not copied, and warned about once per run.
- Never overwrite a path that already exists in the worktree (the
  branch may track it).
- Symlinks inside `.agents/` are copied as symlinks, unchanged
  (`verbatimSymlinks: true`), so `../../.agents/...` style links
  keep resolving.
- A copy error throws out of worktree creation, so the attempt
  fails as `worktree-error` instead of running an agent without
  its secrets.
- `src/localfiles.ts` imports no values from `src/orchestrator.ts`.
- TS style: no lines over 80 columns, `name:type` with no space.
  No em dashes or arrow characters in comments or docs.

## Review Focus

1. A repo with no `.agents`, `.env` or `.dev.vars` at all: worktree
   creation behaves exactly as before. Pinned in Task 1 (empty
   result) and Task 2 (existing worktree tests stay green).
2. `.env` present but not ignored: not copied, warned about, and so
   never auto-committed. Pinned in Task 1.
3. A ticket branch that tracks one of the candidates: the branch's
   version wins, the root copy does not clobber it. Pinned in
   Task 1.
4. Removing a worktree after the copy: `git worktree remove`
   without `--force` succeeds, since only ignored files were added.
   Pinned in Task 2.
5. Nested `packages/api/.dev.vars`: not copied (root only). Pinned
   in Task 1.

---

### Task 1: `src/localfiles.ts`, choosing and copying local files

**Files:**
- Create: `src/localfiles.ts`
- Create: `test/localfiles.test.ts`
- Modify: `scripts/test.sh` (add `localfiles` to `TESTS`)
- Modify: `package.json` (add `src/localfiles.ts` to the second
  esbuild call in `build-esm`)

**Interfaces:**
- Produces:
  - `export const LOCAL_FILES:readonly string[]` =
    `['.agents', '.env', '.dev.vars']`
  - `export type LocalFiles = { copy:string[]; skipped:string[] }`
  - `export function listLocalFiles (repoRoot:string):LocalFiles`
    Paths are repo-relative, in `LOCAL_FILES` order. Synchronous
    (`execFileSync`), like `isDirty` in `src/worktree.ts`.
  - `export function copyLocalFiles (repoRoot:string,
    worktreePath:string):string[]` Calls `listLocalFiles` and
    copies each `copy` entry. Returns the paths it copied.

- [ ] **Step 1: Write the failing tests**

Each test builds its own repo: `git init --template=<empty tmp
dir>`, local `user.name`/`user.email`, one commit, then adds a
worktree with `git worktree add -b t <tmp>/wt` after the files are
set up. Copy `initTempRepo` from `test/worktree.test.ts` and add
`--template`.

```ts
test('listLocalFiles - nothing present', t => {
    t.deepEqual(listLocalFiles(repo), { copy: [], skipped: [] })
})

test('listLocalFiles - ignored candidates are copied', t => {
    // .gitignore: .agents/ .env .dev.vars (committed)
    // create .agents/skills/x/SKILL.md, .env, .dev.vars
    t.deepEqual(listLocalFiles(repo), {
        copy: ['.agents', '.env', '.dev.vars'],
        skipped: [],
    })
})

test('listLocalFiles - tracked .agents is neither', t => {
    // .agents/skills/x/SKILL.md committed
    t.deepEqual(listLocalFiles(repo), { copy: [], skipped: [] })
})

test('listLocalFiles - unignored .env is skipped', t => {
    // .env exists, no .gitignore
    t.deepEqual(listLocalFiles(repo), {
        copy: [],
        skipped: ['.env'],
    })
})

test('listLocalFiles - nested secrets are ignored', t => {
    // .gitignore has .dev.vars; only packages/api/.dev.vars exists
    t.deepEqual(listLocalFiles(repo), { copy: [], skipped: [] })
})

test('copyLocalFiles - copies into the worktree', t => {
    // ignored .agents/skills/x/SKILL.md, .env, .dev.vars
    const copied = copyLocalFiles(repo, wt)
    t.deepEqual(copied, ['.agents', '.env', '.dev.vars'])
    t.equal(readFileSync(join(wt, '.env'), 'utf8'), envContent)
    t.ok(existsSync(join(wt, '.agents/skills/x/SKILL.md')))
})

test('copyLocalFiles - keeps symlinks verbatim', t => {
    // .agents/skills/y is a symlink to 'x' (relative)
    copyLocalFiles(repo, wt)
    t.equal(readlinkSync(join(wt, '.agents/skills/y')), 'x')
})

test('copyLocalFiles - does not overwrite the branch', t => {
    // branch t commits .env with 'branch'; root .env says 'root'
    // and is ignored on the base branch
    copyLocalFiles(repo, wt)
    t.equal(readFileSync(join(wt, '.env'), 'utf8'), 'branch')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && npm test`
Expected: `localfiles` suite fails (module not found).

- [ ] **Step 3: Implement `src/localfiles.ts`**

`listLocalFiles`: for each `LOCAL_FILES` entry that `existsSync`
in `repoRoot`, it is tracked when `git ls-files -- <p>` prints
anything (skip it); otherwise `git check-ignore -q -- <p>` exit 0
means `copy`, exit 1 means `skipped`. `copyLocalFiles`: `cpSync(src,
dst, { recursive: true, force: false, errorOnExist: false,
verbatimSymlinks: true })` per entry. A comment says why only
ignored files are copied (the `git add -A` auto-commit).

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build && npm test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/localfiles.ts test/localfiles.test.ts \
    scripts/test.sh package.json
git commit -m "feat: choose and copy gitignored local files"
```

### Task 2: Copy on every worktree add

**Files:**
- Modify: `src/worktree.ts` (`addWorktreeNow` ~line 245,
  `addWorktreeForBranchNow` ~line 373)
- Test: `test/worktree.test.ts`

**Interfaces:**
- Consumes: `copyLocalFiles(repoRoot, worktreePath)` from Task 1.
- Produces: no signature changes. `createWorktree`,
  `createNamedWorktree`, `addWorktreeForBranch` and
  `continueWorktree` now return worktrees that contain the copied
  files.

- [ ] **Step 1: Write the failing tests** in `test/worktree.test.ts`

```ts
test('createWorktree copies ignored .env and .agents', async t => {
    // commit .gitignore (.env, .agents/), then create both
    const wt = await createWorktree({ repoRoot, repoName,
        baseBranch, ticket })
    t.ok(existsSync(join(wt.worktreePath, '.env')))
    t.ok(existsSync(join(wt.worktreePath, '.agents/skills/x')))
})

test('addWorktreeForBranch copies ignored .env', async t => {
    // existing branch, then addWorktreeForBranch
    t.ok(existsSync(join(wt.worktreePath, '.env')))
})

test('worktree with copied files removes cleanly', async t => {
    // createWorktree, then removeWorktree with no force
    t.notOk(existsSync(wt.worktreePath))
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && npm test`
Expected: the two copy tests fail (`.env` missing).

- [ ] **Step 3: Call `copyLocalFiles(repoRoot, worktreePath)`**
  right after the `git worktree add` in both private functions,
  inside the queued function, so it runs before `continueWorktree`
  merges base and before any install.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build && npm test`
Expected: all suites pass, including the existing orchestrator,
review-pass and integration suites.

- [ ] **Step 5: Commit**

```bash
git add src/worktree.ts test/worktree.test.ts
git commit -m "feat: copy local files into every new worktree"
```

### Task 3: Warn about skipped files, and update docs

**Files:**
- Modify: `src/index.ts` (next to the install command detection,
  ~line 774)
- Modify: `README.md` (the `pi` IMPORTANT note, ~line 136)
- Modify: `AGENTS.md` (Project Structure, Git invariants, Module
  boundaries)

**Interfaces:**
- Consumes: `listLocalFiles(repoRoot).skipped` from Task 1.

- [ ] **Step 1: In an isolated run only**, before the run starts,
  print one `console.log` line per skipped path saying it is not
  copied into worktrees because it is not gitignored. Same
  placement and style as the "No test command detected" message.
  No test: the message text is not asserted (no brittle text
  tests), and the skip logic is covered in Task 1.

- [ ] **Step 2: README.** Replace the `pi` IMPORTANT note: redeye
  copies a gitignored `.agents/`, `.env` and `.dev.vars` from the
  repo root into each worktree, so ignoring `.agents/` is fine. An
  untracked file that is not ignored is not copied. Keep the note
  that `docs/agents/` must be committed.

- [ ] **Step 3: AGENTS.md.** Add `src/localfiles.ts` to Project
  Structure. Add a Git invariant: new worktrees get the root's
  gitignored `.agents`, `.env`, `.dev.vars` via the two private
  add functions in `src/worktree.ts`; only ignored files, so no
  auto-commit can stage a secret. Add `localfiles` to the
  Module boundaries list of modules with no orchestrator value
  imports. Bump "Last verified".

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: clean lint, all suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts README.md AGENTS.md
git commit -m "feat: warn about local files not copied; docs"
```
