# PRD: Pass extra arguments to the agent harness with `--`

## Introduction

redeye spawns each agent with a fixed argument list per provider
(`PROVIDER_ARGS` in `src/orchestrator.ts`). For pi that list is
`-p --verbose --approve --no-session --mode json`. `spawnAgent` then
adds the flags redeye derives from the run (`--model`, `--thinking`,
`--max-turns`, and so on), and for pi the prompt file as a final
`@<file>` argument. There is no way to add anything else.

The immediate need is to stop pi from auto-loading context files and
skills: pi has `--no-context-files` and `--no-skills`, but redeye
cannot pass them. Rather than add a redeye option per harness flag,
redeye should forward arbitrary arguments the way `npm run` does:
everything after `--` goes to the harness unchanged.

```sh
redeye pi -m sonnet -- --no-context-files --no-skills
```

Role strings in `.redeye.json` get the same syntax, so each role can
carry its own extra arguments:

```json
{
  "adversarial": {
    "implement": "pi -m sonnet -- --no-skills",
    "review": "claude -m opus -- --add-dir ../shared"
  }
}
```

## Goals

- Any argument after `--` on the `redeye` command line reaches the
  implement role's harness unchanged.
- A role string in `.redeye.json` can carry its own `--` arguments,
  which reach that role's harness unchanged.
- Arguments a user does not pass after `--` change nothing: every
  existing command line and config spawns the same argv as today.
- redeye stays out of the user's way: no validation, rewriting or
  defaults for the forwarded arguments.

## Definitions

- **Extra args**: the list of arguments after `--`, in order, with
  no further parsing by redeye.
- **Implement role**: the role that implements tickets. It is the
  CLI provider when one is given, otherwise `adversarial.implement`
  from `.redeye.json` (see `resolveRoles` in `src/config.ts`).
- **Review role**: `adversarial.review` from `.redeye.json`, used by
  the per-ticket adversarial review loop.

## User Stories

### US-001: Role strings accept `--`
**Description:** As a user, I want to write extra args in a role
string in `.redeye.json` so that each role's harness gets its own
flags.

**Acceptance Criteria:**
- [ ] `ParsedRole` in `src/config.ts` has an optional
      `extraArgs:string[]` field
- [ ] `parseRoleString('pi -m sonnet -- --no-skills --foo')` returns
      `extraArgs: ['--no-skills', '--foo']` and `model: 'sonnet'`
- [ ] Tokens after `--` are not parsed as redeye options:
      `parseRoleString('pi -- -m other')` returns no `model` and
      `extraArgs: ['-m', 'other']`
- [ ] A role string with no `--`, or with a `--` followed by
      nothing, returns no `extraArgs` (field absent or empty)
- [ ] A stray positional before `--` still throws the existing
      "Extra positional argument" error
- [ ] `renderRoleString` appends ` -- <args>` when `extraArgs` is
      non-empty, and `parseRoleString(renderRoleString(role))`
      round-trips
- [ ] Unit tests in `test/config.test.ts` cover the cases above
- [ ] `npm run lint` and `npm run build` pass

### US-002: The CLI accepts `--`
**Description:** As a user, I want to write
`redeye pi -- --no-context-files` so that the implement role's
harness gets those flags for this run.

**Acceptance Criteria:**
- [ ] The default command in `src/index.ts` collects everything
      after `--` into a list without yargs parsing it (yargs
      `parserConfiguration({ 'populate--': true })`, read from
      `argv['--']`)
- [ ] Tokens after `--` never trip `.strict()` and are never read
      as redeye options or as the `provider`/`turns` positionals
- [ ] `CliOptions` in `src/config.ts` has an optional
      `extraArgs:string[]`, and `runExecute` passes the collected
      list through it to `resolveRoles`
- [ ] `redeye pi --dry-run -- --no-skills` exits 0, as it does
      without the `--` part
- [ ] `init` and `graph` are unaffected
- [ ] `npm run lint` and `npm run build` pass

### US-003: `resolveRoles` merges extra args
**Description:** As a developer, I need one place that decides each
role's extra args so that the rules cannot drift between call sites.

**Acceptance Criteria:**
- [ ] With a CLI provider, `implement.extraArgs` is the CLI's extra
      args only. A CLI provider replaces the implement role whole, as
      it already does for model and effort
- [ ] With no CLI provider, `implement.extraArgs` is the role
      string's extra args followed by the CLI's
      (`[...role, ...cli]`)
- [ ] `review.extraArgs` is always the review role string's extra
      args only. CLI extra args never reach the review role
- [ ] `implementStr` (shown in the run header and recorded in
      review logs) includes the merged implement extra args, using
      `renderRoleString`
- [ ] Unit tests in `test/config.test.ts` cover all three rules
- [ ] `npm run lint` and `npm run build` pass

### US-004: `spawnAgent` forwards extra args
**Description:** As a user, I want the extra args to reach the
harness process so that its behavior changes.

**Acceptance Criteria:**
- [ ] `spawnAgent` in `src/orchestrator.ts` takes an optional
      `extraArgs:string[]`
