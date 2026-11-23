#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN_TMP=$(mktemp -d "${TMPDIR:-/tmp}/ralph-codex-test-XXXXXX")
trap 'rm -rf "$RUN_TMP"' EXIT
mkdir -p "$RUN_TMP/bin" "$RUN_TMP/template"

# Only the external agent is faked; PRD edits, pipelines and Git are real.
cat > "$RUN_TMP/bin/codex" <<'AGENT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >> args.log
cat > prompt.log
echo '{"type":"thread.started","thread_id":"test-thread"}'
echo '{"type":"turn.started"}'
case "$RALPH_TEST_MODE" in
    done|manual)
        jq '.userStories[0].passes = true' specs/prd.json > updated.json
        mv updated.json specs/prd.json
        ;;
    corrupt) echo '{broken' > specs/prd.json ;;
    shape) echo '{"userStories":[null]}' > specs/prd.json ;;
    error)
        echo '{"type":"error","message":"provider unavailable"}'
        echo '{"type":"turn.failed","error":{"message":"turn failed"}}'
        exit 1
        ;;
    hang)
        # Ignore TERM, including in a descendant, to exercise group cleanup.
        trap '' TERM
        sleep 120 &
        echo "$!" > descendant.pid
        wait
        ;;
esac
jq -c . <<'EVENTS'
{"type":"item.started","item":{
    "id":"1","type":"command_execution",
    "command":"git status","status":"in_progress"
}}
{"type":"item.completed","item":{
    "id":"1","type":"command_execution","command":"git status",
    "status":"completed","exit_code":0
}}
{"type":"item.completed","item":{
    "id":"2","type":"agent_message","text":"session output"
}}
{"type":"turn.completed","usage":{
    "input_tokens":10,"cached_input_tokens":2,"output_tokens":5
}}
EVENTS
AGENT
chmod +x "$RUN_TMP/bin/codex"

FAILURES=0
check() {
    local label="$1"
    shift
    if "$@"; then
        echo "ok - $label"
    else
        echo "not ok - $label"
        FAILURES=$((FAILURES + 1))
    fi
}

run_case() {
    local mode="$1" iterations="${2:-1}" seconds="${3:-60}"
    CASE_DIR="$RUN_TMP/$mode-$iterations-$seconds"
    mkdir -p "$CASE_DIR/specs"
    git init -q --template="$RUN_TMP/template" "$CASE_DIR"
    git -C "$CASE_DIR" config user.name 'Ralph Test'
    git -C "$CASE_DIR" config user.email 'ralph@example.test'
    echo 'Do the selected task.' > "$CASE_DIR/PROMPT.md"
    cat > "$CASE_DIR/specs/prd.json" <<'PRD'
{"userStories":[{"id":"1","title":"Task","passes":false}]}
PRD
    if [ "$mode" = manual ]; then
        jq '.userStories += [{id:"2",title:"Device",manual:true}]' \
            "$CASE_DIR/specs/prd.json" > "$CASE_DIR/updated.json"
        mv "$CASE_DIR/updated.json" "$CASE_DIR/specs/prd.json"
    fi
    git -C "$CASE_DIR" add .
    git -C "$CASE_DIR" commit -qm fixture
    RC=0
    (
        cd "$CASE_DIR"
        PATH="$RUN_TMP/bin:$PATH" RALPH_TEST_MODE="$mode" \
            bash "$ROOT/ralph_codex.sh" "$iterations" "$seconds"
    ) > "$CASE_DIR/output.log" 2>&1 || RC=$?
}

run_case 'done'
check 'completion on the last iteration succeeds' test "$RC" -eq 0
check 'noninteractive invocation' grep -qx exec "$CASE_DIR/args.log"
check 'valid config flag' grep -qx -- -c "$CASE_DIR/args.log"
check 'writable sandbox' grep -qx workspace-write "$CASE_DIR/args.log"
check 'no removed flag' \
    test "$(grep -c -- --full-auto "$CASE_DIR/args.log" || true)" -eq 0
check 'stdin prompt delivered' \
    grep -q 'Work on EXACTLY ONE task: \[1\] Task' "$CASE_DIR/prompt.log"
check 'Codex agent message displayed' \
    grep -q 'session output' "$CASE_DIR/output.log"
check 'Codex command displayed' \
    grep -q 'git status' "$CASE_DIR/output.log"
check 'Codex usage displayed' \
    grep -q 'input_tokens' "$CASE_DIR/output.log"

run_case idle
check 'unfinished iteration limit fails' test "$RC" -eq 1

run_case idle 4
check 'stall limit fails' test "$RC" -eq 2
check 'effort escalates to max' \
    grep -qx model_reasoning_effort=max "$CASE_DIR/args.log"

run_case corrupt
check 'corrupted PRD fails immediately' test "$RC" -eq 3
check 'corruption is not progress' \
    test "$(grep -c 'Progress (' "$CASE_DIR/output.log" || true)" -eq 0

run_case shape
check 'invalid story shape fails' test "$RC" -eq 3

run_case manual
check 'only manual work left succeeds' test "$RC" -eq 0
check 'manual work is reported' \
    grep -q 'only manual:true stories remain' "$CASE_DIR/output.log"

run_case error
check 'Codex failure leaves unfinished exit' test "$RC" -eq 1
check 'Codex errors displayed' \
    grep -q 'provider unavailable' "$CASE_DIR/output.log"

run_case hang 1 5
check 'timed out session leaves unfinished exit' test "$RC" -eq 1
check 'timeout reported' grep -q 'timed out' "$CASE_DIR/output.log"
check 'Codex descendants terminated' \
    test "$(kill -0 "$(cat "$CASE_DIR/descendant.pid")" 2>/dev/null \
        && echo alive || echo gone)" = gone

run_case idle 0
check 'invalid iteration argument rejected' test "$RC" -ne 0
check 'invalid argument starts no agent' test ! -e "$CASE_DIR/args.log"

if [ "$FAILURES" -ne 0 ]; then
    echo "$FAILURES checks failed"
    exit 1
fi
