# PRD: Share the Tiiny device safely during a run

Source: a debugging session on a slow `roast` run
(`redeye pi -m tiiny/Qwen/Qwen3.6-35B-A3B-turbo --concurrency 1`) and the
article
[tiiny-model-routing](https://github.com/garciacionet-alt/AI_Articles/tree/main/tiiny-model-routing),
as ported to pi in `~/code/tiiny_router`. Stories are in dependency order:
implement them top to bottom.

## Introduction

redeye can run every ticket on a local model served by a Tiiny device
(the `tiiny` provider in `~/.pi/agent/models.json`). That device has
three properties redeye does not know about today:

1. **It serves one generation-heavy stream at a time.** A second agent
   using the device does not fail. Both agents slow down. In the
   `roast` run, another pi session sent test prompts to the device and
   redeye's agent turns went from about 10 seconds to 80-145 seconds.
   Each ticket still ran out its timeout, so the run looked slow, not
   broken.
2. **A model must be resident (loaded) to answer.** A model that is
   not loaded answers `404 "... is not loaded."`. pi exits 0 anyway,
   so redeye records "no commits", spends a retry, and after the last
   retry skips the ticket for the rest of the run. Two `roast` runs
   were lost this way in a few seconds each.
3. **Reasoning is controlled by fields pi may not send.** The device
   reads `chat_template_kwargs.enable_thinking` (models with an on/off
   switch) or a top-level `reasoning_effort` (models with levels only).
   With the usual `tiiny` provider config
   (`"supportsReasoningEffort": false` and no `thinkingFormat`), pi
   sends neither. redeye's `--effort` and its retry effort ladder then
   change the `thinkingLevel` in the logs and nothing on the device.

`~/code/tiiny_router` (the pi port of the article) already solves the
first two for its own sessions, with a cross-agent **device lock** and
a controller that **loads models under that lock**. This PRD adds the
same behavior to redeye, natively in TypeScript and compatible with
tiiny-router's lock file, so a redeye run and a tiiny-router session
see and respect each other. It also adds a startup check that warns
when `--effort` will not reach the device.

### Terms

- **Tiiny run:** a run where the provider is `pi` and at least one
  model id (from `-m`, or from a role string in `.redeye.json`)
  starts with `tiiny/`.
- **Device model id:** the model id without the `tiiny/` prefix, for
  example `Qwen/Qwen3.6-35B-A3B-turbo`.
- **Resident:** listed by `GET <baseUrl>/models` on the device.
- **Device lock:** the JSON file tiiny-router's controller uses as a
  cross-agent mutex. Default path `~/.pi/agent/tiiny/tiiny-lock.json`.
  Its contents, not the file's existence, say whether it is held.
- **Hold file:** a file listing the model ids an agent loaded on
  purpose. A device watchdog that reloads a fixed set of models reads
  it and leaves those models alone. Default path
  `~/.pi/agent/tiiny/tiiny-hold`.
- **Not-loaded failure:** an agent run whose stream contains an
  assistant message with `stopReason: "error"` and an `errorMessage`
  containing `is not loaded` or `model_not_found`.

## Goals

- No ticket attempt is lost to a model that is not loaded: redeye
  loads the run's models before the first agent starts, and recovers
  from a not-loaded failure mid-run without spending a retry.
- While a Tiiny run is in progress, no other agent that honors the
  device lock (tiiny-router's `tr`, or another redeye run) can start
  using the device, and redeye refuses to start while another agent
  holds it.
- The device lock is always released when redeye exits: normally,
  on Ctrl-C (SIGINT), on SIGTERM, and on an uncaught error. A redeye
  process that dies without cleanup cannot hold the device past the
  lock's expiry.
- A user who passes `--effort` (or relies on retries raising effort)
  on a Tiiny run is told at startup when that setting cannot reach
  the device, and how to fix their pi config.
- A run that is not a Tiiny run behaves exactly as it does today.

## User Stories

### US-001: Detect a Tiiny run and read its device settings

**Description:** As a developer, I need redeye to recognize a Tiiny
run and read the device settings from pi's config, so later stories
know which models to load and where the device is.

**Acceptance Criteria:**

- [ ] A run is a Tiiny run when the provider is `pi` and any model id
      used by the run starts with `tiiny/`. This includes role strings
      in `.redeye.json` (for example the `review` role of the
      adversarial loop).
- [ ] For a Tiiny run, redeye reads the `tiiny` provider from
      `~/.pi/agent/models.json` (override with `PI_MODELS_FILE` for
      tests) and gets `baseUrl`, `apiKey` and `compat`.
- [ ] `apiKey` is resolved the way pi resolves it: if it names a set
      environment variable, the variable's value is used; otherwise
      the literal value is used. The key is never logged or written
      to any log, learnings entry or progress file.
- [ ] The run's device model ids are the distinct ids with the
      `tiiny/` prefix removed.
- [ ] If the run is a Tiiny run and `models.json` has no `tiiny`
      provider, redeye exits non-zero before creating any worktree,
      with a message naming the file it read.
- [ ] A run whose models do not start with `tiiny/` never reads
      `models.json` and never contacts the device.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-002: Device client for residency and loading

**Description:** As a developer, I need a small client that can tell
which models are resident and load one, so the run can start with
its models in place.

**Acceptance Criteria:**

- [ ] `residentModels()` calls `GET <baseUrl>/models` with
      `Authorization: Bearer <key>` and returns the ids in `data[].id`.
      A network error or non-200 response is returned as an error
      value, not thrown past the caller.
- [ ] `loadModel(id)` first tries the device's HTTP lifecycle API:
      `POST <host>/api/v1/models/<id>/start` with the same bearer,
      where `<host>` is `TIINY_HOST` or `http://tiinyhost.local`.
      After a 200, it polls `residentModels()` every 2 seconds until
      `id` is listed or 180 seconds pass.
- [ ] If the HTTP API fails, `loadModel(id)` falls back to the CLI:
      `script -q /dev/null <tiiny> load <id> -y`, where `<tiiny>` is
      `TIINY_BIN` or `~/.local/tiiny/bin/tiiny`. (`script` gives the
      CLI the terminal it insists on.) Then it polls residency as
      above.
- [ ] `loadModel` returns success only when the model is listed as
      resident afterwards. It never reports success from the HTTP
      status alone.
- [ ] Tests run against a local fake device server (an HTTP server
      started by the test), never against a real device.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-003: Device lock compatible with tiiny-router

**Description:** As a user running redeye and tiiny-router on one
machine, I want them to use the same lock, so they never generate on
the device at the same time.

**Acceptance Criteria:**

- [ ] The lock path is `TIINY_LOCK_FILE` if set, else
      `$TIINY_HOME/tiiny-lock.json`, where `TIINY_HOME` defaults to
      `~/.pi/agent/tiiny`. These are the same variables and default
      that tiiny-router's controller uses.
- [ ] A held lock has this JSON shape, the same as tiiny-router
      writes: `{"state": "held", "owner", "task", "models",
      "created", "expires", "pid"}`, with `created` and `expires` as
      Unix seconds (floats allowed). A released lock is
      `{"state": "released", "owner", "task", "released", "pid"}`.
- [ ] `acquire` takes the lock when the file is missing, released,
      or held with `expires` in the past. It renews (extends
      `expires`) when the current holder has the same `owner`. It
      fails when another owner holds an unexpired lock, and the error
      names that owner, its task and the expiry time.
- [ ] Every read-modify-write of the lock file happens inside an
      exclusive `flock` on that file, the same primitive
      tiiny-router's Python controller uses, so the two cannot both
      take the lock. If the `flock` itself is busy, `acquire` reports
      that and does not write.
- [ ] The `flock` critical section runs in a `python3` helper that
      redeye spawns (see Technical Considerations). redeye adds no
      native dependency.
- [ ] Before the first lock operation, redeye checks that `python3`
      runs (for example `python3 -c 'import fcntl'` exits 0 within a
      few seconds). If `python3` is missing, or is the macOS stub
      that asks to install the Command Line Tools, redeye exits
      non-zero before creating any worktree, with a message that says
      to install Python 3 or pass `--no-device-lock`. It never hangs
      waiting on the stub's install prompt.
- [ ] `release` writes the released state (a write, not a delete) and
      only succeeds when redeye's owner matches the holder.
- [ ] redeye's owner string is `redeye:<feature>:<pid>`, and the task
      is the feature name.
- [ ] A test acquires the lock in redeye, then shows that
      tiiny-router's controller (`python3 controller/tiiny_ctl.py
      reserve`, run against the same `TIINY_HOME`) is refused, and the
      reverse. Skip this test with a clear message when `python3` or
      the controller script is not available.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-004: Hold file

**Description:** As a user with a device watchdog, I want redeye to
record the models it loaded, so the watchdog does not evict them
mid-run.

**Acceptance Criteria:**

- [ ] The hold path is `TIINY_HOLD_FILE` if set, else
      `$TIINY_HOME/tiiny-hold`.
- [ ] `holdWrite(ids)` writes one model id per line.
- [ ] `holdClear()` truncates the file to empty, then deletes it if
      it can. A truncated or missing file both count as released.
      If the file still has content afterwards, it reports an error
      naming the path.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-005: Reserve, load and release around the run

**Description:** As a user, I want a Tiiny run to take the device at
startup, make sure its models are loaded, and give the device back
however the run ends.

**Acceptance Criteria:**

- [ ] For a Tiiny run, before the first worktree is created, redeye
      in this order: acquires the lock (US-003), writes the hold with
      the run's device model ids (US-004), loads each id that is not
      resident (US-002), then checks that every id is resident.
- [ ] If the lock is held by another owner, redeye exits non-zero
      before creating any worktree. The message names the holder
      and says how to see it (`npx tr status` from tiiny-router).
- [ ] If any model is still not resident after loading, redeye
      releases the lock, clears the hold, and exits non-zero naming
      the model. This covers a pair of models that cannot be
      resident together.
- [ ] The lock is taken with a time to live of 30 minutes (override:
      `--device-lock-ttl <seconds>`), and redeye renews it every 5
      minutes while the run is in progress.
- [ ] On every exit path, redeye clears the hold and releases the
      lock: normal completion, a run with failed tickets, SIGINT,
      SIGTERM, and an uncaught error. The existing exit codes (130
      for SIGINT, 143 for SIGTERM) are unchanged.
- [ ] `--no-device-lock` skips the lock, the hold and loading
      entirely, and prints one line saying so at startup.
- [ ] `--dry-run` never contacts the device and never touches the
      lock or hold files. It prints what it would do (`Device lock:
      <path>`, `Device models: <ids>`).
- [ ] Tests use the fake device server and temp `TIINY_HOME`, and
      assert observable results: lock file state after exit, hold
      file content, models the fake server was asked to load, exit
      code.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-006: Recover from a not-loaded failure mid-run

**Description:** As a user, I want an attempt that failed only
because the model was evicted to be re-run after a reload, so it
does not cost a retry or get the ticket skipped.

**Acceptance Criteria:**

- [ ] After a pi agent exits, redeye checks its JSON stream for a
      not-loaded failure (see Terms). This check runs before the
      no-commits check.
- [ ] On a not-loaded failure in a Tiiny run, redeye reloads the
      model (US-002) while still holding the lock, then re-runs the
      same attempt from a fresh worktree. The re-run does not count
      toward `--retries`, does not wait `--retry-delay`, and does not
      raise the effort level.
- [ ] Each attempt can be recovered this way at most 2 times. After
      that, the attempt is an ordinary failure.
- [ ] If the reload fails, the attempt is an ordinary failure, and
      the learnings entry says the model could not be reloaded.
- [ ] Each recovery appends a learnings entry with a new outcome,
      `not-loaded`, naming the model. The entry is parsed back by
      `learnings.ts` like the existing outcomes.
- [ ] With `--no-device-lock`, a not-loaded failure is still
      reported as `not-loaded` (not `no-commits`), but redeye does
      not reload. It is counted as a failed attempt.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-007: Warn when effort cannot reach the device

**Description:** As a user who passes `--effort`, I want to know at
startup when that setting has no effect on the device, and what to
change.

**Acceptance Criteria:**

- [ ] For a Tiiny run where `--effort` is given or `--retries` is
      above 0, redeye inspects the `tiiny` provider's `compat`. When
      `supportsReasoningEffort` is not `true` and `thinkingFormat` is
      not set, it prints one warning saying pi will not send a
      reasoning setting, so the model runs at the device's default.
- [ ] When the device can be reached, the warning includes the
      device's `thinking` block for each run model, read from
      `GET <baseUrl>/models` (fields `toggleable`, `levels`,
      `default_level`), and suggests the matching fix:
      `"thinkingFormat": "qwen-chat-template"` for a toggleable model,
      `"supportsReasoningEffort": true` for a model with levels only.
- [ ] The warning is printed once per run, never blocks the run, and
      is skipped entirely when the config would send a setting.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-008: Warn about concurrency on a Tiiny run

**Description:** As a user, I want redeye to tell me when
`--concurrency` above 1 will only slow a Tiiny run down.

**Acceptance Criteria:**

- [ ] For a Tiiny run with `--concurrency` above 1 (including the
      default of 5), redeye prints one warning at startup that the
      device answers one request at a time, so agents will share
      its speed and each agent's `--timeout` will buy less work.
- [ ] The run proceeds with the concurrency the user chose.
- [ ] Typecheck and lint pass, and `npm test` passes.

### US-009: Document Tiiny runs

**Description:** As a user, I want the README to explain what redeye
does with a Tiiny device and how to configure it.

**Acceptance Criteria:**

- [ ] The "Local Model With `pi`" section of `README.md` describes
      the lock, the hold, loading at startup, recovery from a
      not-loaded failure, and the new flags (`--no-device-lock`,
      `--device-lock-ttl`).
- [ ] It shows the `compat` settings that let `--effort` reach the
      device, and says which one applies to which kind of model.
- [ ] It explains that tiiny-router's `npx tr status` shows who holds
      the device, and that redeye and tiiny-router share the lock.
- [ ] The "Command Line Arguments" table lists both new flags.
- [ ] The README contains no em dashes and no arrow characters.

## Functional Requirements

- FR-1: redeye must treat a run as a Tiiny run when the provider is
  `pi` and any model id used by the run starts with `tiiny/`.
- FR-2: For a Tiiny run, redeye must read `baseUrl`, `apiKey` and
  `compat` for the `tiiny` provider from `~/.pi/agent/models.json`
  (or `PI_MODELS_FILE`), and must never log the resolved key.
- FR-3: redeye must list resident models with
  `GET <baseUrl>/models` and load a model with
  `POST <host>/api/v1/models/<id>/start`, falling back to
  `script -q /dev/null <tiiny> load <id> -y`, and must confirm
  residency after every load.
- FR-4: redeye must read and write the device lock at the same path,
  in the same JSON shape and under the same `flock` as tiiny-router's
  controller.
- FR-5: Before creating the first worktree of a Tiiny run, redeye
  must acquire the lock, write the hold, and make every run model
  resident, or exit non-zero having released anything it took.
- FR-6: redeye must renew the lock every 5 minutes during a Tiiny run
  and release it, and clear the hold, on every exit path.
- FR-7: redeye must classify a pi run that ended in a 404
  `is not loaded` / `model_not_found` error as `not-loaded`, reload
  the model, and re-run the attempt without spending a retry, at most
  twice per attempt.
- FR-8: redeye must warn once at startup when `--effort` or the retry
  effort ladder cannot reach the device, and when `--concurrency` is
  above 1 on a Tiiny run.
- FR-9: `--no-device-lock` must turn off FR-4 to FR-6 and the reload
  in FR-7. `--dry-run` must not contact the device or touch the lock
  or hold files.
- FR-10: A run that is not a Tiiny run must not read `models.json`,
  contact the device, or touch the lock or hold files.

## Non-Goals

- No per-ticket model routing. Every ticket keeps using the model
  from `-m` (or its role string). redeye does not use tiiny-router's
  virtual models or tier table.
- No NPU budgeting or wave packing. If the run's models cannot be
  resident together, redeye reports it (US-005) instead of planning
  around it.
- No rewriting of pi's requests to the device. Reasoning control
  stays in pi's `models.json`; redeye only warns.
- No restoring the device's previous models after the run. redeye
  releases the lock and the hold; a watchdog or `npx tr release`
  restores whatever set the user configured.
- No status-board announcement of the lock (tiiny-router's
  `announce_set`).
- No support for tiiny-router's multi-device registry
  (`tiiny-lock-<device>.json`). redeye uses the default lock path or
  `TIINY_LOCK_FILE`.
- No waiting for a held device. redeye refuses to start; waiting is
  an open question.

## Technical Considerations

- **`flock` through a `python3` helper.** Node has no built-in
  `flock`, and tiiny-router's controller locks with `fcntl.flock`
  (`flock(2)`), so redeye must use the same call to exclude it.
  `mkdir`/`O_EXCL` lock files and POSIX record locks (`lockf`,
  `fcntl(F_SETLK)`) do not exclude a `flock` holder. redeye spawns
  `python3` to run each lock operation (acquire, renew, release) as
  one short critical section: open the lock file, `flock(LOCK_EX |
  LOCK_NB)`, read, decide, write, unlock, then print the result as
  JSON on stdout for redeye to parse. The flock is held for
  milliseconds; the lock's lasting state is the file's JSON contents
  and their expiry. A spawn every 5 minutes for renewal costs
  nothing noticeable.
  - Why not a native dependency: the usual package (`fs-ext`) has no
    prebuilt binaries and compiles with `node-gyp` on every install,
    which needs Xcode Command Line Tools on macOS and a C++ toolchain
    on Linux, and would be installed for every redeye user, not only
    Tiiny users. Anyone sharing this lock already runs tiiny-router's
    Python controller, so they already have `python3`.
  - The helper script ships inside the package (for example
    `src/tiiny-lock.py`) and is run with `python3 -I` so nothing in
    the working directory can shadow its imports. The build's `copy`
    script in `package.json` copies only `skills/` and
    `docs-templates/` today, so it must also copy the helper into
    `dist/`, and a test must check the helper is present in the
    packed tarball (`npm pack --dry-run`).
  - `flock` is not reliable on network filesystems. The default lock
    path is on the local disk, so this only matters if a user points
    `TIINY_HOME` or `TIINY_LOCK_FILE` at a network mount.
- **Where the code goes.** A new `src/tiiny.ts` (config, device
  client, lock, hold) keeps the orchestrator change small: startup
  and shutdown hooks in `runWaves` / `runWavesIsolated`, and the
  not-loaded check where agent outcomes are classified in
  `src/orchestrator.ts`. The new `not-loaded` outcome is added to
  `LearningOutcome` in `src/learnings.ts`.
- **Signal handling.** redeye already kills agent process groups on
  SIGINT and SIGTERM. The lock release and hold clear must run in the
  same handlers, before the process exits, and must not throw if the
  lock was never taken.
- **Detecting a not-loaded failure.** In pi's `--mode json` stream
  the failure is an assistant `message_end` with
  `"stopReason":"error"` and an `errorMessage` like
  `404: {"message":"\"Qwen/Qwen3.6-35B-A3B-turbo\" is not loaded.",
  "type":"model_not_found","code":404}`. pi exits 0 in this case.
- **Tests.** Follow the repo convention: assert observable results
  (exit code, lock and hold file contents, which models the fake
  server was asked to load, ticket status, learnings outcome), never
  message wording or internal call order. Use a fake device HTTP
  server and a temp `TIINY_HOME`; never require a real device.
- **Paths and environment.** Honor `TIINY_HOME`, `TIINY_LOCK_FILE`,
  `TIINY_HOLD_FILE`, `TIINY_HOST`, `TIINY_BIN` and `PI_MODELS_FILE`
  so tests and unusual setups can redirect everything.

## Success Metrics

- Zero ticket attempts recorded as `no-commits` because the model was
  not loaded, across a full Tiiny run.
- While a Tiiny run holds the lock, tiiny-router's `npx tr reserve`
  is refused, and a redeye run started while `tr` holds the lock
  exits before creating a worktree.
- On an uncontended device, the median time per agent turn in ticket
  logs matches the baseline from the Nov 19 `roast` run (about 10
  seconds for exploration turns).
- After any redeye exit, `npx tr status` shows the lock released and
  no hold.

## Open Questions

- Should redeye wait for a held device (for example
  `--device-wait <seconds>`) instead of refusing to start? Overnight
  runs might prefer waiting.
- Should redeye also reload the model before each retry, not only
  after a not-loaded failure? It costs a residency call per attempt
  and would catch evictions earlier.
- Should the lock be released during long install and test gates so
  other agents can use the device? This PRD holds it for the whole
  run, which is simpler and matches the decision made for it.
- If the user runs a device watchdog that does not read the hold file,
  loads can be undone mid-run. Is recovery (US-006) enough, or should
  redeye detect and report a watchdog that keeps evicting?
- Should a Tiiny run also be recognized by `baseUrl` (any pi provider
  pointing at the device), not only by the `tiiny/` model prefix?