- [ ] The extra args are placed after every flag redeye builds
      (provider args, `--model`, `--max-turns`, `--thinking` or
      `--effort`, codex's `-c`) and before pi's `@<prompt file>`, so
      the prompt stays the last argument
- [ ] Extra args are passed as separate argv entries, in order,
      with no shell, quoting or splitting applied
- [ ] With `extraArgs` absent or empty, the argv is exactly what it
      is today for every provider
- [ ] A test using `FAKE_CLAUDE_ARGV_LOG` (or a new argv-logging
      key on the fake pi, added to each file's env key list)
      asserts that the extra args appear as a contiguous run in the
      spawned argv, after `--model`
- [ ] For pi, a test asserts the last argv entry still starts with
      `@`
- [ ] `npm run lint` and `npm run build` pass

### US-005: Every implement-role and review-role spawn gets its args
**Description:** As a user, I want every agent that runs a role to
get that role's extra args so that, for example, pi never loads
skills anywhere in the run.

**Acceptance Criteria:**
- [ ] Every `spawnAgent` call that runs the implement role passes
      `implement.extraArgs`: ticket attempts and retries,
      merge-conflict agents, the adversarial loop's fixer, and the
      end-of-run review and fix pass (`src/review.ts`, through its
      injected `deps.spawnAgent`)
- [ ] Every `spawnAgent` call that runs the review role
      (`agentCmd: adv.review.provider` in `src/orchestrator.ts`)
      passes `review.extraArgs`
- [ ] An integration test runs a ticket with the fake claude and
      `-- --some-flag`, and the argv log shows `--some-flag` on
      every spawn the run made
- [ ] An integration test with an adversarial config whose review
      role string has `-- --review-only` shows that flag on review
      spawns and not on implement spawns
- [ ] `npm test` passes (after `npm run build`)

### US-006: Document the syntax
**Description:** As a user, I want the README and `--help` to show
`--` so that I can find the feature.

**Acceptance Criteria:**
- [ ] The default command's usage or epilog in `--help` shows an
      example with `--`
- [ ] The README documents the CLI form, the role-string form, the
      merge rules from US-003, and the argv placement from US-004
- [ ] The README warns that redeye does not check forwarded args,
      and that flags which change the harness's output format (pi's
      `--mode`, claude's `--output-format`) or its permission mode
      will break the run
- [ ] The README notes that pi's `--no-context-files` also stops pi
      from loading the target project's `AGENTS.md`
- [ ] The `AGENTS.md` invariant about provider-specific options
      gets one line saying extra args are decided in `resolveRoles`
      and placed by `spawnAgent`
- [ ] No tests are written for docs

## Functional Requirements

- FR-1: On the `redeye` command line, every token after the first
  standalone `--` is an extra arg for the implement role. redeye
  does not interpret it.
- FR-2: In a role string, every whitespace-separated token after the
  first standalone `--` is an extra arg for that role.
- FR-3: With a CLI provider, the implement role's extra args are the
  CLI's only.
- FR-4: With no CLI provider, the implement role's extra args are
  the `.redeye.json` implement role's extra args followed by the
  CLI's.
- FR-5: The review role's extra args come only from its role string.
- FR-6: `spawnAgent` appends extra args after all flags redeye
  builds, and before pi's `@<prompt file>` argument.
- FR-7: Every spawn of a role receives that role's extra args.
- FR-8: redeye never validates, rejects, warns about, deduplicates
  or reorders extra args.
- FR-9: redeye adds no extra args of its own: pi keeps its current
  fixed argument list.
- FR-10: With no `--` anywhere, every spawned argv is identical to
  the current behavior.

## Non-Goals

- No built-in default extra args for any provider, including
  `--no-context-files --no-skills` for pi.
- No denylist, validation or warning for args that conflict with
  redeye's own flags.
- No per-call-site extra args (for example, different args for
  merge-conflict agents than for ticket agents).
- No shell-style quoting in role strings. An arg containing spaces
  cannot be written in `.redeye.json` (see Open Questions).
- No way for CLI extra args to reach the review role.
- No change to `redeye init`'s prompts beyond what `parseRoleString`
  already accepts (its validator will accept `--` for free).

## Technical Considerations

- yargs puts tokens after `--` into `_` by default, which `.strict()`
  and the `[provider] [turns]` positionals would reject or misread.
  `parserConfiguration({ 'populate--': true })` moves them to
  `argv['--']` instead. Apply it to both the main CLI and the
  `parseRoleString` parser, whose current check on `parsed._` would
  otherwise throw "Extra positional argument".
- `parseRoleString` splits on whitespace before yargs sees the
  string, so a role string cannot express an arg with spaces.
- For pi the prompt goes as a trailing `@<file>` positional, so
  extra args must be inserted before it, not appended to the end.
- hermes's fixed args are `--yolo chat --query-file - --quiet`.
  Extra args land after `chat`, so only `chat` options work there.
  Root options such as `--yolo` would not. Document this; do not
  special-case it.
- The end-of-run review pass in `src/review.ts` gets `spawnAgent`
  through injected `deps`. Thread `extraArgs` through its options
  rather than importing values from `orchestrator`, to respect the
  module boundary in `AGENTS.md`.
- Integration tests that add a new `FAKE_*` env key must add it to
  that file's key list (`FAKE_CLAUDE_KEYS`, `FAKE_ENV_KEYS`,
  `ENV_KEYS`).
- `npm test` runs `dist/index.js`, so run `npm run build` before
  `npm test` when verifying.

## Success Metrics

- `redeye pi -- --no-context-files --no-skills` runs a feature end
  to end, and every pi process in the run has both flags in its
  argv.
- No change in argv for any existing invocation (US-004's
  empty-extras check passes for all four providers).
- No new redeye option is needed the next time someone wants to
  pass a harness flag.

## Open Questions

- Should role strings support quoting (`-- --append-system-prompt
  "be terse"`) by switching from whitespace split to a shell-words
  parser? Out of scope here, but it is the obvious next step.
- Should `--dry-run` print the full argv of the implement and review
  roles so that a user can check the extra args without starting a
  run?
