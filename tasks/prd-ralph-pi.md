# PRD: ralph_pi.sh -- the Ralph loop on pi and the Tiiny device

## Introduction

`ralph_claude.sh` runs a one-task-per-session loop over
`specs/prd.json`: each iteration picks the highest-priority pending,
non-manual story, runs one Claude Code session on it, and decides
from git and the PRD whether the session made progress. Stalls raise
the reasoning effort; four stalls in a row stop the loop.

`ralph_pi.sh` (currently an empty, untracked file) must do the same
thing with the `pi` harness against the local Tiiny device (the
`tiiny` provider in `~/.pi/agent/models.json`). `ralph_codex.sh`
already ports the loop to a different harness and is the model for
the parts that change (wall-clock session timeout, argument
validation, `TERM` trap).

Three things about the Tiiny device shape this script:

1. A model must be **loaded (resident)** on the device to answer.
   When it is not, the device answers `404 "... is not loaded."`
   and **pi still exits 0**, so the loop would count a no-op session
   as a stall instead of reporting the real problem.
2. The script does not hard-code a model. It uses the model that is
   **currently loaded** on the device.
3. The `tiiny` provider config sets `supportsReasoningEffort:false`
   and `thinkingFormat:"qwen-chat-template"`, so `pi --thinking`
   most likely only turns thinking on or off on the device, not a
   graded level. The prompt-side reasoning hint carries the rest of
   the escalation.

## Goals

- `./ralph_pi.sh [MAX_ITERATIONS] [MAX_SESSION_SECONDS]` runs the
  same loop as `ralph_claude.sh`: same PRD selection, same prompt
  shape, same progress and stall rules, same exit codes 0, 2, 3, 130.
- The model is whatever is loaded on the Tiiny device: picked
  automatically when exactly one is loaded, chosen by the user when
  several are, and a clear error exit when none is.
- A model that is unloaded mid-run is loaded again before the next
  session, instead of burning stalls on 404s.
- Each session is bounded by wall-clock time, since pi has no
  `--max-turns`.
- The API key in `~/.pi/agent/models.json` is never printed, logged
  or written to a temp file.

## User Stories

Stories are in dependency order: implement them top to bottom.

### US-001: Port the loop skeleton to pi
**Description:** As a developer, I want `ralph_pi.sh` to run the
Ralph loop with `pi` instead of `claude` so that I can work through
`specs/prd.json` on the local device.

**Acceptance Criteria:**
- [ ] `ralph_pi.sh` is executable, starts with
      `#!/usr/bin/env bash` and `set -uo pipefail` (not `-e`)
- [ ] The helpers `prd_ok`, `count_pending`, `count_pending_manual`,
      `pending_list`, `pending_manual_list`, `current_task`,
      `effort_for_stall` and `reasoning_hint` behave exactly as in
      `ralph_claude.sh` (same jq filters, same manual:true handling)
- [ ] The per-session context file is built the same way:
      `PROMPT.md`, the `# THIS SESSION` block pinning one task, the
      remaining-tasks list, the last 8 lines of `progress.log`, and
      the reasoning hint
- [ ] The prompt is sent to pi on stdin, and pi runs as
      `pi -p --mode json --no-session --approve --model tiiny/<id>`
      (plus `--thinking`, see US-005)
- [ ] Preflight fails with exit 1 and a message naming the missing
      piece when `pi`, `jq`, `git`, `node` or `curl` is not on PATH,
      when `PROMPT.md` or `specs/prd.json` is missing, or when the
      cwd is not inside a git repo
- [ ] Completion, progress, dirty-tree warning, stall counting,
      `.wrangler/state/v3` clearing at stall 2, the `STALL_LIMIT=4`
      bail (exit 2), the malformed-PRD stop (exit 3), the
      only-manual-stories exit 0 and the `MAX_ITERATIONS` exit 0
      all match `ralph_claude.sh`
- [ ] The `<promise>COMPLETE</promise>` signal is trusted only when
      `count_pending` is 0 after the session, as in the Claude script
- [ ] Temp files are removed at the end of each iteration and by an
      `EXIT` trap; `INT` exits 130 and `TERM` exits 143
- [ ] `bash -n ralph_pi.sh` passes, and `shellcheck ralph_pi.sh`
      passes if shellcheck is installed

### US-002: Read the Tiiny provider without leaking the key
**Description:** As a developer, I want the script to read the Tiiny
endpoint and key from pi's own config so that the script and pi
always talk to the same device.

**Acceptance Criteria:**
- [ ] The models file is `$PI_MODELS_FILE` when set, otherwise
      `~/.pi/agent/models.json` (same rule as `src/tiiny.ts`)
- [ ] `baseUrl` and `apiKey` come from `.providers.tiiny`; an
      `apiKey` that starts with `$` is resolved from the environment
      variable of that name (same rule as `resolveApiKey` in
      `src/tiiny.ts`)
- [ ] A missing file, invalid JSON, or no `tiiny` provider exits 1
      with a message naming the file and what is missing
