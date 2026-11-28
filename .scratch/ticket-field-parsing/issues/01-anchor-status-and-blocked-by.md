# 01: Read Status and Blocked by only from field lines

**Status:** done

**Blocked by:** None

**Touches:** `src/orchestrator.ts` (`parseStatus`, `markDone`,
`markHuman`), `src/blockers.ts` (`FIELD_RE`), `test/orchestrator.test.ts`,
`test/blockers.test.ts`

## Problem

redeye finds a ticket's status and blockers with patterns that match
anywhere in the file, not only at the start of a line. A ticket whose
prose quotes the field markers, for example a ticket that describes the
ticket format, gets parsed from that prose instead of from its real
field lines.

Seen in the `adversary` repo, ticket
`.scratch/adversary-cli/issues/04-findings-tickets-fixer-round-commit.md`.
Its description said:

```
follow `docs/agents/issue-tracker.md`: numbered from 01, with
`**Status:**` and `**Blocked by:** None` lines, recording severity,
...
**Status:** done
```

`parseStatus` returned
``"` and `**blocked by:** none` lines, recording severity,"`` for that
ticket, so redeye treated a done ticket as not ready and printed, for
every ticket blocked by it:

```
Nothing to run: every ready-for-agent ticket is waiting on a blocker.
  adversary-cli/05 waits on adversary-cli/04 (` and `**blocked by:** none` lines, recording severity,)
```

The same pattern appears in four places:

1. `parseStatus` in `src/orchestrator.ts`:
   `body.match(/\*\*Status:\*\*\s*(.+)/i)` takes the first match in
   the body.
2. `markDone` in `src/orchestrator.ts`:
   `body.replace(/\*\*Status:\*\*\s*.+/i, '**Status:** done')`
   rewrites the first match. On a ticket like the one above it would
   overwrite the prose and leave the real status line unchanged.
3. `markHuman` in `src/orchestrator.ts`: same as `markDone`, with
   `HUMAN_STATUS`.
4. `FIELD_RE` in `src/blockers.ts`: `/\*\*Blocked by:\*\*/i` is tested
   against each line, so `fieldText` starts at the first line that
   mentions the marker anywhere. In the ticket above it read `None`
   from the prose. That was correct only by luck. A prose line such
   as "unlike the `**Blocked by:** 02` example" would add a fake
   blocker.

`\s*` after the marker is also a problem: with an empty
`**Status:**` line it crosses the newline and reads the next line as
the status.

## Fix

Match a field only when the marker starts the line. Allow the same
lead-in that `NEXT_FIELD_RE` in `src/blockers.ts` already allows
(leading whitespace and an optional `-` or `*` list marker), so the two
definitions of "a field line" agree. Do not let the gap after the
marker cross a newline.

Suggested shape, in one shared place so the reader and the writers
cannot drift apart:

```ts
// A **Status:** field line. Group 1 is the lead-in, group 2 the value.
const STATUS_LINE_RE = /^(\s*(?:[-*]\s+)?)\*\*Status:\*\*[ \t]*(.*)$/im

export function parseStatus (body:string):string {
    const m = body.match(STATUS_LINE_RE)
    return m ? m[2].trim().toLowerCase() : ''
}
```

In `markDone` and `markHuman`, replace through the same pattern and
keep the lead-in, so a status inside a list item stays in the list:

```ts
const updated = body.replace(
    STATUS_LINE_RE,
    (_, lead:string) => `${lead}**Status:** done`
)
```

In `src/blockers.ts`:

```ts
const FIELD_RE = /^\s*(?:[-*]\s+)?\*\*Blocked by:\*\*/i
```

`fieldText` already slices after `m.index + m[0].length`, so it keeps
working with the anchored pattern.

Check `docs/agents/issue-tracker.md` while doing this. It says each
field is "a `**Status:**` line" and "a `**Blocked by:**` line". After
this change that is exactly what the parser reads, so add one sentence
saying that a marker quoted inside other text is ignored.

## Acceptance criteria

- [x] A ticket whose prose quotes `` `**Status:**` `` in backticks
      before its real status line gets the real status from
      `parseStatus`
- [x] `markDone` on that ticket changes the real status line to
      `done` and leaves the prose line unchanged
- [x] `markHuman` on that ticket changes the real status line and
      leaves the prose line unchanged
- [x] A ticket whose prose mentions `**Blocked by:** 02` before its
      real `**Blocked by:** None` line has no blockers
- [x] A ticket with an empty `**Status:**` line followed by a
      non-empty line has an empty status, not the next line's text
- [x] A status or blocked-by field written as a list item
      (`- **Status:** ready-for-agent`) still parses, and `markDone`
      keeps the `- ` lead-in
