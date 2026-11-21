import { test } from '@substrate-system/tapzero'
import {
    mkdtempSync, mkdirSync, writeFileSync, readFileSync,
    readdirSync, existsSync, rmSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, execSync } from 'node:child_process'
import type { Display } from '../src/display.js'
import {
    runWavesIsolated,
    scanTickets,
} from '../src/orchestrator.js'
import { readProgress } from '../src/progress.js'
import {
    FIX_FAILURE_TEXT,
    parseReviewEntries,
    parseTicketReviewLog,
    ticketReviewPath,
    renderTicketRound,
    renderTicketTerminal,
    type TicketRoundEntry,
    type TicketTerminalEntry,
} from '../src/review.js'
import { subagentRule } from '../src/rules.js'
import { renderRunStats } from '../src/stats.js'

const MOCK = join(process.cwd(), 'test', 'mock-agent-review.js')
const FAKE_CLAUDE = join(
    process.cwd(), 'test', 'fake-claude', 'claude'
)
const FAKE_PI = join(
    process.cwd(), 'test', 'fake-pi', 'pi'
)
const FEAT = 'feat'

const GIT_ENV = {
    ...process.env,
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
}

function git (cwd:string, args:string[]):string {
    return execFileSync('git', args, {
        cwd, env: GIT_ENV, encoding: 'utf8',
    }).trim()
}

function quietDisplay ():Display {
    const noop = ():void => {}
    return {
        startRun: noop,
        startWave: noop,
        setTicketStatus: noop,
        setBlocked: noop,
        setTicketStats: noop,
        setRoundLabel: noop,
        setPhase: noop,
        log: noop,
        cleanup: noop,
    }
}

type Roles = { reviewer:number; fixer:number; ticket:number }

function countRoles (recordDir:string):Roles {
    const counts:Roles = { reviewer: 0, fixer: 0, ticket: 0 }
    for (const f of readdirSync(recordDir)) {
        const { role } = JSON.parse(
            readFileSync(join(recordDir, f), 'utf8')
        ) as { role:keyof Roles }
        counts[role]++
    }
    return counts
}

// The prompts each role received, from the mock's records
function promptsByRole (recordDir:string):Record<keyof Roles, string[]> {
    const prompts:Record<keyof Roles, string[]> = {
        reviewer: [], fixer: [], ticket: [],
    }
    for (const f of readdirSync(recordDir)) {
        const { role, prompt } = JSON.parse(
            readFileSync(join(recordDir, f), 'utf8')
        ) as { role:keyof Roles; prompt:string }
        prompts[role].push(prompt)
    }
    return prompts
}

function hasEveryLine (text:string, lines:string[]):boolean {
    return lines.every(line => text.includes(line))
}

type RunOpts = Parameters<typeof runWavesIsolated>[0]

type Harness = {
    projectDir:string
    recordDir:string
    reviewPath:string
    run:(
        review?:boolean,
        display?:Display,
        forkedFrom?:string,
        // spread last, over the harness defaults
        extra?:Partial<RunOpts>
    ) => Promise<{
        allDone:boolean
        branch:string
    }>
}

const ENV_KEYS = [
    'MOCK_RECORD_DIR', 'MOCK_REVIEW', 'MOCK_FIX', 'MOCK_TICKET',
    'MOCK_FIX_RESPONSES', 'MOCK_FIX_COUNTER',
    'FAKE_CLAUDE_DELEGATE', 'FAKE_CLAUDE_ENV_LOG', 'FAKE_CLAUDE_STREAM',
    'FAKE_CLAUDE_PROMPT_DIR', 'FAKE_CLAUDE_HANG', 'FAKE_CLAUDE_FAIL_ONCE',
    'CLAUDE_CODE_SUBAGENT_MODEL', 'FAKE_CLAUDE_ARGV_LOG',
    'FAKE_PI_RECORD_DIR', 'FAKE_PI_RESPONSES',
    'FAKE_PI_COUNTER', 'FAKE_PI_DELEGATE',
] as const

async function withHarness (
    env:Partial<Record<typeof ENV_KEYS[number], string>>,
    fn:(h:Harness) => Promise<void>
):Promise<void> {
    const templateDir = mkdtempSync(join(tmpdir(), 'redeye-tpl-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'redeye-ri-'))
    const recordDir = mkdtempSync(join(tmpdir(), 'redeye-rec-'))
    const saved = Object.fromEntries(
        ENV_KEYS.map(k => [k, process.env[k]])
    )
    const originalCwd = process.cwd()
    try {
        execFileSync('git', ['init', `--template=${templateDir}`],
            { cwd: projectDir, stdio: 'ignore' })
        execSync('git config core.excludesFile /dev/null',
            { cwd: projectDir })
        execSync('git config core.hooksPath /dev/null',
            { cwd: projectDir })
        execSync('git config user.email test@example.com',
            { cwd: projectDir })
        execSync('git config user.name "Test"', { cwd: projectDir })
        const base = join(projectDir, '.scratch', FEAT)
        const issuesDir = join(base, 'issues')
        mkdirSync(issuesDir, { recursive: true })
        writeFileSync(join(projectDir, '.gitignore'),
            '.scratch/*/logs/\n')
        writeFileSync(join(issuesDir, '01-only.md'),
            '# Ticket\n\n**Status:** ready-for-agent\n')
        git(projectDir, ['add', '-A'])
        git(projectDir, ['commit', '-m', 'init'])
        git(projectDir, ['branch', '-M', 'main'])

        // Start from a clean slate so values exported in the shell
        // cannot leak into the mocks
        for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k)
        process.env.MOCK_RECORD_DIR = recordDir
        for (const [k, v] of Object.entries(env)) process.env[k] = v
        process.chdir(projectDir)

        const reviewPath = join(base, 'review.md')
        await fn({
            projectDir,
            recordDir,
            reviewPath,
            run: (
                review = true,
                display = quietDisplay(),
                forkedFrom,
                extra = {}
            ) => {
                return runWavesIsolated({
                    tickets: scanTickets(issuesDir, FEAT),
                    specBody: 'SPEC',
                    specBodies: new Map([[FEAT, 'SPEC']]),
                    progressPaths: new Map([
                        [FEAT, join(base, 'progress.md')],
                    ]),
                    agentCmd: MOCK,
                    model: null,
                    timeout: 30,
                    logsDir: join(base, 'logs'),
                    featureName: FEAT,
                    conflictStrategy: 'respawn',
                    display,
                    testCmd: 'test ! -f broken.txt',
                    retries: 0,
                    retryDelay: 0,
                    review: review ? { reviewPath, forkedFrom } : undefined,
                    ...extra,
                })
            },
        })
    } finally {
        process.chdir(originalCwd)
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) {
                Reflect.deleteProperty(process.env, k)
            } else {
                process.env[k] = saved[k]
            }
        }
        rmSync(projectDir, { recursive: true, force: true })
        rmSync(recordDir, { recursive: true, force: true })
        rmSync(templateDir, { recursive: true, force: true })
    }
}

