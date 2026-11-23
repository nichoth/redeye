#!/usr/bin/env bash
#
# One task per Codex session. Bash owns the cadence; Codex owns the work.
# Usage: ./ralph_codex.sh [MAX_ITERATIONS] [MAX_SESSION_SECONDS]
# Example: ./ralph_codex.sh 200 1800
# The second argument is a wall-clock timeout, not a model turn limit.
#
set -uo pipefail # Per-session failures are handled below.

PROMPT_FILE="PROMPT.md"
PRD_FILE="specs/prd.json"
LOG_FILE="progress.log"
MODEL="gpt-6.1-sol"
MAX_ITERATIONS=${1:-10}
MAX_SESSION_SECONDS=${2:-1800}
STALL_LIMIT=4
ITERATION=0
STALLED_COUNT=0
TMP_CONTEXT=""
TMP_CAPTURE=""

# Supported by gpt-6.1-sol. Stalls use medium, high, max, max.
# Progress resets effort to medium.
EFFORT_TIERS=("medium" "high" "max")

BLUE='\033[1;34m'
YELLOW='\033[1;33m'
GREEN='\033[1;32m'
MAGENTA='\033[1;35m'
RED='\033[1;31m'
NC='\033[0m'
log_info()    { printf '%b\n' "${BLUE}ℹ️  $1${NC}"; }
log_step()    { printf '%b\n' "${YELLOW}➔ $1${NC}"; }
log_success() { printf '%b\n' "${GREEN}✅ $1${NC}"; }
log_warn()    { printf '%b\n' "${MAGENTA}⚠️  $1${NC}"; }
log_error()   { printf '%b\n' "${RED}✖ $1${NC}"; }

# Called indirectly by the EXIT trap.
# shellcheck disable=SC2317
cleanup() {
    rm -f "${TMP_CONTEXT:-}" "${TMP_CAPTURE:-}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'echo; log_warn "Stopping Ralph Loop..."; exit 130' INT
trap 'exit 143' TERM

# Validate decimal arguments before Bash arithmetic or Node timers see them.
if [ "$#" -gt 2 ]; then
    log_error "Usage: $0 [MAX_ITERATIONS] [MAX_SESSION_SECONDS]"
    exit 1
fi
for value in "$MAX_ITERATIONS" "$MAX_SESSION_SECONDS"; do
    if ! [[ "$value" =~ ^[1-9][0-9]{0,6}$ ]]; then
        log_error "Limits must be integers between 1 and 9999999."
        exit 1
    fi
done
# Node timers cannot exceed 2^31-1 milliseconds.
if [ "$MAX_SESSION_SECONDS" -gt 2147483 ]; then
    log_error "MAX_SESSION_SECONDS must be at most 2147483."
    exit 1
fi

for bin in codex jq git node; do
    if ! command -v "$bin" >/dev/null 2>&1; then
        log_error "'$bin' not found in PATH."
        exit 1
    fi
done
for f in "$PROMPT_FILE" "$PRD_FILE"; do
    if [ ! -f "$f" ]; then
        log_error "Missing required file: $f"
        exit 1
    fi
done
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log_error "Not inside a git repo."
    exit 1
fi
touch "$LOG_FILE" || exit 1

# Reject invalid story fields instead of silently treating them as completed.
# Slurp requires exactly one JSON document, including for empty files.
prd_ok() {
    jq -se '
        length == 1 and (.[0] |
            type == "object" and (.userStories | type == "array")
            and all(.userStories[];
                type == "object"
                and (.id | type == "string")
                and (.title | type == "string")
                and (.passes == null or (.passes | type == "boolean"))
                and (.manual == null or (.manual | type == "boolean"))
                and (.priority == null or (.priority | type == "number"))
            )
        )
    ' "$PRD_FILE" >/dev/null 2>&1
}

require_prd() {
    if ! prd_ok; then
        log_error "$PRD_FILE is missing, malformed, or has invalid stories."
        exit 3
    fi
}

# Count failures propagate; no numeric sentinel can masquerade as progress.
count_pending() {
    jq -r '[.userStories[] |
        select(.passes != true and .manual != true)] | length' "$PRD_FILE"
}

