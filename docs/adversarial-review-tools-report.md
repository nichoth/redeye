# Adversarial Review Tools for AI Coding Agents

Research report, 2026-11-18.

Subjects:

1. VDD gist -- https://gist.github.com/dollspace-gay/45c95ebfb5a3a3bae84d8bebd662cc25
2. adverse -- https://github.com/addyosmani/adverse
3. roast -- https://github.com/bluesky-social/roast

## How this report was produced

A deep-research workflow ran 5 search angles, fetched 23 sources,
extracted 110 claims, and ran 3-vote adversarial verification on the top
25. Two claims were refuted and are excluded. The workflow did not cover
the gist, and it missed roast's license and install details. Those were
filled in afterwards by reading the gist and the roast repo directly
through the GitHub API. Gist and roast-license statements below rest on
that direct read and were not cross-verified by vote.

Almost all tool evidence is first-party (READMEs, SKILL.md, source). It
describes design intent, not measured review quality. None of the three
tools publishes precision, recall, or false-positive data.

## Summary

The three subjects are different kinds of things.

The **VDD gist** is a methodology document, not software. It describes a
human-mediated loop: a builder model (Claude) writes code and tests, a
separately prompted, deliberately cynical reviewer ("Sarcasmotron", a
Gemini Gem) roasts it in a fresh context every turn, and the loop stops
when the reviewer's critiques become hallucinated. It is cross-model and
iterative, with a human as the referee.

**adverse** is a persona panel that uses one model per run. Any agent
CLI can be that model (Claude, Codex, Gemini, Ollama, and others, via
`--agent`). Three personas (Auditor, Adversary, Pragmatist) review in
parallel, cross-examine each other in one round, and a deterministic
Node script (not an LLM) labels and ranks the results. Its README states
plainly that one model playing three roles gives correlated output. For
cross-model review it says to run adverse twice with different agents
and diff the reports.

**roast** is a cross-model finder/verifier pipeline. A finder proposes
diff defects, each with a code quote and a fix. A verifier, which can be
a different provider and protocol, confirms or refutes each one before
it reaches the report. It can route the finder away from the model that
wrote the code.

All three agree on the core premise: a model reviewing its own output is
too agreeable, so you need structural friction. They differ on where the
friction comes from. VDD uses persona and a human. adverse uses
perspective diversity and cross-examination on one model. roast uses
model independence and a refute step. The research points toward roast's
side: independence and empirical checks matter more than how many agents
agree.

## 1. VDD gist (dollspace-gay)

**What it is.** "Verification-Driven Development (VDD) via Iterative
Adversarial Refinement", a single `method.md` (about 5 KB). Created
2026-01-04, last updated 2026-10-21. No license is stated. It is a
process description with no code, prompts, or install steps.

**Roles.**

| Role | Entity | Job |
| --- | --- | --- |
| Builder | Claude or similar | Plans, decomposes, writes code and tests |
| Tracker | "Chainlink" (custom issue tracker) | Breaks goals into Epics, Issues, Sub-issues ("beads") |
| Adversary | "Sarcasmotron" (Gemini Gem) | Hyper-critical, low-patience reviewer |

**Workflow.**

1. Decompose the goal into a "bead-string" of atomic sub-issues.
2. Verify first. Tests are mandatory, plus human manual testing, before
   any adversarial pass.
3. "The Roast". The verified code goes to Sarcasmotron, which is prompted
   for zero tolerance of lazy AI patterns (placeholder comments, generic
   error handling, inefficient loops). It gets a **fresh context window
   every turn** to stop "relationship drift", meaning a reviewer that
   becomes more agreeable over a long conversation.
4. The builder fixes real flaws, refactors, and adds tests for newly
   found edge cases. Repeat.
5. Hardening. As the roast turns up edge cases that tests cannot rule
   out, formal tools go into CI. The examples given are Kani (model
   checking) and Wycheproof (crypto test vectors).

