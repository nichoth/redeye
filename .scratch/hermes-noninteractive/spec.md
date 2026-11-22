# Spec: Reliable non-interactive Hermes execution

**Status:** ready-for-agent

## Problem Statement

A user runs `caffeinate -i npx redeye hermes` with model
`anthropic/claude-sonnet-4.6` and `--concurrency 1` in a project that
already depends on redeye. The orchestrator appears active but repeatedly
launches the Hermes interactive interface, feeds it ticket text, and
receives exit code 0 without any commits or completed acceptance items.
Retries consume time without implementing the tickets. Hermes never
reaches the point of delegating work to the user's Tiiny device.

The observed run used the copy installed in Roast's dependencies. That
copy has no Hermes provider arguments. The current redeye checkout
already contains the intended non-interactive arguments and tests for
argument selection. Both copies identify themselves as version 0.1.8.
The problem therefore spans verification of the existing launch contract
and delivery of that contract to the package a user actually executes.

## Solution

Make the documented Hermes invocation reliably submit one complete
prompt, execute one agent turn, and exit after the turn finishes. Keep
the existing source fix where it already satisfies this contract. Add
behavioral regression coverage through the built CLI and the installed
package, rather than treating an argument-list assertion as proof that
ticket execution works.

Document how to replace an older project dependency with a verified
build. A successful ticket must still pass the existing commit and test
gates. Launching Hermes or receiving exit code 0 alone is insufficient.

## User Stories

1. As a redeye user, I want the documented Hermes command to execute a
   ticket, so that starting a run produces useful work.
2. As a redeye user, I want Hermes launched non-interactively, so that
   piped input cannot remain in an interactive prompt buffer.
3. As a redeye user, I want the entire ticket prompt submitted once, so
   that Hermes receives the specification and agent instructions.
4. As a redeye user, I want multiline text and special characters
   preserved, so that code examples and acceptance criteria retain their
   meaning.
5. As a redeye user, I want prompt text transported without shell
   interpretation, so that quoted text and command examples remain data.
6. As a redeye user, I want my selected model forwarded unchanged, so
   that Hermes uses the model I requested.
7. As a redeye user, I want an omitted model to leave Hermes's model
   selection in control, so that my existing configuration still works.
8. As a redeye user, I want a Hermes executable given by full path to
   behave like its bare command name, so that executable lookup does not
   change execution mode.
9. As a redeye user, I want the agent to run in its ticket worktree, so
   that its changes and commits remain isolated.
10. As a redeye user, I want existing autonomous approval behavior, so
    that Hermes does not wait for a terminal prompt during a run.
11. As a redeye user, I want redeye to wait for the agent turn to finish,
    so that it gates and merges completed work.
12. As a redeye user, I want Hermes failures reflected in the attempt
    outcome, so that unsuccessful work cannot appear complete.
13. As a redeye user, I want an exit-0 attempt without commits to remain
    unfinished, so that opening and closing a harness cannot pass a
    ticket.
14. As a redeye user, I want final output and diagnostics retained in the
    attempt log, so that I can investigate failed or quiet runs.
15. As a redeye user, I want existing cancellation and timeout handling
    to apply to Hermes, so that unattended processes remain manageable.
16. As a redeye user, I want unsupported provider options handled by the
    existing warning and omission rules, so that they do not break the
    Hermes invocation.
17. As a project maintainer, I want the built CLI tested against a fake
    Hermes process, so that tests exercise actual prompt delivery and
    completion without paid inference.
18. As a project maintainer, I want an installed package tested through
    the same behavior, so that correct source cannot hide a stale or
    incomplete distribution.
19. As a redeye user, I want a clear update procedure for a local project
    dependency, so that I can execute the verified build through npx.
20. As a Hermes user with Tiiny delegation configured, I want Hermes to
    receive the ticket normally, so that its delegation backend can be
    reached when the manager chooses to delegate.

## Implementation Decisions

- Reuse the orchestrator's existing provider argument selection and
  shared agent-spawning path. Do not add a second Hermes launcher or
  change the public command syntax.
- Preserve the current launch contract: `--yolo` precedes `chat`;
  `--query-file -` reads the prompt from stdin; `--quiet` selects
  programmatic, single-turn behavior. Append `--model` and its unchanged
  value when a model is supplied. Do not append a model when omitted.
- Send the prompt through the existing stdin pipe and close it after
  writing. Do not place the prompt in argv, interpret it with a shell,
  simulate terminal input, or use Pi's prompt-file convention.
- Recognize Hermes by executable basename, including a resolved full
  path. Preserve existing executable preflight and worktree selection.
- Preserve the process registry, output callbacks, log flushing,
  cancellation, and timeout policies. In particular, keep the existing
  policy that timed-out work can proceed through the gate; this fix does
  not redefine timeout outcomes.
- Preserve unsupported-option handling for effort, maximum turns, and
  preferred subagent model. This work does not map those options onto
  new Hermes flags or change Hermes configuration.
- A successful fake Hermes turn must create and commit a controlled
  change. The CLI must run the existing test gate, merge that change,
  and mark the ticket done. Nonzero exits and exit-0 attempts without
  commits retain the established unfinished outcomes and retry policy.
