#!/usr/bin/env bash
set -euo pipefail

# Run the test suite with a private TMPDIR, so every temp file and
# directory the tests (and the agents and CLIs they spawn) create
# is removed when the run ends -- pass, fail, or Ctrl-C. Also
# removes the mock-change-*.txt files mock agents write into the
# repo root.

cd "$(dirname "$0")/.."
PATH="$PWD/node_modules/.bin:$PATH"

# name, or name:n to split the suite into n slices that run at
# the same time (see test/shard.ts). Split a suite when it is the
# one the whole run waits on.
TESTS=(
    setup
    blockers
    orchestrator:6
    retry
    worktree:4
    progress:2
    learnings
    stats
    review
    review-pass:3
    merge:3
    display:3
    testcmd
    preflight
    resolve
    config
    tiiny
    graph
    integration:20
    review-integration:12
)

RUN_TMP=$(mktemp -d "${TMPDIR:-/tmp}/redeye-testrun-XXXXXX")

cleanup () {
    # Stop suites still running (Ctrl-C, or an early exit)
    local running
    running=$(jobs -p)
    if [ -n "$running" ]; then
        kill $running 2>/dev/null || true
        wait 2>/dev/null || true
    fi
    rm -rf "$RUN_TMP" || true
    rm -f mock-change-*.txt || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

export TMPDIR="$RUN_TMP"

# Hide the machine's global and system git config, as on a CI runner
# with no identity. useConfigOnly stops git from guessing one from
# the user name and hostname, so a test repo that does not set
# user.name and user.email fails here, not only in CI.
GIT_CONFIG_GLOBAL="$RUN_TMP/gitconfig"
printf '[user]\n\tuseConfigOnly = true\n' > "$GIT_CONFIG_GLOBAL"
export GIT_CONFIG_GLOBAL
export GIT_CONFIG_NOSYSTEM=1

SOURCES=()
for entry in "${TESTS[@]}"; do
    SOURCES+=("test/${entry%%:*}.test.ts")
done

esbuild "${SOURCES[@]}" --format=esm --bundle \
    --packages=external --outdir=dist/test --sourcemap

# Suites are separate processes with their own temp dirs and cwd,
# and most of their time is spent waiting on git and node child
# processes, so every suite and slice runs at once. Each one's
# output goes to its own file and is printed in TESTS order as it
# ends.
LOGS="$RUN_TMP/logs"
mkdir -p "$LOGS"
JOBS=()
PIDS=()
for entry in "${TESTS[@]}"; do
    name="${entry%%:*}"
    count=1
    if [ "$name" != "$entry" ]; then
        count="${entry#*:}"
    fi
    i=0
    while [ "$i" -lt "$count" ]; do
        job="$name"
        if [ "$count" -gt 1 ]; then
            job="$name $i/$count"
        fi
        TEST_SHARD="$i/$count" node "dist/test/$name.test.js" \
            > "$LOGS/${#JOBS[@]}.log" 2>&1 &
        JOBS+=("$job")
        PIDS+=($!)
        i=$((i + 1))
    done
done

FAILURES=0
FAILED=""
for i in "${!JOBS[@]}"; do
    status=0
    wait "${PIDS[$i]}" || status=$?
    echo "# suite: ${JOBS[$i]}"
    cat "$LOGS/$i.log"
    if [ "$status" -ne 0 ]; then
        FAILURES=$((FAILURES + 1))
        FAILED="$FAILED
    ${JOBS[$i]}"
    fi
done

if [ "$FAILURES" -ne 0 ]; then
    echo "failed suites:$FAILED" >&2
    exit 1
fi