**Termination.** The most distinctive idea is "hallucination-based
termination". Stop when the adversary has to invent problems that do not
exist. The builder decides when critiques "are no longer grounded in the
code's reality".

**Assessment.**

1. It is cross-model by construction (Claude builder, Gemini reviewer),
   which matches the independence finding in the research below.
2. Fresh context per turn is a cheap, concrete defense against
   sycophantic drift.
3. Moving from LLM critique to mechanical gates (tests, then formal
   verification) agrees with the Refute-or-Promote result that one
   empirical check beats unanimous LLM agreement.
4. The weak point is the exit signal. It relies on the builder (itself an
   LLM, plus a human) telling a hallucinated critique from a real one. A
   builder that is too eager to dismiss criticism would end the loop
   early. Nothing in the method guards against that.
5. Nothing can be installed or reproduced. To adopt it, you would write
   your own reviewer prompt and loop. Note that roast's README credits no
   connection to this gist. The shared "roast" wording looks like common
   vocabulary, not lineage, as far as the sources show.

## 2. adverse (addyosmani)

**What it is.** "Multi-agent adversarial code review for any coding
agent." JavaScript, MIT license, about 68 stars. Created 2026-05-08, last
push 2026-06-20 (about five months quiet as of this report). It ships as
a standalone CLI (`npm install -g adverse`, `npx adverse review`) and as
a Claude Code skill (`adverse-review`). Both share one `src/` Node core
for collection, prompts, and synthesis.

**Harnesses and models.** In skill mode, reviewers are Claude Code
Agent-tool subagents (opus by default). The CLI is backend-agnostic.
`--agent` (or `ADVERSE_AGENT`) takes any command that reads a prompt on
stdin and writes to stdout, for example `claude -p`, `codex exec
--quiet`, `gemini` or `ollama run llama3.1`. The default is `claude -p`.
The parser handles plain text, fenced JSON, Claude's `{"result": ...}`
wrapper and Anthropic content blocks.

Within a single run, though, there is one model. `src/cli.mjs` builds
one `AgentRunner` from the `--agent` string, and every persona in both
rounds goes through it. There is no per-persona agent option. The
SKILL.md says mixing models across personas "defeats the single-model
design". To use more than one model, run adverse twice with different
`--agent` values and diff the reports. You do that comparison yourself:
adverse does not merge reports from different runs.

**Personas.**

1. Auditor: correctness and logic.
2. Adversary: security and trust boundaries.
3. Pragmatist: maintainability and design fit.

**Rounds.**

1. Round 1: the three personas review independently and in parallel.
2. Round 2 (cross-examination): each persona with a valid round-1 review
   sees all round-1 output. It validates findings it agrees with and
   challenges ones it thinks are wrong or overstated. A concrete reason
   is required, and "I disagree" is not enough. It may add new findings.
   Round 2 is skipped if fewer than 2 personas succeeded in round 1.

**Cost.** 6 model calls baseline. Wall time is about twice the slowest
single call. `--single-round` cuts it to 3. Parse-failure retries can
push it to 12.

**Synthesis.** Deterministic Node (`src/synthesis.mjs`), with no LLM
judge. The skill explicitly forbids a fourth judge pass and forbids
having an LLM re-render findings. Findings merge on normalized title,
file, and line, then get one label by fixed precedence:

1. **disputed**: any challenge, even if several personas reported it.
2. **cross-validated**: 2 or more independent round-1 reporters.
3. **consensus**: at least one validator.
4. **solo**: everything else.

Results sort by severity, then confidence, then title. The CLI and the
skill produce byte-identical reports from the same inputs.

**Stated limitations.**

1. Single-model anchoring bias. The README says it "correlates more than
   three independent models would" and "don't pretend this is the same
   thing as two-provider review". The suggested fix is to run it twice
   with different agents and diff the reports.
2. Source cap of 250 KB total and 30 KB per file by default. Use `--diff`
   on large repos.