- [ ] The key is held only in a shell variable and passed to curl
      through a header read from stdin or a process substitution,
      never on a command line visible in `ps`, never echoed, never
      written to disk

### US-003: Pick the model from what is loaded on the device
**Description:** As a developer, I want the script to use the model
that is already loaded on the Tiiny device so that I choose the
model by loading it, not by editing the script.

**Acceptance Criteria:**
- [ ] The loaded models are read from `GET <baseUrl>/models` with
      `Authorization: Bearer <key>`; the ids are `.data[].id`
- [ ] An unreachable device or a non-2xx answer exits 4 with a
      message that includes the URL and the HTTP status or curl
      error (not the key)
- [ ] Zero loaded models exits 4 with a message telling the user to
      load one, e.g. `tiiny load <model-id>`, and listing the ids
      from the `tiiny` provider in the models file as candidates
- [ ] Exactly one loaded model is used without prompting, and the
      startup banner shows `MODEL: tiiny/<id>`
- [ ] Several loaded models and stdin is a TTY: the script shows a
      numbered list and reads a choice; an invalid choice asks again
- [ ] Several loaded models and stdin is not a TTY: exit 4 with a
      message listing the loaded ids
- [ ] A loaded id that is not in the `tiiny` provider's `models`
      list is not offered (pi could not use it); if that leaves no
      candidate, exit 4 and say which loaded ids are missing from
      the models file
- [ ] The model is chosen once at startup and stays fixed for the
      whole run

### US-004: Keep the model loaded before every session
**Description:** As a developer, I want the script to check that the
chosen model is still loaded before each session, and load it again
if not, so that a model unloaded mid-run does not turn into a chain
of empty sessions.

**Acceptance Criteria:**
- [ ] Before each session the script repeats the `GET /models`
      check for the chosen id
- [ ] If the id is missing, the script logs a warning and runs
      `tiiny load <id> -y` (binary from `$TIINY_BIN`, else
      `~/.local/tiiny/bin/tiiny`), first under
      `script -q /dev/null` for a pseudo-terminal and, if that
      fails, directly (same fallback as `runCliFallback` in
      `src/tiiny.ts`)
- [ ] After the load command, the script polls `GET /models` every
      2 seconds for up to 180 seconds until the id appears
- [ ] If the load command fails or the poll times out, the script
      exits 4 with a message; this is not counted as a stall
- [ ] A successful reload is logged and the session then runs
      normally

### US-005: Escalate effort with --thinking and the prompt hint
**Description:** As a developer, I want stalls to raise the thinking
level as well as the prompt hint so that the loop tries harder on a
stuck task, as the Claude script does.

**Acceptance Criteria:**
- [ ] `EFFORT_TIERS=("medium" "high" "max")`, indexed by the stall
      count and clamped at the last entry, as in `ralph_claude.sh`
- [ ] The chosen tier is passed as `pi --thinking <tier>`
- [ ] When the chosen model has `"reasoning": false` in the models
      file, `--thinking` is omitted and the startup banner says the
      ladder is prompt-only for this model
- [ ] The `reasoning_hint` text is still added to the prompt at
      every tier
- [ ] A comment near `EFFORT_TIERS` explains that the Tiiny device
      may treat any level as "thinking on"

### US-006: Bound each session by wall-clock time
**Description:** As a developer, I want each pi session to be killed
after a time limit so that one session cannot run forever on a slow
local model.

**Acceptance Criteria:**
- [ ] The second argument is `MAX_SESSION_SECONDS`, default 1800
- [ ] Both arguments are validated as positive decimal integers, and
      `MAX_SESSION_SECONDS` is at most 2147483, with a usage message
      and exit 1 otherwise (same checks as `ralph_codex.sh`)
- [ ] pi runs in its own process group under the same Node timer
      approach as `ralph_codex.sh`; on timeout the whole group is
      killed and the wrapper's status is 124
- [ ] A timed-out session logs
      `pi session timed out after <n>s` and is then judged by the
      normal progress rule (a commit or fewer pending counts)
- [ ] `INT` or `TERM` during a session also kills the pi process
      group, so no pi process is left behind

### US-007: Show the pi event stream live and catch provider errors
**Description:** As a developer, I want to see what the agent is
doing while it runs and be told when the device rejected the
request, so that a session that exits 0 with no work is not a
mystery.

**Acceptance Criteria:**
- [ ] pi's JSON lines are written raw to the capture file (tee
      before the formatter, as in `ralph_claude.sh`)
- [ ] A jq formatter prints one line per useful event: session
      start, assistant text, tool calls (name plus first 140 chars
      of input), tool results, retries, and the end of the session;
      unknown event types are skipped
- [ ] After the session, the last assistant `message_end` with
      `stopReason == "error"` in the capture is logged as
      `provider error: <errorMessage>` (same rule as `piTurnError`
      in `src/orchestrator.ts`)