function committedEntries (projectDir:string, reviewPath:string) {
    const rel = reviewPath.slice(projectDir.length + 1)
    return parseReviewEntries(
        git(projectDir, ['show', `HEAD:${rel}`])
    )
}

test('review pass - AC6.1 AC7.1 a fix merges and the log is ' +
    'committed', async t => {
    await withHarness({
        MOCK_REVIEW: 'findings', MOCK_FIX: 'pass', MOCK_TICKET: 'pass',
    }, async h => {
        const result = await h.run()
        t.ok(result.allDone, 'tickets done')
        t.equal(git(h.projectDir, ['status', '--porcelain']), '',
            'the run leaves a clean tree')
        t.equal(result.branch, 'main', 'AC2.4 reports the branch')
        t.deepEqual(countRoles(h.recordDir),
            { reviewer: 1, fixer: 1, ticket: 1 }, 'one of each')
        const entries = committedEntries(h.projectDir, h.reviewPath)
        t.equal(entries.length, 1, 'one committed entry')
        t.equal(entries[0].status, 'fixed', 'fixed')
        t.deepEqual(entries[0].findings.map(f => f.checked),
            [true, false], 'the echoed finding is checked')
        t.equal(entries[0].to, git(h.projectDir, ['rev-parse', 'HEAD~1']),
            'marker is the tip after the fix, before the log commit')
    })
})

test('review pass - prefer-subagent AC1.6 reaches the reviewer ' +
    'and the fixer', async t => {
    const logDir = mkdtempSync(join(tmpdir(), 'redeye-envlog-'))
    const envLog = join(logDir, 'env.log')
    try {
        await withHarness({
            MOCK_REVIEW: 'findings',
            MOCK_FIX: 'pass',
            MOCK_TICKET: 'pass',
            FAKE_CLAUDE_DELEGATE: MOCK,
            FAKE_CLAUDE_ENV_LOG: envLog,
        }, async h => {
            const result = await h.run(true, quietDisplay(), undefined, {
                agentCmd: FAKE_CLAUDE,
                preferSubagent: 'haiku',
            })
            t.ok(result.allDone, 'tickets done')
            t.deepEqual(countRoles(h.recordDir),
                { reviewer: 1, fixer: 1, ticket: 1 }, 'one of each')
            const values = readFileSync(envLog, 'utf8')
                .split('\n')
                .filter(line => line !== '')
                .map(line => JSON.parse(line))
            t.deepEqual(values, ['haiku', 'haiku', 'haiku'],
                'the ticket, reviewer and fixer agents get the model')

            const rule = subagentRule('haiku')
            const readOnlyRule = subagentRule('haiku', true)
            const writeOnly = rule.filter(line => {
                return !readOnlyRule.includes(line)
            })
            const prompts = promptsByRole(h.recordDir)
            t.equal(writeOnly.length, 1,
                'one rule line is missing from the read-only variant')
            t.ok(prompts.reviewer.every(p => {
                return hasEveryLine(p, readOnlyRule)
            }), 'the reviewer prompt carries the read-only rule')
            t.ok(prompts.reviewer.every(p => {
                return writeOnly.every(line => !p.includes(line))
            }), 'the reviewer prompt omits the edit-and-commit line')
            t.ok(prompts.fixer.every(p => hasEveryLine(p, rule)),
                'the fixer prompt carries the full rule')
            t.ok(prompts.ticket.every(p => hasEveryLine(p, rule)),
                'the ticket prompt carries the full rule')
        })
    } finally {
        rmSync(logDir, { recursive: true, force: true })
    }
})

test('review pass - AC6.2 AC6.3 a red fix merges nothing but ' +
    'the marker advances', async t => {
    await withHarness({
        MOCK_REVIEW: 'findings', MOCK_FIX: 'break', MOCK_TICKET: 'pass',
    }, async h => {
        await h.run()
        t.ok(!existsSync(join(h.projectDir, 'broken.txt')),
            'the broken fix did not merge')
        const [entry] = committedEntries(h.projectDir, h.reviewPath)
        t.equal(entry.status, 'unresolved', 'unresolved')
        t.ok(entry.findings.every(f => !f.checked), 'all unchecked')

        await h.run()
        t.equal(countRoles(h.recordDir).reviewer, 1,
            'a second run does not review the same range')
    })
})

test('review pass - AC4.4 bookkeeping-only changes skip the ' +
    'review', async t => {
    await withHarness({
        MOCK_REVIEW: 'findings', MOCK_FIX: 'pass', MOCK_TICKET: 'fail',
    }, async h => {
        await h.run()
        t.equal(countRoles(h.recordDir).reviewer, 0, 'no reviewer')
        t.ok(!existsSync(h.reviewPath), 'no review log')
    })
})

test('review pass - a clean review, then nothing new to review',
    async t => {
        await withHarness({
            MOCK_REVIEW: 'clean', MOCK_FIX: 'pass', MOCK_TICKET: 'pass',
        }, async h => {
            await h.run()
            const counts = countRoles(h.recordDir)
            t.equal(counts.reviewer, 1, 'reviewed once')
            t.equal(counts.fixer, 0, 'AC5.2 no fixer')
            t.equal(
                committedEntries(h.projectDir, h.reviewPath)[0].status,
                'clean', 'clean entry'
            )
            await h.run()
            t.equal(countRoles(h.recordDir).reviewer, 1,
                'the review log commit does not trigger a review')
        })
    })

test('review pass - AC7.2 a broken review does not change the ' +
    'result', async t => {
    await withHarness({
        MOCK_REVIEW: 'clean', MOCK_FIX: 'pass', MOCK_TICKET: 'pass',
    }, async h => {
        // A directory where the log file should be: appending throws
        mkdirSync(h.reviewPath, { recursive: true })
        writeFileSync(join(h.reviewPath, 'keep'), '')
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir, ['commit', '-m', 'block the log'])
        const logs:string[] = []
        const display = {
            ...quietDisplay(),
            log: (msg:string) => { logs.push(msg) },
        }
        const result = await h.run(true, display)
        t.ok(result.allDone, 'still all done')
        t.ok(logs.some(m => m.includes('EISDIR')),
            'the review failure was logged')
    })
})

test('review pass - AC7.3 no review option, no reviewer',
    async t => {
        await withHarness({
            MOCK_REVIEW: 'findings',
            MOCK_FIX: 'pass',
            MOCK_TICKET: 'pass',
        }, async h => {
            await h.run(false)
            t.equal(countRoles(h.recordDir).reviewer, 0, 'no reviewer')
        })
    })