3. Report only. It does not apply fixes.

## 3. roast (bluesky-social)

**What it is.** "Adversarial cross-model code review." Go, dual
MIT/Apache-2.0 (the Apache option is there for its patent grant). About
105 stars. Created 2026-09-19, very active: v1.4.6 to v1.4.8 shipped
between 2026-11-14 and 2026-11-17. No telemetry.

**Install.** Homebrew cask (`brew install --cask
bluesky-social/tap/roast`), GitHub Releases archives with SHA-256
checksums (macOS, Linux, Windows, amd64 and arm64), `go install
github.com/bluesky-social/roast/cmd/roast@latest` (Go 1.27.3+), or the
unofficial AUR packages. `roast skill install` installs an Agent Skill to
`~/.agents/skills/roast`, plus `~/.claude/skills/roast` when Claude Code
is present and the Polytoken skills directory when Polytoken is present.

**Pipeline.**

1. Finder: proposes defects in a Git diff. Each one carries a code quote
   and a concrete fix, submitted as schema-validated tool calls.
2. Confidence floor: findings below `review.confidence_floor` (default
   0.6) are dropped before verification and listed under
   `dropped_findings`.
3. Verifier: re-reads the cited code and confirms or refutes each
   finding. `--max-verified` caps this at 25 by default.
4. Report: JSON to stdout, Markdown to stderr, or pick one with
   `--format`.

**Modes.** The default scope is commits since the main branch. `--staged`
reviews staged changes, and `--max-severity HIGH` exits 1 on HIGH or
worse. `--interactive` gives the finder several turns with bounded,
read-only file, grep, and listing tools (16 turns by default).
`--scope repo` surveys the whole repo (40 turns). `--quick` runs the
finder only, with no verification and a higher floor of 0.8. The
pre-commit gate (`roast gate enable`) always uses quick mode.

**Model independence.**

1. Each role has its own model, endpoint, credential, and wire protocol
   (`chat`, `responses`, or `anthropic`). Any base URL works, including
   local servers.
2. Author routes: when the calling agent passes `--author-model` (or
   `ROAST_AUTHOR_MODEL`), `roles.finder.author_routes` can switch the
   finder to a different profile by exact model or model family, so a
   model is not reviewing its own work. `roles.finder.pin: true`
   overrides this with a warning. It only works if you configure
   `author_routes`.

**Budgets.** 32,768 output tokens per call, a shared 3,000,000-token
budget across finder and verifier, a 10-minute deadline for interactive
finder work, and 4 provider attempts.

**Security posture.** Roast never reads configuration from the repo under
review, so a checkout cannot redirect inference or supply credentials.
Provider API keys are fallbacks only for that provider's default
endpoint. A key in your shell is never sent implicitly to a custom
gateway. Prompts can be overridden with absolute paths
(`prompts.finder_code`, `prompts.finder_prose`, `prompts.verifier`).

## Head-to-head

| | VDD gist | adverse | roast |
| --- | --- | --- | --- |
| Type | Methodology doc | CLI + Claude Code skill | Go CLI + Agent Skill |
| License | None stated | MIT | MIT / Apache-2.0 |
| Activity | Updated 2026-10 | Last push 2026-06 | Releases weekly, 2026-11 |
| Models | Claude + Gemini | Any agent CLI, one per run | Any endpoint, one per role |
| Source of independence | Different model + human | Different personas; cross-model only via two runs + manual diff | Different models / providers in one run |
| Roles | Builder, Adversary, Human | Auditor, Adversary, Pragmatist | Finder, Verifier |
| Rounds | Open-ended loop | 2 (or 1) | 1 finder pass + per-finding verify |
| Aggregation | Human judgment | Deterministic code | LLM verifier verdict |
| False positives | Builder or human dismisses | Labeled (disputed / solo), never removed | Filtered (floor + refutation) |
| Baseline cost | Unbounded, manual | 6 calls fixed | 1 finder + up to 25 verifies |
| Stop condition | Critiques turn hallucinated | Fixed | Fixed |
| Extensibility | Write your own | Swap agent backend | Swap provider/protocol per role, override prompts |

