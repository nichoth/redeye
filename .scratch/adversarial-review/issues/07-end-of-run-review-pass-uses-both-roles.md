# 07: End-of-run review pass uses both roles

**What to build:** With `adversarial` configured, the end-of-run
review pass runs its reviewer with the review role and its fixer
with the implement role, so the final pass is cross-model too.
Without `adversarial`, the pass is unchanged. `--no-review` still
skips only this pass and has no effect on the per-ticket loop.

**Blocked by:** 04

**Touches:** `src/review.ts` (`ReviewPassOpts` gets separate
reviewer and fixer provider, model, effort and related options
instead of one `agentCmd`/`model`; `runReviewer`, `runFixer`,
`runReviewPass`); `src/orchestrator.ts` (`runWavesIsolated` passes
both roles); `src/index.ts` (the `review` option to
`runWavesIsolated`); `test/review-pass.test.ts`,
`test/review-integration.test.ts`

**Status:** done

Notes:

- Start by splitting the single provider and model in
  `ReviewPassOpts` into reviewer and fixer roles that both default
  to the run's provider. That prefactor keeps the existing tests
  green on its own. Then wire in the configured roles.
- Each role's effort ladder comes from its own provider
  (`runWithRetries` takes the role's command).

- [x] With `adversarial` configured, the end-of-run reviewer runs
  with the review role's provider and model, and the end-of-run
  fixer runs with the implement role's
- [x] Without `adversarial`, the end-of-run reviewer and fixer run
  with the run's provider, as today
- [x] With `adversarial` configured and `--no-review`, no end-of-run
  review runs, but each ticket is still reviewed by the per-ticket
  loop
