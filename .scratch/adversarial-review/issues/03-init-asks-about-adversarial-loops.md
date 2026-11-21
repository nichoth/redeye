# 03: redeye init asks about adversarial loops

**What to build:** `redeye init` asks, after the tracker question,
whether to run an adversarial review loop on each ticket (default
no). On yes, it asks for the implement command and the review
command as free text, validates each with the role-string parser
from ticket 01, and asks again on an invalid string. It then writes
the `adversarial` key to `.redeye.json` with explicit `maxRounds`
and `minRounds` defaults, merging into an existing file and keeping
its other keys. On no, it does not create or modify `.redeye.json`.

**Blocked by:** 01

**Touches:** `src/setup.ts` (`SetupOpts` gains an optional
adversarial config; `setup()` writes or merges `.redeye.json`);
`src/index.ts` (the `init` command's `@inquirer/prompts` questions);
`test/setup.test.ts`

**Status:** done

Notes:

- The file writing lives in `setup()` so it is testable without the
  interactive prompt. The prompts themselves stay untested, like
  the existing tracker prompt.
- Mention the new `init` question in the README.

- [x] `setup()` given an adversarial config writes `.redeye.json`
  with `implement`, `review`, `maxRounds` and `minRounds`
- [x] `setup()` given an adversarial config and an existing
  `.redeye.json` with other keys keeps those keys and adds
  `adversarial`
- [x] `setup()` with no adversarial config leaves an existing
  `.redeye.json` untouched and creates none when it is absent