**Design philosophy.** adverse supports any model but deliberately uses
one model per run. It accepts the correlation that comes with that, says
so, and tries to get value from orthogonal perspectives plus structured
disagreement. The README argues that a two-model setup is "expensive,
slow, requires two API keys, and ties you to whichever two providers the
script knows about". roast treats independence as the point and adds a refute
step. VDD treats adversarial review as one stage in a longer hardening
process that ends in mechanical proof.

**False-positive handling.** adverse keeps everything and labels it, so
you read the "disputed" pile yourself. Nothing is lost, but nothing is
pruned either. roast prunes. The output is shorter, but a wrong verifier
refutation silently drops a real bug. Dropped-for-confidence findings
are still listed, which helps. VDD leaves this to the human, and its
"hallucination means done" rule turns false positives into the exit
signal.

**Determinism.** adverse's synthesis is fully reproducible given the
model outputs. roast's inclusion decision is an LLM judgment, so it is
less reproducible but can actually remove noise. VDD is not
deterministic at all.

**Cost.** adverse is predictable at 6 calls. roast scales with the number
of findings (capped) and is bounded by a token budget. `--quick` is
cheap enough for a pre-commit hook. VDD's cost is mostly human time.

**When to use which.**

1. Fast, cheap gate on every commit: `roast gate enable` (quick mode).
2. Serious PR review where you have keys for two providers: roast with
   finder and verifier on different vendors, plus `author_routes`.
3. Only one model available, a non-Anthropic or local model (Ollama),
   or you want a reproducible, auditable multi-angle report: adverse.
   For cross-model coverage, run it twice with different `--agent`
   values and diff the reports.
4. Hardening a critical component over days: the VDD loop, ending in
   tests and formal checks, not in LLM agreement.

## Broader landscape

**Related tools.**

1. **openai/codex-plugin-cc**: OpenAI's official Codex plugin for Claude
   Code. Provides `/codex:adversarial-review`, separate from
   `/codex:review`. It takes free-form focus text and challenges design,
   tradeoffs, and hidden assumptions, not only code details. Read-only.
   It gets cross-vendor review by delegating to your local Codex CLI and
   auth. Needs a ChatGPT subscription or OpenAI API key.
2. **wan-huiyan/agent-review-panel** (MIT, Claude Code plugin): the
   heavyweight panel. 4 to 6 stance-assigned reviewers, 1 to 3 debate
   rounds, then an Opus "Supreme Judge" (16 phases in full). The author
   estimates $3 to $20 and 6 to 15 minutes per run, aimed at high-stakes
   reviews. The same README reports one audited full run at $162. It
   concedes that a shared base model makes it "structured self-critique,
   not independent verification".
3. **ng/adversarial-review** (Claude Code plugin, also installable in
   Codex CLI v0.142.0+): an Optimizer reviews, then a Skeptic confirms or
   refutes each finding with **command-output-backed** verdicts. Free
   mechanical checks (lint, typecheck, build, tests) run before any LLM
   call. A cost gate picks 2 or 4 agents by diff size, a Haiku pass
   scores, and consensus Critical/Major fixes are auto-applied by
   default. Of the tools found, it ties false-positive control most
   directly to execution evidence. (Verifiers disagreed on its license.)

**Research.**

1. **Refute-or-Promote** (arXiv 2604.19049, single-author preprint):
   adversarial tracks attacking reachability and preconditions killed
   about 79% of about 171 LLM-generated security candidates (83% on a
   prospective n=30 subset). In one case, 10 dedicated reviewers among
   80+ agents unanimously endorsed a non-existent Bleichenbacher oracle
   in OpenSSL CMS, and a single empirical test refuted it. Conclusion:
   "Unanimity therefore should not raise confidence by itself." This
   bears directly on adverse, where cross-validated is the strongest
   label.