test('review pass - a reviewer that writes no findings file is ' +
    'review-failed and is retried next run', async t => {
    await withHarness({
        MOCK_REVIEW: 'none', MOCK_FIX: 'pass', MOCK_TICKET: 'pass',
    }, async h => {
        // As on an integration branch: the fork point is the floor
        git(h.projectDir, ['checkout', '-b', 'redeye--feat'])
        await h.run(true, undefined, 'main')
        const counts = countRoles(h.recordDir)
        t.equal(counts.reviewer, 1, 'reviewed once')
        t.equal(counts.fixer, 0, 'no fixer')
        const entries = committedEntries(h.projectDir, h.reviewPath)
        t.equal(entries.length, 1, 'one entry')
        t.equal(entries[0].status, 'review-failed', 'review-failed')

        await h.run(true, undefined, 'main')
        t.equal(countRoles(h.recordDir).reviewer, 2,
            'the unreviewed range is reviewed again')
    })
})

test('review pass - prefer-subagent AC6.4 the stats tally counts ' +
    'the reviewer and the fixer', async t => {
    const dataDir = mkdtempSync(join(tmpdir(), 'redeye-stream-'))
    const streamFile = join(dataDir, 'stream.jsonl')
    writeFileSync(streamFile, [
        {
            type: 'assistant',
            message: {
                content: [{
                    type: 'tool_use', id: 'toolu_1', name: 'Agent', input: {},
                }],
            },
        },
        {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.25,
            subagent_stats: { spawned: 1 },
        },
    ].map(line => JSON.stringify(line)).join('\n') + '\n')
    try {
        await withHarness({
            MOCK_REVIEW: 'findings',
            MOCK_FIX: 'pass',
            MOCK_TICKET: 'pass',
            FAKE_CLAUDE_DELEGATE: MOCK,
            FAKE_CLAUDE_STREAM: streamFile,
        }, async h => {
            const logs:string[] = []
            const display = {
                ...quietDisplay(),
                log: (m:string) => { logs.push(m) },
            }
            const result = await h.run(true, display, undefined, {
                agentCmd: FAKE_CLAUDE,
            })
            t.ok(result.allDone, 'tickets done')
            t.deepEqual(countRoles(h.recordDir),
                { reviewer: 1, fixer: 1, ticket: 1 }, 'one of each')
            const expected = renderRunStats({
                agentRuns: 3, withCost: 3, subagents: 3, costUsd: 0.75,
            })
            t.ok(expected !== null, 'a stats line is expected')
            t.ok(logs.includes(expected as string),
                'the ticket, reviewer and fixer are tallied')
        })
    } finally {
        rmSync(dataDir, { recursive: true, force: true })
    }
})

test('fake-pi records provider and model', async t => {
    const recDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    const promptDir = mkdtempSync(join(tmpdir(), 'redeye-pip-'))
    const promptFile = join(promptDir, 'prompt.md')
    writeFileSync(promptFile, 'hello from test')
    try {
        const r = execFileSync(
            FAKE_PI,
            ['--model', 'opus', `@${promptFile}`],
            {
                env: {
                    ...process.env,
                    FAKE_PI_RECORD_DIR: recDir,
                },
                encoding: 'utf8',
                timeout: 5000,
            }
        )
        t.ok(r !== undefined || true, 'completed')
        const files = readdirSync(recDir)
        t.equal(files.length, 1, 'one record')
        const rec = JSON.parse(
            readFileSync(join(recDir, files[0]), 'utf8')
        ) as { provider:string; model:string; prompt:string }
        t.equal(rec.provider, 'pi', 'provider is pi')
        t.equal(rec.model, 'opus', 'model recorded')
        t.ok(
            rec.prompt.includes('hello from test'),
            'prompt recorded'
        )
    } finally {
        rmSync(recDir, { recursive: true, force: true })
        rmSync(promptDir, { recursive: true, force: true })
    }
})

test('fake-pi scripts responses in order', async t => {
    const recDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    const counterFile = join(recDir, 'counter')
    const promptDir = mkdtempSync(join(tmpdir(), 'redeye-pip-'))
    const promptFile = join(promptDir, 'prompt.md')
    writeFileSync(promptFile, 'test prompt')
    const cwds:string[] = []
    try {
        for (let i = 0; i < 3; i++) {
            const cwd = mkdtempSync(
                join(tmpdir(), 'redeye-picwd-')
            )
            cwds.push(cwd)
            try {
                execFileSync(
                    FAKE_PI,
                    [`@${promptFile}`],
                    {
                        cwd,
                        env: {
                            ...process.env,
                            FAKE_PI_RECORD_DIR: recDir,
                            FAKE_PI_RESPONSES:
                                'finding,clean,exit1',
                            FAKE_PI_COUNTER: counterFile,
                        },
                        encoding: 'utf8',
                        timeout: 5000,
                    }
                )
            } catch (err) {
                if (i === 2) {
                    t.ok(true, 'third invocation exits non-zero')
                    continue
                }
                throw err
            }
        }
        const findings0 = readFileSync(
            join(cwds[0], '.redeye', 'findings.md'), 'utf8'
        )
        t.ok(
            findings0.includes('mock finding from pi'),
            'first invocation writes a finding'
        )
        const findings1 = readFileSync(
            join(cwds[1], '.redeye', 'findings.md'), 'utf8'
        )
        t.ok(
            findings1.includes('No findings.'),
            'second invocation writes clean'
        )
        t.ok(
            !existsSync(
                join(cwds[2], '.redeye', 'findings.md')
            ),
            'third invocation wrote no findings (exit1)'
        )
    } finally {
        rmSync(recDir, { recursive: true, force: true })
        rmSync(promptDir, { recursive: true, force: true })
        for (const d of cwds) {
            rmSync(d, { recursive: true, force: true })
        }
    }
})

test('fake-pi unparseable response writes garbage', async t => {
    const recDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    const counterFile = join(recDir, 'counter')
    const promptDir = mkdtempSync(join(tmpdir(), 'redeye-pip-'))
    const promptFile = join(promptDir, 'prompt.md')
    writeFileSync(promptFile, 'test')
    const cwd = mkdtempSync(join(tmpdir(), 'redeye-picwd-'))
    try {
        execFileSync(
            FAKE_PI,
            [`@${promptFile}`],
            {
                cwd,
                env: {
                    ...process.env,
                    FAKE_PI_RECORD_DIR: recDir,
                    FAKE_PI_RESPONSES: 'unparseable',
                    FAKE_PI_COUNTER: counterFile,
                },
                encoding: 'utf8',
                timeout: 5000,
            }
        )
        const content = readFileSync(
            join(cwd, '.redeye', 'findings.md'), 'utf8'
        )
        t.ok(
            !content.includes('- ['),
            'unparseable output has no finding format'
        )
        t.ok(
            !content.includes('No findings.'),
            'unparseable output is not clean'
        )
    } finally {
        rmSync(recDir, { recursive: true, force: true })
        rmSync(promptDir, { recursive: true, force: true })
        rmSync(cwd, { recursive: true, force: true })
    }
})