- [ ] A provider error whose message contains `not loaded` is
      logged as such; the next iteration's US-004 check reloads the
      model
- [ ] A non-zero pi exit status other than 124 is logged with its
      code and treated as no progress, as in the Claude script

## Functional Requirements

- FR-1: `ralph_pi.sh [MAX_ITERATIONS] [MAX_SESSION_SECONDS]`,
  defaults 10 and 1800.
- FR-2: The script reads `PROMPT.md`, `specs/prd.json` and
  `progress.log` from the cwd, like `ralph_claude.sh`.
- FR-3: Story selection skips `passes:true` and `manual:true`
  stories and orders by `priority` (missing priority sorts last).
- FR-4: The Tiiny endpoint and key come from the `tiiny` provider in
  pi's models file, resolved as in `src/tiiny.ts`.
- FR-5: The run's model is the loaded model, chosen once at startup:
  one loaded uses it, several loaded prompts on a TTY, none loaded
  or several without a TTY exits 4.
- FR-6: Before every session the chosen model must be resident;
  if not, the script loads it with the tiiny CLI and waits up to
  180 seconds, else exits 4.
- FR-7: pi is invoked as
  `pi -p --mode json --no-session --approve --model tiiny/<id>
  [--thinking <tier>]` with the prompt on stdin.
- FR-8: Each session is killed after `MAX_SESSION_SECONDS`.
- FR-9: Progress means a new commit or fewer pending stories. A
  dirty tree alone is not progress.
- FR-10: Exit codes: 0 done, only manual stories left, or
  `MAX_ITERATIONS` reached; 1 preflight or usage error; 2 stalled
  `STALL_LIMIT` times; 3 malformed PRD; 4 Tiiny device or model
  problem; 130 `INT`; 143 `TERM`.
- FR-11: The API key is never printed, logged, put on a command line
  or written to disk.

## Non-Goals

- No changes to `ralph_claude.sh`, `ralph_codex.sh`, or any file
  under `src/` or `test/`.
- No cross-agent device lock (the lock in `tasks/prd-tiiny-device.md`
  is a separate piece of work). A second agent using the device will
  slow this loop down; the script does not detect that.
- No unloading or swapping models. The script never unloads a model,
  and it reloads only the one it chose at startup.
- No hard-coded default model and no `--model` argument.
- No automated test suite for the script; verification is
  `bash -n`, shellcheck, and a manual run (see Success Metrics).
- No support for providers other than `tiiny`.

## Technical Considerations

- `tiiny ls --loaded --json` still prints a table, so it is not a
  reliable source. `GET <baseUrl>/models` is the source of truth for
  what is resident, the same check `residentModels` in
  `src/tiiny.ts` uses.
- The `tiiny` provider's model `id`s (for example
  `Qwen/Qwen3.6-35B-A3B-turbo`) are what `/models` returns; pi's
  `--model` takes them with a `tiiny/` prefix.
- Pass the bearer header to curl without exposing it, for example
  `curl -H @- ... <<<"Authorization: Bearer $KEY"`. A hook in this
  workspace blocks any command that would echo the key.
- `tiiny load` needs a TTY to run unattended, hence the
  `script -q /dev/null` wrapper first.
- Read the session-timeout block in `ralph_codex.sh` (the `node -e`
  wrapper and the 124 handling) and reuse it rather than writing a
  new one. GNU `timeout` is not on macOS by default.
- pi's JSON stream event names the formatter can rely on are the
  ones redeye already parses: `message_end` (with
  `message.role`, `message.stopReason`, `message.errorMessage`).
  Check one real capture to pick the names for text deltas and tool
  calls before writing the jq filter, rather than guessing.
- The usual local test/lint commands from `PROMPT.md` still apply
  inside a session; on a slow local model the default 1800s cap may
  need raising for big stories.

## Success Metrics

- With one model loaded, `./ralph_pi.sh 1 600` picks the top pending
  story, runs one session, and prints the progress or stall line.
- With no model loaded, the script exits 4 within a few seconds with
  the "load a model" message and starts no pi process.
- With two models loaded and a TTY, the script asks which to use;
  with `</dev/null` it exits 4 and lists both.
- Unloading the model between iterations (`tiiny unload <id>`) makes
  the next iteration reload it and continue, with no stall counted.
- After any exit (done, stall, timeout, Ctrl-C) no `pi` or `node`
  process started by the script is still running, and no temp file
  remains.
- `grep` of the terminal output and `progress.log` for the API key
  finds nothing.

## Open Questions

- Should there be an env override (for example `RALPH_PI_MODEL`) so
  a non-interactive run can choose among several loaded models
  instead of exiting 4?
- Does the device honor any level beyond on/off for the loaded
  model? If not, should the ladder collapse to a single
  `--thinking high` tier and rely on the prompt hint alone?
- Is 1800s the right default per session on the device, given
  agent turns of 10s normally and 80-145s under contention?
- Should a provider error that is not `not loaded` (for example a
  device crash) stop the run like redeye does, rather than count as
  a stall?