2. **VulTrial** (arXiv 2505.10961, ICSE 2026): a courtroom setup
   (prosecutor, defense, judge, jury) for vulnerability detection. On
   PrimeVul pairs with GPT-4o it scored 81 on pairwise-correct, against
   40 for chain-of-thought and 44 for GPTLens. But its FPR was 0.52,
   against 0.17 for CoT. More rounds hurt: 96 after 1 round, 87 after 2,
   81 after 3. This supports adverse's single cross-exam round.
3. **"Talk Isn't Always Cheap"** (Wynn, Satija, Hadfield, ICML 2025 MAS
   workshop): in mixed-capability groups, debate accuracy can fall over
   rounds even when stronger models are the majority. This comes from
   general QA, so applying it to code review is an extrapolation.
4. **CodeAgent** (Tang et al., EMNLP 2024, arXiv 2402.02172): peer-reviewed
   prior art for multi-agent code review. It is cooperative and
   role-based, not adversarial.

**Known weaknesses across the category.**

1. Correlated errors when all roles share a base model. adverse and
   agent-review-panel both say this themselves.
2. False confidence from agreement. Refute-or-Promote shows unanimous
   LLM endorsement of a fake bug.
3. Diminishing or negative returns from more debate rounds (VulTrial,
   Wynn et al.).
4. A higher false-positive rate is the price of adversarial recall
   (VulTrial).
5. Long-context agreeableness drift. VDD's per-turn context reset is
   the simplest countermeasure seen here.

## Takeaways

1. Independence beats headcount. A second vendor's model as verifier
   (roast, codex-plugin-cc, VDD) gives more than extra personas on the
   same model.
2. Ground verdicts in execution where you can: tests, repros, lint, type
   checks, formal tools. ng/adversarial-review and VDD's hardening stage
   do this. adverse and roast do not.
3. Keep cross-examination short. One round is the evidence-backed
   default.
4. Treat agreement as weak evidence and refutation as strong evidence.
5. Deterministic aggregation (adverse) makes results auditable. LLM
   verification (roast) makes them shorter. Pick based on whether you
   would rather read noise or risk losing a true positive.

## Open questions

1. Do adverse's cross-validated findings or roast's verified findings
   actually beat single-pass review on precision for real PRs? No
   benchmarks exist.
2. How much does cross-model setup reduce correlated misses in practice,
   compared with single-model personas?
3. Would adding execution-backed checks to adverse or roast cut false
   positives more than extra LLM rounds do?
4. Can VDD's "hallucination-based termination" be made mechanical, for
   example by stopping when a separate verifier refutes all of the
   adversary's findings for N consecutive turns?

## Refuted claims (excluded)

1. That CodeAgent's QA-Checker parallels the synthesis and judge roles in
   adverse and roast (0-3).
2. That the "Talk Isn't Always Cheap" paper shows sycophantic
   answer-flipping that transfers to code-review cross-examination (0-3).

## Sources

1. https://gist.github.com/dollspace-gay/45c95ebfb5a3a3bae84d8bebd662cc25
2. https://github.com/addyosmani/adverse
3. https://raw.githubusercontent.com/addyosmani/adverse/main/skills/adverse-review/SKILL.md
4. https://github.com/bluesky-social/roast
5. https://cdn.jsdelivr.net/gh/openai/codex-plugin-cc@main/README.md
6. https://github.com/wan-huiyan/agent-review-panel
7. https://github.com/ng/adversarial-review
8. https://arxiv.org/html/2604.19049v1 (Refute-or-Promote)
9. https://arxiv.org/html/2505.10961v2 (VulTrial)
10. https://arxiv.org/pdf/2509.05396 (Talk Isn't Always Cheap)
11. https://arxiv.org/abs/2402.02172 (CodeAgent)
