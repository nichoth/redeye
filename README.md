# `redeye`
[![tests](https://img.shields.io/github/actions/workflow/status/nichoth/redeye/nodejs.yml?style=flat-square)](https://github.com/nichoth/redeye/actions/workflows/nodejs.yml)
[![semantic versioning](https://img.shields.io/badge/semver-2.0.0-blue?logo=semver&style=flat-square)](https://semver.org/)
[![install size][install-size]][package-size]
[![license](https://img.shields.io/badge/license-Big_Time-blue?style=flat-square)](LICENSE)

[install-size]:
  https://flat.badgen.net/packagephobia/install/@substrate-system/redeye
[package-size]:
  https://packagephobia.com/result?p=%40substrate-system%2Fredeye

This is a minimal Node-based AI orchestrator. It reads local markdown tickets
produced by
[`to-tickets` skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md),
resolves their dependency graph, and runs agents in parallel,
honoring ticket dependencies.

This is inspired by [nightshift](https://github.com/Shaurya-Sethi/nightshift/).
I made this because I noticed the API in `nightshift` had already drifted
from the skill definitions. This module bundles its skill dependencies,
so they can't drift as long as you install the skills with this package.
(See [the section on the `init` command](#install-dependency-skills).)

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Install](#install)
  * [Requirements](#requirements)
  * [Install Dependency Skills](#install-dependency-skills)
- [Example Workflow](#example-workflow)
  * [Create Issues](#create-issues)
- [Adversarial Review](#adversarial-review)
  * [Turn It On](#turn-it-on)
- [Examples](#examples)
  * [Keep Your Machine Awake](#keep-your-machine-awake)
    + [Mac OS](#mac-os)
  * [Hermes](#hermes)
  * [Hermes + Local Model](#hermes--local-model)
  * [Claude Opus 4.6](#claude-opus-46)
  * [Claude Opus 5.5](#claude-opus-55)
  * [Claude Sonnet 5.5](#claude-sonnet-55)
  * [Claude Haiku 5.5](#claude-haiku-55)
  * [Claude Fable 5.1](#claude-fable-51)
  * [`pi` + OpenRouter model](#pi--openrouter-model)
  * [`codex` + Luna](#codex--luna)
  * [`codex` + Terra](#codex--terra)
  * [Local Model With `pi`](#local-model-with-pi)
    + [1. Load the right model](#1-load-the-right-model)
      - [Qwen3 Coder Next -- 94% NPU](#qwen3-coder-next----94%25-npu)
      - [Qwen3.6 35B A3B Turbo -- 45% NPU](#qwen36-35b-a3b-turbo----45%25-npu)
      - [Qwen/Qwen3.6-27B](#qwenqwen36-27b)
      - [GLM 4.7 flash -- 57% NPU](#glm-47-flash----57%25-npu)
    + [2. Run the Loop](#2-run-the-loop)
      - [Qwen3.5-9B-Turbo](#qwen35-9b-turbo)
      - [Qwen3.6-35B-A3B-turbo](#qwen36-35b-a3b-turbo)
      - [Qwen3.8-27B-Turbo](#qwen38-27b-turbo)
      - [Huihui-Ornith-1.5-35B-A3B-abliterated-Turbo](#huihui-ornith-15-35b-a3b-abliterated-turbo)
      - [Qwen3.8-27B-heretic-ara-Turbo](#qwen38-27b-heretic-ara-turbo)
      - [Ornith-1.5-35B-A3B-Turbo](#ornith-15-35b-a3b-turbo)
- [`.redeye.json`](#redeyejson)
- [Command Line Arguments](#command-line-arguments)
  * [Notes](#notes)
  * [`--spec ` option](#--spec--option)
  * [`graph` command](#graph-command)
  * [`--prefer-subagent` option](#--prefer-subagent-option)
  * [Environment Settings](#environment-settings)
- [How It Works](#how-it-works)
  * [Worktrees](#worktrees)
  * [Progress](#progress)
  * [Integration branch](#integration-branch)
  * [`.scratch/` in git](#scratch-in-git)
  * [Review](#review)
  * [Status display](#status-display)
- [See Also](#see-also)

<!-- tocstop -->

</details>

## Install

```bash
npm i -S @substrate-system/redeye
```

Install the "skills":

```sh
npx redeye init
```

### Requirements

- Node 24 or newer (see `engines` in `package.json`) and git.
- The agent CLI you select (`claude`, `codex`, `pi` or `hermes`)
  installed and in your `PATH`.
- macOS or Linux. `redeye` runs agents in their own process group
  and uses `sh -c` for test and install commands. Does not run on Windows.

### Install Dependency Skills

Install the bundled
[Pocock skills](https://github.com/mattpocock/skills)
and issue tracker templates in your repo:

```sh
npx redeye init
```

This command will copy some files in this package to a specific directory
in your repo. The upstream
[`grill-with-docs`](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md)
skill is exposed as `/grill`, along with its sub-skills `grilling`
and `domain-modeling`.

Pass `-g` (or `--global`) to install the skills in your home directory,
at `~/.agents/skills/`, with symlinks in `~/.claude/skills/`.

The issue tracker config (`docs/agents/*` and the `AGENTS.md` section) is
specific to each repo, so it is still written to the current directory.
Run `npx redeye init -g` from the root of each repo that uses the skills.

If a skill with the same name is already installed and differs from the
bundled copy, `init` asks before overwriting it. The default is to keep
yours. This applies with or without `-g`.

After picking a tracker, `init` asks whether to run an adversarial
review loop on each ticket (default no). On yes it prompts for an
implement command and a review command (the same role-string syntax
as [`.redeye.json`](#redeyejson)) and asks again if either one is
invalid. It then writes the `adversarial` key, with `maxRounds: 3` and
`minRounds: 1`, to `.redeye.json`, keeping any other keys already in
the file. On no, `.redeye.json` is not created or changed.

>
> [!IMPORTANT]  
> Each agent runs in a fresh git worktree, which only has committed
> files. So redeye copies `.agents/`, `.env` and `.dev.vars` from your
> repo root into every worktree it creates, before installing
> dependencies, when git ignores them, in your checkout and on the
> worktree's branch. That way an agent can never commit a secret. An
> untracked file that is not ignored is never copied, and it stops
> the run (git counts it as a change), so redeye prints a line telling
> you to add it to `.gitignore`. Only the root is checked, not
> subdirectories. `docs/agents/` is never copied, so commit it.
>

The Pocock skills are bundled with this git repo, at `src/skills/`.
They are cloned with some metadata, visible in
[src/skills/upstream.json](src/skills/upstream.json).
That's how we prevent skill vs API drift.


## Example Workflow

1. create spec
2. [create tickets](#create-issues)
3. TDD


**The expected flow is**

```
grill -> to-spec -> to-tickets -> tdd
```

>
> [!NOTE]  
> The `grill` step can be changed to something else. Output from step 1
> needs to be a prose description in a local markdown file.
> The `redeye` CLI does the `tdd` part of the workflow.
>

### Create Issues

Use the `to-tickets` skill to create issues in local markdown files from
a spec text description.

>
> [!NOTE]  
> The `grill -> to-spec` pipeline is recommended to be run in a
> single context window.
>

>
> [!TIP]
> The `to-tickets` skill bundled here can use any input text
> describing a feature, meaning `grill` & `to-spec` skills are not required.
> You could, for example, use
> [superpowers:writing-plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md),
> then follow with `to-tickets`.
>

---

## Adversarial Review

You have the option of running this in adversarial mode, which means it
will do a classic
[adversarial review loop](https://gist.github.com/dollspace-gay/45c95ebfb5a3a3bae84d8bebd662cc25)
before marking work as complete.

Adversarial mode is off by default. Without it, each ticket is done when
its agent exits and the test command passes.

With adversarial mode on, every ticket that passes the test gate is
checked by a second agent before it can merge. You configure two roles:

* **implement** -- the agent that writes the code, and fixes whatever
  the reviewer finds
* **review** -- a different model that reads the ticket's branch and
  reports findings. It never edits code.

Each round, the reviewer reviews the branch. If findings are open, the
implement agent fixes them and the test command runs again, then the
next round starts. Only the reviewer can close a finding. The ticket
merges once a round ends with no open findings (and at least
`minRounds` rounds have run). If findings are still open after
`maxRounds`, the ticket is set to `ready-for-human`, its branch is
kept, and it is not merged.

The rounds are logged to `.scratch/<feature>/reviews/<ticket file>`,
and the status display shows the current round and role
(`review 2/3`, `fix 2/3`). The end-of-run review pass also uses the
review role.

### Turn It On

`init` writes an `adversarial` key to `.redeye.json` at the repo root,
keeping other keys already in the file. Fields `maxRounds` and `minRounds` get
their defaults, `3` and `1`. Edit the file to change them.
See [`.redeye.json`](#redeyejson).

A provider on the command line (`npx redeye claude ...`) overrides the
implement role, and the review role stays as configured in the JSON file.

>
> [!TIP]
> Use a different model for each role. If both roles resolve to the
> same model, redeye warns that the cross-model check is lost.
>

## Examples

After you have the tickets, use the `redeye` loop to execute.
`redeye` will execute the tickets in the most efficient, parallel way
possible, with respect to the ticket dependencies.

### Keep Your Machine Awake

This is expected to run for a long time, like overnight. I use command
`caffeinate` to prevent the computer from sleeping.

#### Mac OS

Use `caffeinate` to prevent your machine from sleeping. These examples will
keep the machine awake, but the display can still go dark.

---

### Hermes

Use [Hermes Agent](https://hermes-agent.nousresearch.com/docs).
The model ID uses the slug of the provider set in your Hermes config.

```sh
caffeinate -i npx redeye hermes -m anthropic/claude-sonnet-4.6
```

For each ticket attempt, redeye sends Hermes one complete noninteractive
turn: the ticket and agent instructions arrive together on stdin, then
redeye closes stdin (EOF). Hermes runs with
`--yolo chat --query-file - --quiet`; redeye waits for the turn to finish
before applying the existing commit and test gates.

With Tiiny delegation already configured in Hermes, the selected model
acts as the manager. Tiiny activity requires that manager to choose to
delegate work to the configured device. A successful cloud manager turn
does not prove local inference occurred. redeye delivers the ticket to
Hermes; Hermes's existing delegation setup decides whether to use Tiiny.
The local model aliases below select a model directly; selecting a cloud
manager does not itself request delegation.

**Optional manual check (real Hermes)**

In a test repository with Hermes and Tiiny delegation already configured,
prepare one small ready ticket with a verifiable file change and a test
command. Run it with your configured manager model, for example:

```sh
npx redeye hermes -m anthropic/claude-sonnet-4.6 --concurrency 1
```

Inspect the resulting commit with `git log` and `git show`, check that the
change passed the test gate and the ticket is done, then read the attempt
log at `.scratch/<feature>/logs/<ticket>.log` (or
`<ticket>.attempt<n>.log` on retries). Look for final output, diagnostics,
and any delegation reported by Hermes. A commit and a passing gate verify
ticket work; manager output alone cannot establish local inference. If
Hermes reports no delegation, this run has not demonstrated Tiiny use.

Keep this optional manual inference check outside automated acceptance.
The automated tests use fake Hermes and require no credentials, model
API calls or Tiiny device. This check uses your existing router, model
loading, credentials and delegation settings; it does not force
delegation or measure device utilization.

>
> [!NOTE]  
> `--effort`, `--max-turns` and `--prefer-subagent` do not apply to `hermes`.
> Set reasoning effort in your Hermes config instead.
>

---

### Hermes + Local Model

Run Hermes with a Tiiny box. Give each model an alias in
`~/.hermes/config.yaml`. The alias carries the endpoint and the key,
and `-m` takes the alias name.

`~/.hermes/config.yaml`:

```yaml
model_aliases:
  qwen-turbo:
    model: Qwen/Qwen3.6-35B-A3B-turbo
    provider: custom
    base_url: "http://openai.api.tiiny/v1"
    key_env: TIINY_API_KEY
  qwen-9b:
    model: Qwen/Qwen3.5-9B-Turbo
    provider: custom
    base_url: "http://openai.api.tiiny/v1"
    key_env: TIINY_API_KEY
```

>
> [!TIP]
> Export env variable `TIINY_API_KEY` in the shell that runs `redeye`.
>

>
> [!NOTE]  
> Add `model_aliases` next to the `model:` block that `hermes setup`
> writes; don't use it in place of that block. With aliases alone,
> Hermes says it "isn't configured yet" and exits before running the
> query.
>

Load the matching model on the box, then run the loop:

```sh
tiiny load Qwen/Qwen3.6-35B-A3B-turbo
```

```sh
caffeinate -i npx redeye hermes -m qwen-turbo --concurrency 1
```

>
> [!NOTE]  
> The `tiiny` notes under
> [Local Model With `pi`](#local-model-with-pi) apply here too:
> keep `--concurrency 1`, and the alias must name the model that is
> loaded on the box.
>


---


### Claude Opus 4.6

```sh
caffeinate -i npx redeye claude -m claude-opus-4-6 --effort medium --prefer-subagent claude-haiku-5-5
```

### Claude Opus 5.5

```sh
caffeinate -i npx redeye claude -m claude-opus-5-5 --effort medium --prefer-subagent claude-haiku-5-5
```

### Claude Sonnet 5.5

```sh
caffeinate -i npx redeye claude -m claude-sonnet-5-5 --effort medium
```

### Claude Haiku 5.5

```sh
caffeinate -i npx redeye claude -m claude-haiku-5-5 --effort high
```

### Claude Fable 5.1

```sh
caffeinate -i npx redeye claude -m claude-fable-5-1 --effort medium
```

### `pi` + OpenRouter model

```sh
caffeinate -i npx redeye pi -m openrouter/z-ai/glm-5.3-flash --effort high
```

```sh
caffeinate -i npx redeye pi -m openrouter/inception/mercury-2.5 --effort high
```

### `codex` + Luna

```sh
caffeinate -i npx redeye codex -m gpt-6-luna --effort high
```

### `codex` + Terra

```sh
caffeinate -i npx redeye codex -m gpt-6.1-terra --effort medium
```

---

### Local Model With `pi`

The `-m` value combines the provider name and its configured model ID.
For example, `tiiny/Qwen/Qwen3.6-35B-A3B-turbo` selects the `tiiny`
provider's `Qwen/Qwen3.6-35B-A3B-turbo` entry. Register every model you
use in `~/.pi/agent/models.json`; the example includes the models below.

`~/.pi/agent/models.json`:

```json
{
  "providers": {
    "tiiny": {
      "baseUrl": "http://openai.api.tiiny/v1",
      "api": "openai-completions",
      "apiKey": "$TIINY_API_KEY",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "supportsUsageInStreaming": false,
        "maxTokensField": "max_tokens"
      },
      "models": [
        {
          "id": "Qwen/Qwen3-Coder-Next",
          "name": "Qwen3-Coder-Next",
          "contextWindow": 262144,
          "maxTokens": 16384
        },
        {
          "id": "Qwen/Qwen3.6-35B-A3B",
          "name": "Tiiny Qwen 3.6 35B A3B",
          "contextWindow": 131072,
          "maxTokens": 16384
        },
        {
          "id": "Qwen/Qwen3.6-35B-A3B-turbo",
          "name": "Tiiny Qwen 3.6 turbo",
          "contextWindow": 262144,
          "maxTokens": 16384
        },
        {
          "id": "Qwen/Qwen3.5-9B-Turbo",
          "name": "Tiiny Qwen 3.5 9B Turbo",
          "contextWindow": 131072,
          "maxTokens": 16384
        },
        {
          "id": "zai-org/GLM-4.7-Flash",
          "name": "Tiiny GLM 4.7 Flash",
          "contextWindow": 131072,
          "maxTokens": 16384
        },
        {
          "id": "Qwen/Qwen3.6-27B"
        },
        {
          "id": "Qwen/Qwen3.8-27B-Turbo"
        },
        {
          "id": "huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated-Turbo"
        },
        {
          "id": "trohrbaugh/Qwen3.8-27B-heretic-ara-Turbo"
        },
        {
          "id": "ornith-ai/Ornith-1.5-35B-A3B-Turbo"
        }
      ]
    }
  }
}
```

>
> [!NOTE]
> Export env variable `TIINY_API_KEY` in the shell that runs `redeye`.
> 

```sh
caffeinate -i npx redeye pi -m tiiny/Qwen/Qwen3.6-35B-A3B \
  --concurrency 1 --timeout 7200 --retries 3
```

Or with `-turbo` model:

>
> [!NOTE]  
> Turbo mode is only about 10% faster.
>

```sh
tiiny load Qwen/Qwen3.6-35B-A3B-turbo
```

```sh
caffeinate -i npx redeye pi -m tiiny/Qwen/Qwen3.6-35B-A3B-turbo \
  --concurrency 1 --timeout 7200 --retries 3
```

>
> [!TIP]  
> `--concurrency 1`
> The box answers one request at a time, and it keeps a prompt cache for only
> one conversation. With one agent, each turn reuses the cache from the turn
> before, so the box only reads the new tokens. With two or more agents,
> their requests alternate, each one evicts the other's cache, and every turn
> reads the agent's whole context again, which slows things down.
>


Measured on the box with `Qwen3.5-9B-Turbo` and a 23k token prompt:

| Request                           | Time  |
|-----------------------------------|-------|
| Cold                              | 17.8s |
| Same prefix, plus one more turn   | 1.4s  |
| Same prefix, after another prompt | 17.9s |

The box reads a prompt at about 1,300 tokens per second, so an agent with
a 50k token context spends about 40 seconds per turn when its cache is
gone. In a run with `--concurrency 2`, turns took about 100 seconds each,
because each agent also waited for the other's request. Extra agents make
the whole run slower, not just each agent.


#### 1. Load the right model

```sh
tiiny load Qwen/Qwen3.6-35B-A3B
```
>
> [!NOTE]  
> In tests, `tiiny` answers one request at a time no matter which model
> is loaded, so the `n%` NPU values don't really matter.
>

>
> [!NOTE]
> The model passed to `-m` must be the one loaded on the box. A
> mismatch makes the box return a 404, which `redeye` treats as a
> provider error and stops the run with a message naming the model.
> No retries are spent.
>

##### Qwen3 Coder Next -- 94% NPU

The 94% NPU memory footprint leaves almost no headroom on the Tiiny Pocket and
the older February 2026 weights trail the April 2026 `Qwen3.6` models on harder
bug-fixing benchmarks.

```sh
tiiny load Qwen/Qwen3-Coder-Next
```

##### Qwen3.6 35B A3B Turbo -- 45% NPU

```sh
tiiny load Qwen/Qwen3.6-35B-A3B-turbo
```

##### Qwen/Qwen3.6-27B

Dense models activate all `27B` parameters on every token, giving `Qwen3.6-27B`
a noticeable edge on tricky multi-file logic and terminal recovery.

```sh
tiiny load Qwen/Qwen3.6-27B
```

##### GLM 4.7 flash -- 57% NPU

> [!WARNING]  
> Slow with `zai-org/GLM-4.7-Flash`.
> About 8 times slower than Qwen 3.6.

```sh
tiiny load zai-org/GLM-4.7-Flash
```

#### 2. Run the Loop

Keep `--concurrency 1` with every `tiiny` model. A higher value makes
the agents evict each other's prompt cache (see
[Local Model With `pi`](#local-model-with-pi)).

Retries continue an existing ticket branch when it has commits ahead
of the base branch. `--timeout 7200` gives the model two hours per
attempt, and `--retries 3` gives each ticket up to four tries after
failures. A timeout itself is not retried: redeye auto-commits dirty
changes and sends the branch through the test gate and merge.

##### Qwen3.5-9B-Turbo

>
> [!TIP]
> The fastest model.
>

```sh
caffeinate -i npx redeye pi -m tiiny/Qwen/Qwen3.5-9B-Turbo \
  --concurrency 1 --timeout 7200 --retries 3
```

---

##### Qwen3.6-35B-A3B-turbo

```sh
caffeinate -i npx redeye pi -m tiiny/Qwen/Qwen3.6-35B-A3B-turbo \
  --concurrency 1 --timeout 7200 --retries 3
```

---

##### Qwen3.8-27B-Turbo

```sh
caffeinate -i npx redeye pi -m tiiny/Qwen/Qwen3.8-27B-Turbo \
  --concurrency 1 --timeout 7200 --retries 3
```


##### Huihui-Ornith-1.5-35B-A3B-abliterated-Turbo

```sh
caffeinate -i npx redeye pi \
  -m tiiny/huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated-Turbo \
  --concurrency 1 --timeout 7200 --retries 3
```


##### Qwen3.8-27B-heretic-ara-Turbo

```sh
caffeinate -i npx redeye pi -m tiiny/trohrbaugh/Qwen3.8-27B-heretic-ara-Turbo \
  --concurrency 1 --timeout 7200 --retries 3
```

##### Ornith-1.5-35B-A3B-Turbo

```sh
caffeinate -i npx redeye pi -m tiiny/ornith-ai/Ornith-1.5-35B-A3B-Turbo \
  --concurrency 1 --timeout 7200 --retries 3
```





----------------------------




## `.redeye.json`

An optional config file at the repo root. When present with an
`adversarial` key, each ticket goes through a cross-model review loop
before it can merge.

```json
{
  "adversarial": {
    "implement": "claude -m opus --effort high",
    "review": "pi --effort medium",
    "maxRounds": 3,
    "minRounds": 1
  }
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `implement` | yes | -- | Role string for the implementing agent. Same syntax as the CLI: `<provider> [-m model] [--effort level] [--max-turns n] [--prefer-subagent model] [-- harness args]`. See [Extra harness arguments](#extra-harness-arguments---) |
| `review` | yes | -- | Role string for the reviewing agent |
| `maxRounds` | no | `3` | Maximum review/fix rounds per ticket |
| `minRounds` | no | `1` | Minimum rounds before a clean review can pass the ticket |

Each ticket that passes the test gate goes through rounds in its
own worktree:

1. The `review` role reads the ticket, the spec and the branch's
   diff, and writes findings. It cannot change anything.
2. If findings are open and rounds remain, the `implement` role
   acts as the fixer. It fixes each finding with `/tdd` and marks
   it `[x]`, or disputes it by leaving it unchecked and writing
   the reason in its notes file.
3. The test gate runs again. A failure gets another fix attempt
   with the failure in its prompt; when the fix attempts run out,
   the ticket attempt fails and the normal `--retries` policy
   applies.
4. The next round's reviewer sees each open finding with the
   fixer's response, and gives every one a verdict: confirmed
   fixed, withdrawn, or still open. It may add new findings.
   `No findings.` is only accepted when nothing was open.

Only the reviewer closes a finding. A fixer's `[x]` stays open
until the reviewer confirms it, and a dispute stays open until
the reviewer withdraws the finding.

A ticket passes when a round ends with no open findings and
at least `minRounds` rounds have run. With `minRounds: 2`, a
clean first round is followed by a second review before the
ticket merges. When the review in round `maxRounds` leaves
findings open, the ticket becomes `ready-for-human` (unresolved)
with its branch kept, and the fixer does not run after that
final review. A reviewer that exits non-zero, times out or writes
findings redeye cannot parse fails the attempt.

Every round is appended to
`.scratch/<feature>/reviews/<ticket file name>`: the findings and
their verdicts, the fixer's response to each (fixed, or disputed
with its reason), the test result and the branch head after the
fix. Each entry is committed as it is written.

If a run is interrupted mid-loop, the next run resumes the ticket
at the round after the last one recorded, without implementing it
again. This happens only when the ticket branch still exists, its
head matches the head the log last recorded, and the log has no
pass, unresolved or failed entry after that round. Otherwise, if
the branch has commits ahead of base, the implement role continues
that branch and the test gate and review rounds run again. A branch
with no new commits starts fresh.

A missing file or a file with no `adversarial` key leaves
behavior unchanged. Invalid JSON, an `adversarial` value that
is not an object, a missing role, or an invalid role string
stops the run before any branch or worktree is created
(exit 2).

With `adversarial` set, a bare `redeye` runs tickets with the
`implement` role. A provider on the command line replaces the
whole `implement` role for that run (its flags do not carry
over), and redeye logs one line saying so. Flags inside a role
string win for that role; run-wide flags such as `-m` or
`--effort` fill in whatever the string leaves out, for both
roles:

```sh
# .redeye.json: implement "claude -m opus", review "pi"
redeye --effort high -m qwen
# implement: claude, model opus, effort high
# review: pi, model qwen, effort high
```

Both role executables are checked before the run starts; a
missing one exits 2 before any branch is created. When both
roles resolve to the same provider and model, redeye warns once
(also in `--dry-run`) and runs anyway. Outside a git repo the
loop does not run, and redeye logs that it was skipped.

A role string with `--max-turns` or `--prefer-subagent` on a
provider that does not support them is not an error -- redeye
warns and drops the flag for that role, the same as the CLI
path.


## Command Line Arguments

Flags:

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `[provider]` | no | -- | Agent harness to spawn (e.g. `claude`, `codex`, `pi`, `hermes`). Optional when `.redeye.json` sets `implement` -- the implement role's provider is used. A CLI provider overrides implement |
| `[turns]` | no | -- | Max agentic turns per agent run (positional shorthand for `--max-turns`) |
| `-m`, `--model` | no | -- | Model flag passed to the agent |
| `--spec <name>` | no | auto | Feature name (resolves `.scratch/<name>/`) |
| `--dry-run` | no | -- | Show wave order and prompt without running |
| `--no-review` | no | review on | Skip the review and fix pass at the end of a run |
| `-X` | no | -- | Stop on merge conflict instead of re-spawning |
| `--timeout` | no | `3600` | Kill the agent after N seconds. A killed agent is not a failure: its work is kept (see Notes) |
| `--test-cmd <cmd>` | no | auto | Run in each worktree after the agent exits; non-zero exit rejects the ticket. Defaults to `npm test` when `package.json` has a `test` script. When nothing is detected the run has no test gate and says so at startup. Pass `""` to run without a gate. Shares the agent's `--timeout`. Dependencies are already installed by `--install-cmd` |
| `--install-cmd <cmd>` | no | auto | Run in each fresh worktree before the agent starts, and again after a merge-conflict rebase; non-zero exit fails the attempt (it is retried like any other failure). Auto-detects from the lockfile: `pnpm-lock.yaml` -> `pnpm install --prefer-offline --frozen-lockfile`, `package-lock.json` -> `npm ci --prefer-offline --no-audit --no-fund`, a `package.json` with no lockfile -> `npm install --prefer-offline --no-audit --no-fund --no-package-lock`, no `package.json` -> no install. Pass `""` to disable. Shares the agent's `--timeout`. Output goes to `<ticket>.install.log` |
| `--max-turns <n>` | no | -- | Max agentic turns per agent run. Forwarded as `--max-turns <n>` to `claude` only; for `codex` and `pi` the flag is skipped with a warning and the agent runs with no turn limit. The limit is per spawn, not a total for the ticket: every retry and every re-spawn after a merge conflict starts with a fresh budget of `n` turns, so with `--retries 3` one ticket can use up to 4 x `n`. When omitted (or `0`), no limit is passed, so `--timeout` is the only cap. Takes precedence over the `[turns]` positional when both are given. Reaching the limit is an error exit, so the attempt fails and is retried like any other failure |
| `--effort <level>` | no | -- | Starting effort/reasoning level. Each provider has its own ladder: `claude` supports `low`, `medium`, `high`, `xhigh`, `max` (forwarded as `--effort`); `codex` supports `low`, `medium`, `high` (forwarded as `-c model_reasoning_effort=<level>`); `pi` supports `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (forwarded as `--thinking`). Omitted = provider default. Each retry steps up from here (see `--retries`) |
| `--prefer-subagent <model>` | no | -- | `claude` only. Sets `CLAUDE_CODE_SUBAGENT_MODEL=<model>` for every claude agent redeye spawns (tickets, merge-conflict re-spawns, the reviewer and the fixer) and adds a prompt rule: hand read-only work (exploring the codebase, searching code, test runs with long output) to subagents, and make every edit and commit yourself. The reviewer gets the rule without the edit and commit line, since it never edits. `""` is the same as omitting the flag. For `codex` and `pi` it is skipped with one warning at startup (`--prefer-subagent not supported by <provider>, skipping`). `--dry-run` prints `Prefer subagent: <model>`, or `(none)`. See [`--prefer-subagent` option](#--prefer-subagent-option) |
| `--retries <n>` | no | `3` | Extra attempts after failure; see Notes |
| `--retry-delay <n>` | no | `30` | Seconds to wait before the first retry; doubles each further retry (30s, 60s, 120s, ...). `0` disables the wait |
| `--concurrency <n>` | no | `5` | Max agents running at once within a wave. A wave with more ready tickets than this runs them through a pool: as one agent exits, the next ticket starts. The wave still finishes fully before its branches are merged |
| `-- <args>` | no | -- | Everything after `--` goes to the implement agent's harness as written. See [Extra harness arguments](#extra-harness-arguments---) |


### Notes

* When `--spec <name>` is omitted, the CLI looks for
  `.scratch/<feature>/issues/` directories. If multiple features exist,
  **it prompts you to pick one or more** with an interactive
  selector.
* Tickets are selected by `**Status:** ready-for-agent` in the file body.
* Dependencies are read from the `**Blocked by:**` field; the orchestrator
  skips tickets whose blockers haven't completed.
* Unblocked tickets run in parallel. After a wave finishes, newly unblocked
  tickets start in the next wave.
* An agent run only counts as a success when the agent exits 0,
  its worktree branch has new commits relative to the base branch,
  and the test command (see `--test-cmd`), when there is one, exits
  0 in that worktree.
  Uncommitted changes left by the agent are auto-committed before
  the check. On success, the ticket's status is updated to `done`
  in-place. If the agent exits 0 but made no commits, or the test
  command fails, the ticket is left `ready-for-agent` for a retry
  and the test output is written to `<dir>/../logs/<ticket>.test.log`.
  Failed tickets (non-zero exit) keep their status and block
  dependents. The status display marks those dependents as blocked
  and names the failed ticket.
* After an agent finishes, redeye independently runs the test gate,
  even if the agent already ran tests. Ticket gates and the final
  review-fix gate announce the command, worktree, and timeout, then
  report elapsed time every 15 seconds while waiting for it to finish.
  A heartbeat means the command is still running; it does not prove
  that individual tests are advancing. Test output is captured and
  saved when the command finishes, and the completion message gives
  the log path. The log is not a live stream.
* A failed attempt is retried, up to `--retries` times, before the
  ticket is recorded as failed. Non-zero exit, exit 0 with no new
  commits, and a red test command all count as failures; a timeout
  does not (see below). A retry continues an existing ticket branch
  if it has commits ahead of base, preserving those commits and
  merging in base if it has moved. Otherwise it starts fresh from
  base. `--retries 0` disables retries. Each retry also raises the effort
  level one rung up the provider's ladder: without `--effort` the
  first retry uses `high`; with `--effort <level>` each retry
  steps one level up from the previous attempt, stopping at the
  provider's max (`max` for claude/pi, `high` for codex).
  Retries are spaced with exponential backoff controlled by
  `--retry-delay`: the first retry waits `--retry-delay` seconds,
  the second waits double that, and so on. This lets provider
  outages clear before burning the next attempt. Retry
  logs are written to `<dir>/../logs/<ticket>.attempt<n>.log`
  (and `.attempt<n>.test.log` for the test command) so the first
  attempt's log is kept.
* Each attempt at a ticket appends an entry to
  `.scratch/<feature>/learnings.md`, next to `progress.md`. The
  entry records what the orchestrator saw (the outcome, the agent's
  exit code, the checklist items it reported, and the last lines of
  the test or install log when one of those failed) and, when an
  agent ran, the agent's own notes. The file is committed along with
  `progress.md` and persists across runs. Each agent's prompt
  includes the most
  recent entries for its own ticket and the last successful entry of
  each ticket that directly blocks it, so a retry can see why the
  previous attempt failed. Agents keep their notes in
  `.redeye/notes.md` inside the worktree. redeye collects
  that file when the agent exits, and a self-ignoring
  `.redeye/.gitignore` keeps it out of the agent's commits.
* A ticket that exhausts all its retry attempts is excluded from
  later waves in the same run. It stays `ready-for-agent` on disk
  so a future run can pick it up, but it will not be re-started
  within the current invocation. The final summary line includes
  the count of failed tickets when any failed.
* An agent still running at `--timeout` is killed. The kill is
  reported in the status display and in the ticket log. It is not
  treated as an agent failure: uncommitted changes in the worktree
  are auto-committed, and the branch goes through the same
  new-commits check, test gate, and merge as an agent that exited 0.
  Opus tickets have taken over 12 minutes of API time, which is why
  the default is an hour rather than the old 15 minutes.
* Agents are spawned in their own process group (`detached:true`).
  When the timeout fires or when you press Ctrl-C (SIGINT) or send
  SIGTERM, the orchestrator kills the entire process group -- not
  just the agent process -- so dev servers, watchers, and other
  child processes are cleaned up. SIGINT exits 130 and SIGTERM
  exits 143 after killing all running agents and restoring the
  terminal.
* For fast models that reliably finish tickets in a few minutes,
  `--timeout 900` is a reasonable cap that catches stuck agents
  sooner than the one-hour default.
* `.scratch/` should be listed in your project's `.gitignore`.
  The orchestrator force-adds and commits ticket files, `progress.md`,
  `learnings.md` and review logs despite that rule. These records live
  on the branch where the run merges its work. Agent logs and spec
  files are not automatically force-added.
* Agent logs are written to `<dir>/../logs/<ticket>.log`.
* Provider commands are launched non-interactively with default flags
  that grant the agent write access to the worktree, so tickets can
  actually be implemented without a permission prompt:
  * `claude`: `--print --dangerously-skip-permissions`
  * `codex`: `exec --dangerously-bypass-approvals-and-sandbox`
    (codex removed `--full-auto`; the workspace-write sandbox
    cannot commit in a worktree because its `.git` link points
    outside the tree)
  * `pi`: `-p --verbose --approve --no-session --mode json`
    (prompt delivered via temp file; `--approve` auto-accepts
    tool-use proposals so the agent runs non-interactively)
  * `hermes`: `--yolo chat --query-file - --quiet` (prompt read
    from stdin; `--quiet` makes the turn one-shot so hermes exits
    when done; `--yolo` skips approval prompts)


### `--spec <name>` option

A feature name that resolves to `.scratch/<name>/`.
The spec file is `.scratch/<name>/spec.md` and the issues directory
is `.scratch/<name>/issues/`.


### `graph` command

`redeye graph` lists the features whose tickets wait on tickets
in other features, the tickets that wait, and the features to select
together so the work can run.

Without `--spec` it reports every feature the picker shows. With
`--spec <name>` it reports that one feature and what it waits on.
The name can be one the picker hides: a nested feature such as
`rollout/billing`, or a complete one.

The sample below is from a run with three features.
`held-import-review` has two tickets: `01` is blocked by
`newsletter-audit/16`, and `02` by `01`. `analytics` has no
blockers.

```bash
npx redeye graph
```

```text
held-import-review (0/2 ready)
  held-import-review waits on newsletter-audit
    held-import-review/01 waits on newsletter-audit/16 (ready-for-agent)
  Run together: held-import-review, newsletter-audit (select both in the picker)
    2 of 2 ready-for-agent tickets become runnable

Not waiting on other features: analytics, newsletter-audit
```

Each block opens with the feature's counts.
`X waits on Y` lines group the blocking refs by feature pair, so a
block also shows waits further up the chain, such as a feature this
one waits on that itself waits on a third.


### `--prefer-subagent` option

Usecase is a strong model on the ticket, and cheaper, faster
model to handle exploring the codebase, searching, and running
tests whose output would flood the main agent's context. The subagent then
reports back a short answer to the main agent.

The flag does two things for every claude agent redeye spawns.

1. It sets `CLAUDE_CODE_SUBAGENT_MODEL=<model>` in the agent's environment.
2. It adds a rule to the prompt: hand read-only work to subagents,
   brief each one fully, do not delegate a lookup that takes a single
   tool call, and never let a subagent edit files or commit.

`<model>` is anything the harness accepts as a model, like an alias, eg
`sonnet` or `haiku`, or a full model ID. Sonnet is the safer choice
when subagents need judgment, such as tracing a call path across
modules. Haiku is cheaper and faster, and suits mechanical lookups and
summarizing long test output, but it is more likely to miss things.

```sh
# Opus writes the code, Sonnet subagents explore and run tests
npx redeye claude -m claude-opus-4-6 --prefer-subagent sonnet

# Cheaper subagents for searches and noisy test runs
npx redeye claude -m claude-opus-4-6 --prefer-subagent haiku

# A Sonnet main agent with Haiku subagents
npx redeye claude -m claude-sonnet-5-5 --prefer-subagent haiku

# Pin an exact model ID instead of an alias
npx redeye claude -m claude-opus-5-5 --prefer-subagent claude-sonnet-5-5

# dry run
# Check the setting and the prompt rule without running anything
npx redeye claude --prefer-subagent claude-haiku-5-5 --dry-run
```

Only the `claude` provider supports the `--prefer-subagent` flag.
With `codex` or `pi` it is skipped with one warning at startup.

Subagent turns do not count toward `--max-turns`. That was observed on
Claude Code 2.1.296 and is not documented by Anthropic, so it may
change. Subagent time does count against `--timeout`, because the
timeout covers the whole agent process.

### Extra harness arguments (`--`)

Everything after `--` is passed to the agent harness as written.
redeye does not parse it, so it can hold flags redeye has no option
for.

On the command line, the extra args go to the implement role:

```sh
# every implement agent runs as `pi ... --no-skills`
npx redeye pi -m sonnet -- --no-skills
```

In `.redeye.json`, each role string can end with its own `--` list:

```json
{
  "adversarial": {
    "implement": "claude -m opus -- --disallowedTools WebFetch",
    "review": "pi --effort medium -- --no-skills"
  }
}
```

Which args each role gets:

* A provider on the command line replaces the implement role whole,
  so implement gets the CLI's extra args only.
* With no provider on the command line, implement gets its role
  string's extra args followed by the CLI's.
* The review role gets its own role string's extra args only. CLI
  extra args never reach the reviewer.

The implement role's extra args reach every agent it runs: ticket
attempts and retries, merge-conflict re-spawns, the adversarial
loop's fixer, and the fixer in the end-of-run review pass. The
reviewer in the adversarial loop, and in the end-of-run review when
`adversarial` is set, gets the review role's list. The run header
shows the implement role with its extra args.

Each extra arg is its own argv entry, with no shell in between, so
an arg your shell passed with spaces or `$` in it reaches the
harness unchanged. A role string is split on whitespace and has no
quoting, so an extra arg in `.redeye.json` cannot contain a space. They go after
every flag redeye builds (the provider's defaults, `--model`,
`--max-turns`, `--thinking` or `--effort`, codex's `-c`), and before
pi's `@<prompt file>`, so the prompt stays the last argument.

redeye does not check these args. A flag the harness rejects fails
the attempt like any other non-zero exit, and it is retried. Some
flags break the run outright: anything that changes the harness's
output format (pi's `--mode`, claude's `--output-format`) or its
permission mode (see the default flags under [Notes](#notes)).
redeye reads the harness's output and needs it to run without
prompts.

Provider notes:

* pi's `--no-context-files` also stops pi from loading the target
  project's `AGENTS.md`, so the agent works without the project's
  own instructions.
* For hermes, the extra args land after `chat`
  (`hermes --yolo chat --query-file - --quiet ... <args>`), so only
  `chat` options work there.


### Environment Settings

Spawned agents load your global `~/.claude` plugins and hooks. Those
can spend turns and steer delegation their own way, and redeye does
not isolate agents from them.

---

## How It Works

Tickets run in "waves". A wave is a batch of tickets whose blockers are
all done. The tickets in a wave run in parallel, up to `--concurrency`
at once, and each ticket gets a worktree named after the ticket slug.
`redeye` waits for the whole batch to finish, merges the branches of
the tickets that succeeded, and marks them `done`. Then it looks for
tickets that are newly unblocked. Those form the next wave. This
continues until no ticket is ready to run.

The wave total in the status display header (the `3` in `Wave 2/3`) is
a prediction made at startup. It assumes every ticket succeeds. When a
ticket fails, its dependents never become ready, so the run can end
before it reaches the predicted last wave.

### Worktrees

Each ticket gets its own git worktree. Agents work in
isolation so parallel tickets never conflict. After a wave completes,
successful branches are merged back into the base branch.
The first branch merges directly, and subsequent branches rebase
onto the updated base before merging.

Worktrees are created next to the repository, not inside it: a
ticket's worktree is the sibling directory
`<repo>.<feature>-<num>-<slug>` on the branch
`<repo>--<feature>-<num>-<slug>`. A run that is interrupted leaves
them in place. On the next attempt, redeye continues an existing
ticket branch with commits ahead of base, recreating its worktree
and merging in base if it has moved. An interrupted adversarial
review loop resumes from its recorded round. Otherwise, redeye
removes the stale worktree and branch and starts fresh from base.
Commit work you want to preserve before restarting: uncommitted
changes in a stale worktree are discarded when it is recreated.

A fresh worktree has only tracked files, so there is no
`node_modules`. Before the agent starts, the orchestrator installs
dependencies with the command that matches the project's lockfile
(see `--install-cmd`). The prompt tells the agent not to run another installer.
The install never writes a lockfile, so ticket
branches do not commit one by accident.

If a merge conflict occurs, the behavior depends on the `-X` flag: by
default the agent is re-spawned to resolve it; with `-X`,
the run stops immediately.

### Progress

A file `progress.md` is written to the `.scratch/<feature>/` directory
and committed after each ticket completes, so you can monitor the run from
another terminal by reading the file.

### Integration branch

Launched from your default branch (`main`), redeye does not merge
into it. It creates `redeye--<feature>` (or `redeye--all` for
several features), merges every ticket there, and leaves you on that
branch. Running again from `main` resumes the same branch. Finished
tickets stay finished. Launched from any other branch, it merges into
that branch.

After you merge the integration branch into `main`, the next run
fast-forwards it to `main` and resumes. If the branch has commits `main`
lacks, redeye reports how far behind it is; merge `main` into it or
delete it with `git branch -D`.

### `.scratch/` in git

If `.scratch/` is gitignored, the bookkeeping files (tickets, progress,
learnings, review) are force-added and live on the integration branch, so
they disappear from disk when you check out `main`.

### Review

After the last wave, an agent reviews everything merged since the last
review and writes its findings to `.scratch/<feature>/review.md`
(`.scratch/review.md` for a multi-feature run). A second agent fixes them
test-first; its work merges only if the test command passes.
Findings it could not fix stay unchecked in `review.md`.
Skip this with `--no-review`.


### Status display

In a terminal, redeye shows a header line, one row per ticket, and
a log of recent messages. The ticket list holds every ticket that was
`ready-for-agent` when the run started, and it stays the same for the
whole run. Rows do not move, disappear, or reappear between waves.

Each row starts with a dot that shows the ticket's state:

* Dim empty dot: pending. The ticket has not started yet.
* Yellow dot: running. The agent is working, the test command is
  running, or the ticket is waiting out a retry delay.
* Cyan dot: waiting to merge. The agent and the test command
  succeeded, and the branch waits for the rest of the wave to finish.
  The dot stays cyan while the branch is merged, including while a
  re-spawned agent resolves a merge conflict.
* Green dot: done.
* Red dot: failed.
* Dim filled dot: blocked. A ticket upstream failed or is not agent
  work (for example, it is `ready-for-human`), so this ticket cannot
  run in this session. The row names the blocking tickets, as in
  `auth/03 (blocked by auth/01)`.

A claude ticket's row can end with its subagent count and cost, as in
`auth/02 - 2 subagents, $0.42` (see [`--prefer-subagent` option](#--prefer-subagent-option)).

The header looks like this:

```
Wave 2/3 - 5/8 done - 63%
```

The counts cover only this run's tickets, the ones in the list.
Tickets finished by an earlier run are not counted.

The review pass runs after the last ticket, so the header holds at
99% until it ends and names the step it is on, with that step's
elapsed time:

```
Wave 5/5 - 9/9 done - 99% - fixing findings (3m 12s)
```

The steps are `reviewing`, `fixing findings` and `testing fix`. The
reviewer and the fixer can work for minutes without printing a
message, so every 30 seconds each one logs that it is still running,
with its elapsed time and, for claude, how many tools it has called
so far. These lines also appear when stdout is not a terminal.

When stdout is not a terminal, for example when it is piped to a file,
redeye prints one line per wave that names the wave's tickets,
followed by plain log lines.

Known limit: with `-X`, the run stops at the first merge conflict. A
ticket whose branch succeeded but came after the conflicting branch is
never merged, and its row stays on the cyan "waiting to merge" dot when
the run stops.

## See Also

* [Verification-Driven Development (VDD)](https://gist.github.com/dollspace-gay/45c95ebfb5a3a3bae84d8bebd662cc25)
  (gist)
* [`roast` CLI tool](https://github.com/bluesky-social/roast)
* [addyosmani/adverse](https://github.com/addyosmani/adverse)
