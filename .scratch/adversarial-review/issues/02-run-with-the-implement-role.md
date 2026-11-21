# 02: Run with the implement role

**What to build:** With `adversarial` configured, a bare `redeye`
runs tickets with the `implement` role, so the user does not repeat
the provider on every run. A provider given on the command line
overrides `implement` for that run and logs one line saying so.
Flags inside a role string win for that role, and run-wide CLI flags
fill in whatever the string leaves out. The provider preflight
checks both role executables. If `implement` and `review` resolve to
the same provider basename and the same model, redeye prints one
warning at startup and runs anyway, and `--dry-run` shows that
warning too. On the in-place path (outside a git repo), redeye logs
that the adversarial loop is skipped.

**Blocked by:** 01

**Touches:** `src/index.ts` (the `$0 <provider> [turns]` command
becomes `$0 [provider] [turns]`, `runExecute` resolves the effective
implement and review roles, preflight via `resolveExecutable` for
both); `src/config.ts` (role resolution and merging with CLI flags,
same-model check); `src/preflight.ts` if needed;
`test/integration.test.ts`, `test/config.test.ts`

**Status:** ready-for-agent

Notes:

- With no config and no provider, the usage error and exit code
  are unchanged (exit 1 with help text).
- Keep every command handler returning a promise, so errors reach
  `.fail()`.
- Carry the resolved review role through to where
  `runWavesIsolated` is called, so ticket 04 can use it, but do not
  start any reviewer here.
- Update the README's usage section for the optional provider.

- [x] A bare `redeye` in a repo whose `.redeye.json` configures
  `adversarial` runs tickets with the `implement` provider and model
- [x] A provider on the command line overrides `implement` for that
  run and logs that it did
- [x] A CLI flag the role string leaves out applies to that role;
  a flag set in the role string wins over the CLI flag
- [x] A missing `review` executable makes the run exit 2 before any
  branch is created
- [x] `implement` and `review` with the same provider and model
  produce the same-model warning in a run and in `--dry-run`
- [x] `--dry-run` says when a command-line provider overrides
  `implement`
- [x] A bare `redeye` with no `.redeye.json` still gives today's
  usage error
