# 01: Load and validate .redeye.json

**What to build:** redeye reads an optional `.redeye.json` at the
repo root once at startup, before the provider preflight and before
any git or worktree work. When it has an `adversarial` key, redeye
validates it and parses the `implement` and `review` role strings.
A bad config stops the run with exit 2 before anything is created.
`--dry-run` shows the configured roles and round limits. With no
file, or no `adversarial` key, every code path behaves exactly as
today.

This ticket only loads, validates and reports the config. Using the
roles to run agents comes in later tickets.

**Blocked by:** None (can start immediately)

**Touches:** new `src/config.ts` (loader, `adversarial` validation,
role-string parser, defaults `maxRounds` 3 and `minRounds` 1);
`src/index.ts` (`runExecute`: load config before
`resolveExecutable`, dry-run lines); `package.json` (`build-esm`
standalone list gets `src/config.ts`); new `test/config.test.ts`
added to `TESTS` in `scripts/test.sh`; `test/integration.test.ts`
(`spawnCli` cases)

**Status:** done

Notes:

- A role string is a provider command followed by flags, parsed
  with the same option definitions the run command uses. Allowed
  flags: `-m`/`--model`, `--effort`, `--max-turns`,
  `--prefer-subagent`. Any other flag or an extra positional is a
  config error. Share the option definitions with the yargs run
  command instead of copying them, so the two cannot drift.
- `src/config.ts` has no value imports from `src/orchestrator.ts`.
  Add it to the module-boundaries list in `AGENTS.md`.
- Errors go through `formatErrorMessage`, no stack trace.
- Add a short `.redeye.json` section to the README describing the
  file's shape and the role-string syntax.

- [x] A role string with a provider and the allowed flags parses to
  its provider, model, effort, max turns and prefer-subagent
  values; an unknown flag or an extra positional is rejected
- [x] `maxRounds` and `minRounds` default to 3 and 1; a value that
  is not a positive integer, or `minRounds` greater than
  `maxRounds`, is rejected
- [x] A missing `implement` or `review` inside `adversarial` is
  rejected
- [x] A `.redeye.json` that is not valid JSON makes the run exit 2
  and creates no branch or worktree
- [x] An `adversarial` role string with an unsupported flag makes
  the run exit 2 and creates no branch or worktree
- [x] `--dry-run` with `adversarial` configured prints the implement
  and review role strings, `maxRounds` and `minRounds`
- [x] With no `.redeye.json`, or one without an `adversarial` key,
  a run behaves as it does today (existing integration tests stay
  green)