test('fake-pi delegates to another mock', async t => {
    const recDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    const promptDir = mkdtempSync(join(tmpdir(), 'redeye-pip-'))
    const promptFile = join(promptDir, 'prompt.md')
    writeFileSync(promptFile, 'delegate test')
    const cwd = mkdtempSync(join(tmpdir(), 'redeye-picwd-'))
    try {
        execFileSync(
            FAKE_PI,
            [`@${promptFile}`],
            {
                cwd,
                env: {
                    ...process.env,
                    FAKE_PI_RECORD_DIR: recDir,
                    FAKE_PI_DELEGATE: MOCK,
                    MOCK_RECORD_DIR: recDir,
                    MOCK_TICKET: 'fail',
                },
                encoding: 'utf8',
                timeout: 5000,
            }
        )
        t.fail('should have exited non-zero')
    } catch {
        t.ok(true, 'delegate exited non-zero')
    }
    const files = readdirSync(recDir)
        .filter(f => f.endsWith('.json'))
    t.ok(
        files.length >= 1,
        'at least one record from the pi mock'
    )
    const piRec = files
        .map(f => JSON.parse(
            readFileSync(join(recDir, f), 'utf8')
        ) as { provider?:string })
        .find(r => r.provider === 'pi')
    t.ok(piRec, 'pi invocation was recorded')
    rmSync(recDir, { recursive: true, force: true })
    rmSync(promptDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
})

// ---- Per-ticket adversarial review (US-011) ----

test('per-ticket review - clean reviewer lets ticket ' +
    'merge with pass entry', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone, 'ticket is done')
        t.ok(
            git(h.projectDir, [
                'log', result.branch, '--name-only', '--format=',
            ]).includes('mock-change-'),
            'the ticket change is merged'
        )

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        t.ok(existsSync(logPath), 'review log exists')
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )
        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(rounds.length, 1, 'one round')
        t.equal(terms.length, 1, 'one terminal')
        if (terms[0].type === 'terminal') {
            t.equal(
                terms[0].outcome, 'pass',
                'pass outcome'
            )
        }

        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 1,
            'one reviewer invocation')
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

test('per-ticket review - reviewer failure retries ' +
    'and round numbers restart', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'exit1,clean',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 1,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone, 'ticket merges on retry')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 2,
            'two terminal entries (failed + pass)')

        const failedTerm = terms.find(
            e => e.type === 'terminal' &&
                e.outcome === 'failed'
        )
        t.ok(failedTerm, 'first attempt has failed entry')
        if (failedTerm && failedTerm.type === 'terminal') {
            t.equal(failedTerm.attempt, 1,
                'failed entry is attempt 1')
        }

        const passTerm = terms.find(
            e => e.type === 'terminal' &&
                e.outcome === 'pass'
        )
        t.ok(passTerm, 'second attempt has pass entry')
        if (passTerm && passTerm.type === 'terminal') {
            t.equal(passTerm.attempt, 2,
                'pass entry is attempt 2')
        }

        const rounds = entries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2, 'two round entries')
        for (const r of rounds) {
            if (r.type === 'round') {
                t.equal(r.round, 1,
                    'round number is 1 (restarts)')
            }
        }
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