- Keep the existing source fix and argument tests. Add behavior tests
  where coverage is missing; do not rewrite working provider logic to
  manufacture an implementation change.
- Validate a freshly packed artifact in a temporary consumer project,
  using the project's existing build and packaging lifecycle. Exercise
  its installed CLI rather than a source import or a global executable.
- A user-facing release containing this behavior must have a distinct
  version from the affected installation. Prepare release guidance using
  the existing package workflow; publishing a release is a separate
  maintainer action. Tests and spec implementation must not trigger
  publish or push hooks.
- Document project-local dependency resolution: npx can select the
  installed project copy even when a sibling source checkout has newer
  code. Explain building and installing a local tarball for verification,
  and upgrading to the fixed release when available.

## Testing Decisions

- Use the existing CLI subprocess boundary as the primary test seam.
  Reuse temporary Git repositories, ticket fixtures, controlled Git
  identity, the CLI subprocess helper, and process cleanup conventions.
  The installed-package check exercises this same boundary from a
  temporary consumer. No new application test interface is required.
- Prior art includes the CLI subprocess worktree and integration-branch
  scenarios, the existing no-commits outcome scenarios, and the current
  Hermes provider argument tests. Keep those lower-level tests as guards.
- Provide a fake executable named `hermes` that records argv, cwd, and
  stdin outside the worktree. It must reject missing single-turn flags,
  read until stdin EOF, and only perform its controlled turn after the
  input is complete. It must never invoke real Hermes or a model API.
- Assert observable behavior: the model argument and single-turn launch
  contract, intact fixture text in captured stdin, the agent's worktree,
  final logs, exit status, committed and merged changes, and ticket state.
  Do not assert private helper structure or interactive banner wording.
- Cover bare-name resolution through a controlled PATH and an explicit
  executable path, supplied and omitted models, and prompt content with
  multiline Markdown, Unicode, quotes, backticks, and literal shell
  substitutions. Verify these strings remain literal and occur once in
  the intended prompt section; no substitution marker may be created.
- Prove completion is awaited with a fake turn that records stdin EOF,
  performs its change, commits, and emits its final output in that order.
  Use condition-based synchronization rather than fixed sleeps.
- Cover a nonzero fake Hermes exit with diagnostics and an exit-0 fake
  that performs no work. Neither may mark its ticket done or merge a
  ticket change. Use bounded retries to keep these tests deterministic.
- Exercise the real test gate in the successful CLI scenario. Isolate
  unrelated end-of-run review behavior with existing test controls, so
  that the scenario has one controlled ticket and one agent turn.
- Run the successful scenario through the CLI installed from a freshly
  packed artifact. The artifact must contain the non-interactive launch
  behavior. Keep registry access, real user config, real credentials, and
  the Tiiny device out of automated tests.
- Verify the regression test fails when the Hermes provider arguments
  are temporarily removed, then restore the file from a saved copy and
  rebuild. Do not discard unrelated changes with Git restore commands.
- Build before running the suites that execute the distribution. Run
  the focused regression scenarios, then the required build, test, and
  lint checks. Reuse existing provider suites for compatibility coverage.
- As an optional manual check after installation, run one small ticket
  with real Hermes and inspect its committed result and attempt log.
  Tiiny activity is meaningful only if that manager delegates; a cloud
  manager completing a turn does not itself prove local inference.

## Out of Scope

- Changing the Hermes CLI, its gateway, model resolution, credentials,
  configured providers, or delegation policy.
- Modifying the Tiiny router, choosing resident models, automatically
  loading models, forcing delegation, or measuring device utilization.
- Adding Hermes streaming event parsing, token accounting, or cost
  reporting. Plain final output and existing logs suffice for this fix.
- Redesigning generic retry, timeout, provider-error, review, or
  no-commits behavior, or treating every exit-0 attempt as success.
- Automatically stopping the observed run, changing Roast's dependency,
  modifying an unrelated checkout, publishing npm packages, or pushing
  commits while implementing this specification.

## Further Notes

The failure was observed on 2026-11-22 in Roast. Ticket 18, Run records,
had four no-commits attempts; ticket 34, init, also had a no-commits
attempt. Their logs contained the Hermes interactive screen, echoed
prompt text, and shutdown messages. The device was reachable but listed
no loaded models, with no router lock, hold, or plan. This establishes
that the inspected run did not reach local inference; it is not a
measurement of hardware utilization over the run's entire lifetime.

The affected installed bundle was
`../roast/node_modules/@substrate-system/redeye/dist/index.js`.
The current source checkout already has the Hermes argument mapping in
`src/orchestrator.ts`, introduced by commit `80d38c5`, plus Hermes tests
in `test/orchestrator.test.ts`. The existing tests use an argv echo fake
that drains stdin; they do not verify the captured prompt or ticket work.

Use `test/integration.test.ts` and its `spawnCli` helper as the starting
point for the primary seam. The earlier Hermes port plan is
`docs/superpowers/plans/2026-11-21-port-hermes-and-tiiny-docs.md`.
Its intended launch contract agrees with this specification. The local
Hermes parser also documents `--query-file -` as literal stdin input and
`--quiet` as single-query programmatic execution.

The proposed CLI subprocess seam was presented to the user while this
specification was prepared. Unless the user supplies a different
preference, use that existing seam and keep the tests offline.