pending_list() {
    jq -r '.userStories[] | select(.passes != true) |
        "[\(.id)] \(.title)" +
        (if .manual == true then " (manual -- excluded)" else "" end)
    ' "$PRD_FILE"
}

current_task() {
    jq -r '
        [.userStories[] | select(.passes != true and .manual != true)]
        | sort_by(.priority // 9999)
        | (.[0] // empty) | "[\(.id)] \(.title)"
    ' "$PRD_FILE"
}

report_complete() {
    local manual
    manual=$(jq '[.userStories[] |
        select(.passes != true and .manual == true)] | length' \
        "$PRD_FILE") || exit 3
    if [ "$manual" -gt 0 ]; then
        log_success "No headless work left; only manual:true stories remain:"
        pending_list
        log_info "Run each via ./ralph_device.sh <story-id> when attended."
    else
        log_success "All tasks in $PRD_FILE pass. Nothing left to do."
    fi
}

effort_for_stall() {
    local n="$1" last=$(( ${#EFFORT_TIERS[@]} - 1 ))
    [ "$n" -gt "$last" ] && n="$last"
    echo "${EFFORT_TIERS[$n]}"
}

reasoning_hint() {
    case "$1" in
        0) ;;
        1) echo "REASONING: Think step by step before acting." ;;
        2) echo "REASONING: Re-read progress.log and the spec."
           echo "Question earlier assumptions and try a different approach." ;;
        *) echo "REASONING: This task has stalled repeatedly."
           echo "Re-read Codebase Patterns and learnings in progress.log."
           echo "Abandon failed approaches and try a different strategy." ;;
    esac
}

# Node is already required by this project. Unlike GNU timeout, it is also
# available on the supported macOS setup without another package install.
# Give Codex its own process group so the deadline covers its descendants.
run_codex() {
    # The template literal belongs to JavaScript, not Bash.
    # shellcheck disable=SC2016
    node -e '
        const { spawn } = require("node:child_process");
        const seconds = Number(process.argv[1]);
        const child = spawn("codex", [
            "exec", "-", "--json", "--model", process.argv[2],
            "-c", `model_reasoning_effort=${process.argv[3]}`,
            "--sandbox", "workspace-write",
            "-c", "approval_policy=\"never\"",
            "-c", "sandbox_workspace_write.network_access=true"
        ], { stdio: "inherit", detached: true });
        let stopCode;
        function killGroup(signal) {
            if (!child.pid) return;
            try { process.kill(-child.pid, signal); }
            catch (error) {
                if (error.code !== "ESRCH") console.error(error.message);
            }
        }
        function stop(code) {
            if (stopCode !== undefined) return;
            stopCode = code;
            clearTimeout(deadline);
            killGroup("SIGTERM");
            // Keep this timer even if Codex exits before its descendants.
            setTimeout(() => {
                killGroup("SIGKILL");
                process.exit(code);
            }, 2000);
        }
        const deadline = setTimeout(() => stop(124), seconds * 1000);
        process.on("SIGINT", () => stop(130));
        process.on("SIGTERM", () => stop(143));
        child.on("error", error => {
            console.error(error.message);
            clearTimeout(deadline);
            process.exitCode = 1;
        });
        child.on("close", (code, signal) => {
            if (stopCode !== undefined) return;
            clearTimeout(deadline);
            process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
        });
    ' "$MAX_SESSION_SECONDS" "$MODEL" "$EFFORT"
}

while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
    ITERATION=$((ITERATION + 1))
    require_prd
    PENDING_BEFORE=$(count_pending) || exit 3
    if [ "$PENDING_BEFORE" -eq 0 ]; then
        report_complete
        exit 0
    fi
    TASK=$(current_task) || exit 3
    HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo none)
    EFFORT=$(effort_for_stall "$STALLED_COUNT")

    if [ "$STALLED_COUNT" -eq 2 ] && [ -d .wrangler/state/v3 ]; then
        log_warn "Friction detected — clearing .wrangler/state/v3 ..."
        rm -rf .wrangler/state/v3
    fi

    log_info "ITERATION $ITERATION/$MAX_ITERATIONS | PENDING: $PENDING_BEFORE"
    log_info "STALL: $STALLED_COUNT/$STALL_LIMIT | EFFORT: $EFFORT"
    log_step "TARGET: $TASK"

    TMP_CONTEXT=$(mktemp) || exit 1
    {
        cat "$PROMPT_FILE"
        echo
        echo "# THIS SESSION"
        echo "Work on EXACTLY ONE task: $TASK"
        echo "Write failing tests first, implement, lint, run relevant tests,"
        echo "update progress.log, set passes:true for this story, and commit."
        echo "When that task is done and committed, STOP. Do not start another"
        echo "task or mark another story passing. Leave manual stories alone."
        echo
        echo "Remaining tasks (context only):"
        pending_list
        echo
        echo "LAST_LOG_ENTRIES:"
        tail -n 8 "$LOG_FILE"
        reasoning_hint "$STALLED_COUNT"
    } > "$TMP_CONTEXT"

    # Capture raw Codex JSONL before rendering events for the terminal.
    TMP_CAPTURE=$(mktemp) || exit 1
    run_codex < "$TMP_CONTEXT" | tee "$TMP_CAPTURE" |
        jq --unbuffered -r '
            if .type == "thread.started" then
                "🟦 session start (" + .thread_id + ")"
            elif .type == "item.completed" then
                .item |
                if .type == "agent_message" then "💬 " + .text
                elif .type == "reasoning" then "🧠 " + (.text // "")
                elif .type == "command_execution" then
                    "🔧 " + .command + " (exit " +
                    ((.exit_code // "?") | tostring) + ")"
                elif .type == "file_change" then
                    "📝 " + (.changes | tostring)
                elif .type == "mcp_tool_call" then
                    "🔧 " + .server + ": " + .tool
                else empty end
            elif .type == "turn.completed" then
                "✅ turn completed " + (.usage | tostring)
            elif .type == "turn.failed" then
                "✖ " + (.error.message // "turn failed")
            elif .type == "error" then
                "✖ " + (.message // "Codex error")
            else empty end
        '
    PSTATUS=("${PIPESTATUS[@]}")
    CODEX_RC="${PSTATUS[0]}" # 0=run_codex 1=tee 2=jq
    if [ "${PSTATUS[1]}" -ne 0 ] || [ "${PSTATUS[2]}" -ne 0 ]; then
        log_error "Failed to capture or render Codex output."
        exit 1
    fi
    case "$CODEX_RC" in
        124) log_warn "Codex session timed out after ${MAX_SESSION_SECONDS}s."
             ;;
        130|143) exit "$CODEX_RC" ;;
        0) ;;
        *) log_warn "Codex exited non-zero (rc=$CODEX_RC)." ;;
    esac

    # Trust the PRD, not a completion phrase that can appear in tool output.
    require_prd
    PENDING_AFTER=$(count_pending) || exit 3
    if [ "$PENDING_AFTER" -eq 0 ]; then
        report_complete
        exit 0
    fi

    HEAD_AFTER=$(git rev-parse HEAD 2>/dev/null || echo none)
    if [ -n "$(git status --porcelain)" ]; then
        log_warn "Working tree left dirty. Codex should commit completed work."
    fi
    # A failed session does not reset stalls, even if it wrote files.
    if [ "$CODEX_RC" -eq 0 ] && {
        [ "$HEAD_AFTER" != "$HEAD_BEFORE" ] ||
        [ "$PENDING_AFTER" -lt "$PENDING_BEFORE" ]
    }; then
        DELTA=$((PENDING_BEFORE - PENDING_AFTER))
        if [ "$DELTA" -gt 1 ]; then
            log_warn "Pending dropped by $DELTA: more than one task completed."
        fi
        log_success "Progress (pending: $PENDING_BEFORE → $PENDING_AFTER)."
        STALLED_COUNT=0
    else
        STALLED_COUNT=$((STALLED_COUNT + 1))
        log_warn "No progress (stall $STALLED_COUNT/$STALL_LIMIT)."
    fi

    rm -f "$TMP_CONTEXT" "$TMP_CAPTURE"
    TMP_CONTEXT=""
    TMP_CAPTURE=""
    if [ "$STALLED_COUNT" -ge "$STALL_LIMIT" ]; then
        log_error "Stalled $STALL_LIMIT sessions. Stopping for human review."
        exit 2
    fi
done

log_warn "Reached $MAX_ITERATIONS iterations; $PENDING_AFTER tasks pending."
exit 1