for (const bad of ['unparseable', 'exit1']) {
    test(`per-ticket review - a reviewer that gives ${bad} fails ` +
        'the attempt and the ticket is retried', async t => {
        const piRecDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
        await withHarness({
            MOCK_TICKET: 'pass',
            FAKE_PI_RECORD_DIR: piRecDir,
            // attempt 1's review is bad, attempt 2's is clean
            FAKE_PI_RESPONSES: `${bad},clean`,
            FAKE_PI_COUNTER: join(piRecDir, 'counter'),
        }, async h => {
            const result = await h.run(false, quietDisplay(), undefined, {
                retries: 1,
                adversarial: {
                    implementStr: 'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            })
            t.ok(result.allDone, 'the retried attempt passes')
            t.equal(countRoles(h.recordDir).ticket, 2,
                'implementation ran again on the retry')
            const terms = parseTicketReviewLog(readFileSync(
                join(h.projectDir, ticketReviewPath(FEAT, '01-only.md')),
                'utf8'
            )).filter(e => e.type === 'terminal')
            t.deepEqual(
                terms.map(e => (e as TicketTerminalEntry).outcome),
                ['failed', 'pass'],
                'attempt 1 failed, attempt 2 passed'
            )
        })
        rmSync(piRecDir, { recursive: true, force: true })
    })
}

test('per-ticket review - no adversarial key means ' +
    'no reviewer', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        await h.run(false)

        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 0,
            'no reviewer invocations')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        t.ok(!existsSync(logPath),
            'no review log')
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

// ---- End-of-run review pass with adversarial roles ----

function piRecords (dir:string):{ model:string|null }[] {
    return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

test('review pass - with adversarial set, the reviewer runs ' +
    'with the review role and the fixer with the implement ' +
    'role', async t => {
    const piRecDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    await withHarness({
        MOCK_TICKET: 'pass',
        MOCK_FIX: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        // the ticket's round is clean, the end-of-run review
        // finds something
        FAKE_PI_RESPONSES: 'clean,finding',
        FAKE_PI_COUNTER: join(piRecDir, 'counter'),
    }, async h => {
        const result = await h.run(true, quietDisplay(), undefined, {
            adversarial: {
                implementStr: 'mock-agent-review',
                reviewStr: 'pi -m rev-model',
                review: { provider: FAKE_PI, model: 'rev-model' },
                maxRounds: 3,
                minRounds: 1,
            },
        })
        t.ok(result.allDone, 'ticket is done')
        const records = piRecords(piRecDir)
        t.equal(records.length, 2,
            'the review role ran the ticket round and the ' +
            'end-of-run review')
        t.ok(records.every(r => r.model === 'rev-model'),
            'every review-role run got the review model')
        t.deepEqual(countRoles(h.recordDir),
            { reviewer: 0, fixer: 1, ticket: 1 },
            'the implement role ran the ticket and the ' +
            'end-of-run fix, and no review')
        const entries = committedEntries(h.projectDir, h.reviewPath)
        t.equal(entries.length, 1, 'one end-of-run entry')
        t.equal(entries[0].status, 'fixed', 'the fix merged')
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

test('review pass - with adversarial set and review off, only ' +
    'the per-ticket loop reviews', async t => {
    const piRecDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean,finding',
        FAKE_PI_COUNTER: join(piRecDir, 'counter'),
    }, async h => {
        const result = await h.run(false, quietDisplay(), undefined, {
            adversarial: {
                implementStr: 'mock-agent-review',
                reviewStr: 'pi',
                review: { provider: FAKE_PI },
                maxRounds: 3,
                minRounds: 1,
            },
        })
        t.ok(result.allDone, 'ticket is done')
        t.equal(piRecords(piRecDir).length, 1,
            'only the ticket round ran a reviewer')
        const log = parseTicketReviewLog(readFileSync(
            join(h.projectDir, ticketReviewPath(FEAT, '01-only.md')),
            'utf8'
        ))
        t.equal(log.filter(e => e.type === 'round').length, 1,
            'the ticket was reviewed')
        t.deepEqual(countRoles(h.recordDir),
            { reviewer: 0, fixer: 0, ticket: 1 },
            'no end-of-run review or fix')
        t.ok(!existsSync(h.reviewPath), 'no end-of-run review log')
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

// ---- US-012: Unresolved outcome ----
// With US-014's fix step, open findings trigger the fixer
// instead of immediately going to unresolved. These tests
// verify the fix path: a successful fix leads to a clean
// second review and pass; a broken fix fails the attempt.

test('per-ticket review - open findings trigger fix ' +
    'step and ticket passes when fixer succeeds',
async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        MOCK_FIX: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'finding,verdict-fixed',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes after fix + clean review')

        const roles = countRoles(h.recordDir)
        t.equal(roles.ticket, 1,
            'one ticket agent')
        t.equal(roles.fixer, 1,
            'one fixer invocation')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        t.ok(existsSync(logPath),
            'review log exists')
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2,
            'two rounds (finding + clean)')
        if (rounds[0].type === 'round') {
            t.ok(rounds[0].fixHead,
                'first round has fixHead')
            t.equal(
                rounds[0].testResult, 'pass',
                'first round test passed')
        }

        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        t.equal(
            (terms[0] as TicketTerminalEntry)
                .outcome,
            'pass',
            'terminal outcome is pass'
        )
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('per-ticket review - broken fix fails attempt ' +
    'and is not retried with retries 0', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(piRecDir, 'fix-counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'finding',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'break',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(!result.allDone,
            'run reports not all done')

        // progress.md records done:false
        const progress = readProgress(
            join(
                h.projectDir, '.scratch',
                FEAT, 'progress.md'
            )
        )
        t.ok(progress, 'progress exists')
        if (progress) {
            const tp = progress.tickets.find(
                tp => tp.filename === '01-only.md'
            )
            t.ok(tp, 'ticket in progress')
            t.equal(tp?.done, false,
                'progress records done:false')
        }

        // Review log ends with failed entry
        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        t.ok(existsSync(logPath),
            'review log exists')
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        t.equal(
            (terms[0] as TicketTerminalEntry).outcome,
            'failed',
            'terminal outcome is failed'
        )

        t.deepEqual(
            countRoles(h.recordDir),
            { reviewer: 0, fixer: 1, ticket: 1 },
            'one fixer ran, no retry'
        )
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

// ---- US-014: Fix step with the implement role ----

test('per-ticket fix - fixer test failures fail ' +
    'the attempt and ticket retries', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(piRecDir, 'fix-counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'finding,finding',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'break,break,break,break',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 1,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(!result.allDone,
            'run reports not all done')

        const roles = countRoles(h.recordDir)
        t.equal(roles.ticket, 2,
            'two ticket agent invocations (retried)')
        t.equal(roles.fixer, 4,
            'two fix attempts in each ticket attempt')
        const fixPrompts = promptsByRole(h.recordDir).fixer
        t.equal(fixPrompts.filter(p =>
            p.includes(FIX_FAILURE_TEXT.tests)).length, 2,
        'each retried fix sees the previous test failure')

        const ticket = scanTickets(
            join(h.projectDir, '.scratch', FEAT, 'issues'),
            FEAT
        )[0]
        t.notEqual(ticket.status, 'ready-for-human',
            'a failed loop is not unresolved')
        const progress = readProgress(join(
            h.projectDir, '.scratch', FEAT, 'progress.md'
        ))
        t.equal(progress?.tickets.find(
            p => p.filename === '01-only.md'
        )?.done, false, 'progress records done:false')
        t.ok(!git(h.projectDir, [
            'log', 'main', '--name-only', '--format=',
        ]).includes('mock-change-'), 'nothing is merged')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        t.ok(existsSync(logPath),
            'review log exists')
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.deepEqual(
            terms.map(e => (e as TicketTerminalEntry).outcome),
            ['failed', 'failed'],
            'both attempts end failed'
        )
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

test('per-ticket fix - fixer timeout with ' +
    'uncommitted changes auto-commits and next ' +
    'review round runs', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(piRecDir, 'fix-counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'finding,verdict-fixed',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'hang',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                timeout: 2,
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes after timeout + clean review')

        // The auto-committed file is on the branch
        const files = git(
            h.projectDir,
            ['log', '--oneline', '--name-only', '--all']
        )
        t.ok(
            files.includes('pending-fix.ts'),
            'the uncommitted file was auto-committed'
        )

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2,
            'two review rounds recorded')
        if (rounds[0].type === 'round') {
            t.equal(rounds[0].round, 1,
                'first round is 1')
            t.ok(rounds[0].fixHead,
                'first round has fixHead')
        }
        if (rounds[1].type === 'round') {
            t.equal(rounds[1].round, 2,
                'second round is 2')
        }
        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        if (terms[0].type === 'terminal') {
            t.equal(terms[0].outcome, 'pass',
                'terminal outcome is pass')
        }
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

// ---- US-015: Verdicts on open findings ----

test('per-ticket verdict - fixer disputes without ' +
    'commit, reviewer runs and withdraws',
async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(
        piRecDir, 'fix-counter'
    )
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES:
            'finding,verdict-withdraw',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'dispute',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes after withdrawal')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2,
            'two rounds recorded')

        if (rounds[1].type === 'round') {
            const f = rounds[1].findings.find(
                f => f.summary ===
                    'mock finding from pi'
            )
            t.ok(f, 'finding in verdict round')
            t.equal(f?.verdict, 'withdrawn',
                'verdict is withdrawn')
        }

        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 2,
            'reviewer ran twice (finding + verdict)')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('per-ticket verdict - fixer marks [x] but ' +
    'reviewer keeps it open', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(
        piRecDir, 'fix-counter'
    )
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES:
            'finding,verdict-open,verdict-fixed',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'fix-all,fix-all',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 5,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket eventually passes')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )

        t.equal(
            (rounds[0] as TicketRoundEntry).findings[0]
                ?.fixerResponse,
            'fixed', 'the fixer marked the finding [x] in round 1')

        if (rounds[1].type === 'round') {
            const f = rounds[1].findings.find(
                f => f.summary ===
                    'mock finding from pi'
            )
            t.ok(f, 'finding in round 2')
            t.equal(f?.verdict, 'still-open',
                'finding stays open despite fixer [x]')
        }

        t.equal(rounds.length, 3,
            'three rounds total')
        t.equal(countRoles(h.recordDir).fixer, 2,
            'the kept finding goes back to the fixer')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('per-ticket verdict - fixer fixes and ' +
    'reviewer confirms, ticket merges after ' +
    'two rounds', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(
        piRecDir, 'fix-counter'
    )
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES:
            'finding,verdict-fixed',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'fix-all',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket merges')
        const merged = git(h.projectDir, [
            'log', 'main', '--name-only', '--format=',
        ])
        t.ok(merged.includes('mock-change-'),
            'the ticket change is on the base branch')
        t.ok(merged.includes('fix-'),
            'the fix is on the base branch')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2,
            'two rounds in log')

        const r1 = rounds[0] as TicketRoundEntry
        t.equal(r1.findings[0]?.fixerResponse, 'fixed',
            'round 1 records the fixer marked it fixed')
        t.equal(r1.testResult, 'pass',
            'round 1 records the test gate result')
        t.ok(r1.fixHead && r1.fixHead !== r1.head,
            'round 1 records a new head after the fix')
        const r2 = rounds[1] as TicketRoundEntry
        t.equal(r2.head, r1.fixHead,
            'round 2 reviews the post-fix head')

        if (rounds[1].type === 'round') {
            const f = rounds[1].findings.find(
                f => f.summary ===
                    'mock finding from pi'
            )
            t.equal(f?.verdict, 'confirmed-fixed',
                'confirmed-fixed in round 2')
        }

        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        t.equal(
            (terms[0] as TicketTerminalEntry)
                .outcome,
            'pass', 'pass outcome'
        )
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('per-ticket verdict - fixer disputes and ' +
    'reviewer withdraws, ticket merges',
async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(
        piRecDir, 'fix-counter'
    )
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES:
            'finding,verdict-withdraw',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'dispute',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket merges after withdrawal')
        const merged = git(h.projectDir, [
            'log', 'main', '--name-only', '--format=',
        ])
        t.ok(merged.includes('mock-change-'),
            'the ticket change is on the base branch')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const r1 = entries.find(
            e => e.type === 'round'
        ) as TicketRoundEntry
        const f1 = r1.findings[0]
        t.equal(f1?.fixerResponse, 'disputed',
            'round 1 records the dispute')
        t.ok(f1?.fixerReason?.includes('false positive'),
            'the dispute reason comes from the notes file')
        t.equal(r1.testResult, 'pass',
            'round 1 records the test gate result')

        const reviews = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
            .sort()
            .map(f => JSON.parse(readFileSync(
                join(piRecDir, f), 'utf8'
            )) as { prompt:string })
        t.ok(reviews[1]?.prompt.includes('false positive'),
            'the next reviewer sees the dispute reason')

        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        t.equal(
            (terms[0] as TicketTerminalEntry)
                .outcome,
            'pass', 'pass outcome'
        )
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

// ---- US-016: Round limits ----

test('round limits - minRounds 2 forces a second ' +
    'review even when round 1 is clean', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean,clean',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 5,
                    minRounds: 2,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes after two clean rounds')
        const merged = git(h.projectDir, [
            'log', 'main', '--name-only', '--format=',
        ])
        t.ok(merged.includes('mock-change-'),
            'the ticket change is on the base branch')
        t.equal(countRoles(h.recordDir).fixer, 0,
            'no fixer runs between clean rounds')

        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2,
            'two rounds recorded')
        if (rounds[0].type === 'round') {
            t.equal(rounds[0].round, 1,
                'first round is 1')
        }
        if (rounds[1].type === 'round') {
            t.equal(rounds[1].round, 2,
                'second round is 2')
        }

        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        t.equal(
            (terms[0] as TicketTerminalEntry)
                .outcome,
            'pass', 'pass outcome'
        )

        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 2,
            'reviewer ran twice')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('round limits - maxRounds reached with open ' +
    'findings makes ticket unresolved', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    const fixCounterFile = join(
        piRecDir, 'fix-counter'
    )
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        // round 1: finding -> fixer disputes ->
        // round 2: still-open (maxRounds hit)
        FAKE_PI_RESPONSES:
            'finding,verdict-open',
        FAKE_PI_COUNTER: counterFile,
        MOCK_FIX_RESPONSES: 'dispute',
        MOCK_FIX_COUNTER: fixCounterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 2,
                    minRounds: 1,
                },
            }
        )
        t.ok(!result.allDone,
            'run reports not all done')

        // Status is ready-for-human
        const ticket = scanTickets(
            join(
                h.projectDir, '.scratch',
                FEAT, 'issues'
            ),
            FEAT
        )[0]
        t.equal(ticket.status, 'ready-for-human',
            'ticket is ready-for-human')

        // Branch kept
        const branches = execFileSync(
            'git', ['branch', '--list'],
            {
                cwd: h.projectDir,
                encoding: 'utf8',
            }
        ).trim()
        t.ok(
            branches.includes('01-only'),
            'branch is kept'
        )

        // progress.md records done:false
        const progress = readProgress(
            join(
                h.projectDir, '.scratch',
                FEAT, 'progress.md'
            )
        )
        t.ok(progress, 'progress exists')
        if (progress) {
            const tp = progress.tickets.find(
                tp => tp.filename === '01-only.md'
            )
            t.equal(tp?.done, false,
                'progress records done:false')
        }

        // Review log: 2 rounds + unresolved terminal
        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        const entries = parseTicketReviewLog(
            readFileSync(logPath, 'utf8')
        )
        const rounds = entries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2,
            'two rounds recorded')

        const terms = entries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        t.equal(
            (terms[0] as TicketTerminalEntry)
                .outcome,
            'unresolved',
            'terminal outcome is unresolved'
        )

        // Fixer ran once (round 1), not after
        // round 2 (the final review)
        const roles = countRoles(h.recordDir)
        t.equal(roles.fixer, 1,
            'fixer ran once, not after final review')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

// ---- US-018: Resume an interrupted loop ----

test('resume - interrupted after recorded round ' +
    'resumes without running implementation',
async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'verdict-fixed',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const repoName = basename(h.projectDir)
        const branchName =
            `${repoName}--feat-01-only`

        // Simulate a previous run: create the
        // ticket branch with agent + fixer work
        git(h.projectDir,
            ['checkout', '-b', branchName])
        writeFileSync(
            join(h.projectDir, 'agent-work.ts'),
            'export const x = 1'
        )
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir,
            ['commit', '-m', 'agent work'])
        const agentHead = git(h.projectDir,
            ['rev-parse', 'HEAD'])

        writeFileSync(
            join(h.projectDir, 'fix-work.ts'),
            'export const y = 2'
        )
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir,
            ['commit', '-m', 'fixer work'])
        const fixHead = git(h.projectDir,
            ['rev-parse', 'HEAD'])

        // Switch back to main
        git(h.projectDir, ['checkout', 'main'])

        // Write review log with round 1 entry
        // (interrupted before round 2 reviewer)
        const reviewDir = join(
            h.projectDir, '.scratch',
            FEAT, 'reviews'
        )
        mkdirSync(reviewDir, { recursive: true })
        const reviewLogPath = join(
            reviewDir, '01-only.md'
        )
        writeFileSync(reviewLogPath,
            renderTicketRound({
                attempt: 1,
                round: 1,
                implement: 'mock-agent-review',
                review: 'pi',
                head: agentHead,
                findings: [{
                    summary:
                        'mock finding from pi',
                    detail: '',
                    verdict: 'open',
                    fixerResponse: 'fixed',
                }],
                fixHead,
                testResult: 'pass',
            })
        )
        git(h.projectDir,
            ['add', '--force', reviewLogPath])
        git(h.projectDir,
            ['commit', '-m', 'save review log'])

        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes after resumed review')

        // Implementation was skipped
        const roles = countRoles(h.recordDir)
        t.equal(roles.ticket, 0,
            'no ticket agent (implementation skipped)')
        t.equal(roles.fixer, 0,
            'no fixer (reviewer confirmed-fixed)')

        // Reviewer ran once (round 2)
        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 1,
            'reviewer ran once for round 2')

        // Review log has 2 rounds + pass terminal
        const logEntries = parseTicketReviewLog(
            readFileSync(reviewLogPath, 'utf8')
        )
        const rounds = logEntries.filter(
            e => e.type === 'round'
        )
        t.equal(rounds.length, 2,
            'two rounds in log')
        if (rounds[0].type === 'round') {
            t.equal(rounds[0].round, 1,
                'first round is 1 (from prev run)')
        }
        if (rounds[1].type === 'round') {
            t.equal(rounds[1].round, 2,
                'second round is 2 (from resume)')
        }
        const terms = logEntries.filter(
            e => e.type === 'terminal'
        )
        t.equal(terms.length, 1,
            'one terminal entry')
        t.equal(
            (terms[0] as TicketTerminalEntry)
                .outcome,
            'pass', 'pass outcome'
        )
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('resume - branch head mismatch ' +
    'starts fresh', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const repoName = basename(h.projectDir)
        const branchName =
            `${repoName}--feat-01-only`

        // Create branch with agent work
        git(h.projectDir,
            ['checkout', '-b', branchName])
        writeFileSync(
            join(h.projectDir, 'agent-work.ts'),
            'export const x = 1'
        )
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir,
            ['commit', '-m', 'agent work'])
        const agentHead = git(h.projectDir,
            ['rev-parse', 'HEAD'])

        // Add another commit that the log
        // does not know about
        writeFileSync(
            join(h.projectDir, 'extra.ts'),
            'export const z = 3'
        )
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir,
            ['commit', '-m', 'extra work'])

        git(h.projectDir, ['checkout', 'main'])

        // Write review log with head = agentHead
        // (not matching the branch's current HEAD)
        const reviewDir = join(
            h.projectDir, '.scratch',
            FEAT, 'reviews'
        )
        mkdirSync(reviewDir, { recursive: true })
        const reviewLogPath = join(
            reviewDir, '01-only.md'
        )
        writeFileSync(reviewLogPath,
            renderTicketRound({
                attempt: 1,
                round: 1,
                implement: 'mock-agent-review',
                review: 'pi',
                head: agentHead,
                findings: [],
            })
        )
        git(h.projectDir,
            ['add', '--force', reviewLogPath])
        git(h.projectDir,
            ['commit', '-m', 'save review log'])

        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes (fresh start)')

        // Implementation ran again
        const roles = countRoles(h.recordDir)
        t.equal(roles.ticket, 1,
            'ticket agent ran (fresh start)')
        t.ok(!existsSync(join(h.projectDir, 'extra.ts')),
            'the stale branch is not merged')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('resume - log ends in terminal ' +
    'starts fresh', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const repoName = basename(h.projectDir)
        const branchName =
            `${repoName}--feat-01-only`

        // Create branch with agent work
        git(h.projectDir,
            ['checkout', '-b', branchName])
        writeFileSync(
            join(h.projectDir, 'agent-work.ts'),
            'export const x = 1'
        )
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir,
            ['commit', '-m', 'agent work'])
        const agentHead = git(h.projectDir,
            ['rev-parse', 'HEAD'])

        git(h.projectDir, ['checkout', 'main'])

        // Write review log: round + terminal
        const reviewDir = join(
            h.projectDir, '.scratch',
            FEAT, 'reviews'
        )
        mkdirSync(reviewDir, { recursive: true })
        const reviewLogPath = join(
            reviewDir, '01-only.md'
        )
        writeFileSync(reviewLogPath,
            renderTicketRound({
                attempt: 1,
                round: 1,
                implement: 'mock-agent-review',
                review: 'pi',
                head: agentHead,
                findings: [],
            }) +
            renderTicketTerminal({
                attempt: 1,
                outcome: 'failed',
            })
        )
        git(h.projectDir,
            ['add', '--force', reviewLogPath])
        git(h.projectDir,
            ['commit', '-m', 'save review log'])

        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes (fresh start)')

        // Implementation ran again
        const roles = countRoles(h.recordDir)
        t.equal(roles.ticket, 1,
            'ticket agent ran (fresh start)')
        t.ok(!existsSync(join(h.projectDir, 'agent-work.ts')),
            'the stale branch is not merged')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('resume - earlier attempt failed, current ' +
    'attempt round matches, resumes',
async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'verdict-fixed',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const repoName = basename(h.projectDir)
        const branchName =
            `${repoName}--feat-01-only`

        // Create branch with work
        git(h.projectDir,
            ['checkout', '-b', branchName])
        writeFileSync(
            join(h.projectDir, 'agent-work.ts'),
            'export const x = 1'
        )
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir,
            ['commit', '-m', 'agent work'])
        const agentHead = git(h.projectDir,
            ['rev-parse', 'HEAD'])

        writeFileSync(
            join(h.projectDir, 'fix-work.ts'),
            'export const y = 2'
        )
        git(h.projectDir, ['add', '-A'])
        git(h.projectDir,
            ['commit', '-m', 'fixer work'])
        const fixHead = git(h.projectDir,
            ['rev-parse', 'HEAD'])

        git(h.projectDir, ['checkout', 'main'])

        // Write review log: attempt 1 failed,
        // then attempt 2 round 1 (interrupted)
        const reviewDir = join(
            h.projectDir, '.scratch',
            FEAT, 'reviews'
        )
        mkdirSync(reviewDir, { recursive: true })
        const reviewLogPath = join(
            reviewDir, '01-only.md'
        )
        writeFileSync(reviewLogPath,
            renderTicketRound({
                attempt: 1,
                round: 1,
                implement: 'mock-agent-review',
                review: 'pi',
                head: agentHead,
                findings: [],
            }) +
            renderTicketTerminal({
                attempt: 1,
                outcome: 'failed',
            }) +
            renderTicketRound({
                attempt: 2,
                round: 1,
                implement: 'mock-agent-review',
                review: 'pi',
                head: agentHead,
                findings: [{
                    summary:
                        'mock finding from pi',
                    detail: '',
                    verdict: 'open',
                    fixerResponse: 'fixed',
                }],
                fixHead,
                testResult: 'pass',
            })
        )
        git(h.projectDir,
            ['add', '--force', reviewLogPath])
        git(h.projectDir,
            ['commit', '-m', 'save review log'])

        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                retries: 0,
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone,
            'ticket passes after resumed review')

        // Implementation was skipped
        const roles = countRoles(h.recordDir)
        t.equal(roles.ticket, 0,
            'no ticket agent (resumed)')

        // Reviewer ran once (round 2 of attempt 2)
        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 1,
            'reviewer ran once')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

// Leaves the state of a run interrupted after round 1 was
// recorded: the ticket branch with agent and fixer commits, and
// a committed review log whose round 1 entry names the fix head.
function seedInterruptedRound (
    projectDir:string,
    testResult:'pass'|'fail'
):void {
    const branchName =
        `${basename(projectDir)}--feat-01-only`
    git(projectDir, ['checkout', '-b', branchName])
    writeFileSync(join(projectDir, 'agent-work.ts'),
        'export const x = 1')
    git(projectDir, ['add', '-A'])
    git(projectDir, ['commit', '-m', 'agent work'])
    const agentHead = git(projectDir, ['rev-parse', 'HEAD'])
    writeFileSync(join(projectDir, 'fix-work.ts'),
        'export const y = 2')
    git(projectDir, ['add', '-A'])
    git(projectDir, ['commit', '-m', 'fixer work'])
    const fixHead = git(projectDir, ['rev-parse', 'HEAD'])
    git(projectDir, ['checkout', 'main'])

    const reviewDir = join(projectDir, '.scratch', FEAT, 'reviews')
    mkdirSync(reviewDir, { recursive: true })
    const reviewLogPath = join(reviewDir, '01-only.md')
    writeFileSync(reviewLogPath, renderTicketRound({
        attempt: 1,
        round: 1,
        implement: 'mock-agent-review',
        review: 'pi',
        head: agentHead,
        findings: [{
            summary: 'mock finding from pi',
            detail: '',
            verdict: 'open',
            fixerResponse: 'fixed',
        }],
        fixHead,
        testResult,
    }))
    git(projectDir, ['add', '--force', reviewLogPath])
    git(projectDir, ['commit', '-m', 'save review log'])
}

const RESUME_ADVERSARIAL = {
    implementStr: 'mock-agent-review',
    reviewStr: 'pi',
    review: { provider: FAKE_PI },
    maxRounds: 3,
    minRounds: 1,
}

test('resume - a resumed loop runs the install command in ' +
    'the recreated worktree', async t => {
    const piRecDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    const installLog = join(piRecDir, 'install-cwd')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'verdict-fixed',
        FAKE_PI_COUNTER: join(piRecDir, 'counter'),
    }, async h => {
        seedInterruptedRound(h.projectDir, 'pass')
        const result = await h.run(false, quietDisplay(), undefined, {
            retries: 0,
            installCmd: `pwd >> ${installLog}`,
            adversarial: RESUME_ADVERSARIAL,
        })
        t.ok(result.allDone, 'ticket passes after resumed review')
        t.equal(countRoles(h.recordDir).ticket, 0,
            'implementation was skipped (resumed)')
        t.ok(existsSync(installLog),
            'the install command ran before the resumed loop')
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

test('resume - a last round with a failing test gate starts ' +
    'fresh', async t => {
    const piRecDir = mkdtempSync(join(tmpdir(), 'redeye-pirec-'))
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean',
        FAKE_PI_COUNTER: join(piRecDir, 'counter'),
    }, async h => {
        seedInterruptedRound(h.projectDir, 'fail')
        const result = await h.run(false, quietDisplay(), undefined, {
            retries: 0,
            adversarial: RESUME_ADVERSARIAL,
        })
        t.ok(result.allDone, 'ticket passes after a fresh start')
        t.equal(countRoles(h.recordDir).ticket, 1,
            'implementation ran again instead of resuming')
        t.ok(!existsSync(join(h.projectDir, 'fix-work.ts')),
            'the branch with failing tests is not merged')
    })
    rmSync(piRecDir, { recursive: true, force: true })
})

// ---- End-of-run pass uses both configured roles (US-020) ----

test('US-020 end-of-run pass uses review role as reviewer ' +
    'and implement role as fixer', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        MOCK_FIX: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        // 1st pi call = per-ticket reviewer (clean)
        // 2nd pi call = end-of-run reviewer (finding)
        FAKE_PI_RESPONSES: 'clean,finding',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const result = await h.run(
            true, quietDisplay(), undefined,
            {
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone, 'tickets done')

        // Pi was invoked twice: per-ticket + end-of-run
        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 2,
            'pi ran twice (per-ticket + end-of-run)')

        // MOCK handled ticket + end-of-run fixer
        const roles = countRoles(h.recordDir)
        t.equal(roles.ticket, 1, 'one ticket agent')
        t.equal(roles.fixer, 1, 'one end-of-run fixer')
        t.equal(roles.reviewer, 0,
            'no MOCK reviewer (pi was used)')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})

test('US-020 without adversarial, end-of-run reviewer ' +
    'and fixer use the run provider', async t => {
    await withHarness({
        MOCK_REVIEW: 'findings',
        MOCK_FIX: 'pass',
        MOCK_TICKET: 'pass',
    }, async h => {
        const result = await h.run()
        t.ok(result.allDone, 'tickets done')
        const roles = countRoles(h.recordDir)
        t.equal(roles.reviewer, 1,
            'MOCK reviewer (run provider)')
        t.equal(roles.fixer, 1,
            'MOCK fixer (run provider)')
        t.equal(roles.ticket, 1, 'one ticket agent')
    })
})

test('US-020 --no-review with adversarial skips ' +
    'end-of-run pass but per-ticket loop runs', async t => {
    const piRecDir = mkdtempSync(
        join(tmpdir(), 'redeye-pirec-')
    )
    const counterFile = join(piRecDir, 'counter')
    await withHarness({
        MOCK_TICKET: 'pass',
        FAKE_PI_RECORD_DIR: piRecDir,
        FAKE_PI_RESPONSES: 'clean',
        FAKE_PI_COUNTER: counterFile,
    }, async h => {
        const result = await h.run(
            false, quietDisplay(), undefined,
            {
                adversarial: {
                    implementStr:
                        'mock-agent-review',
                    reviewStr: 'pi',
                    review: { provider: FAKE_PI },
                    maxRounds: 3,
                    minRounds: 1,
                },
            }
        )
        t.ok(result.allDone, 'ticket done')

        // Pi ran once: per-ticket reviewer only
        const piFiles = readdirSync(piRecDir)
            .filter(f => f.endsWith('.json'))
        t.equal(piFiles.length, 1,
            'pi ran once (per-ticket only)')

        // No end-of-run review log
        t.ok(!existsSync(h.reviewPath),
            'no end-of-run review log')

        // Per-ticket review log exists
        const logPath = join(
            h.projectDir,
            ticketReviewPath(FEAT, '01-only.md')
        )
        t.ok(existsSync(logPath),
            'per-ticket review log exists')
    })
    rmSync(piRecDir, {
        recursive: true, force: true,
    })
})
