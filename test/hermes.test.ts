import { test } from './shard.js'
import {
    mkdtempSync, writeFileSync,
    readFileSync, existsSync, rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, execSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'

const FAKE_HERMES = join(
    process.cwd(), 'test', 'fake-hermes', 'hermes'
)

const FAKE_HERMES_KEYS = [
    'FAKE_HERMES_ARGV_LOG',
    'FAKE_HERMES_CWD_LOG',
    'FAKE_HERMES_STDIN_LOG',
    'FAKE_HERMES_EXIT',
    'FAKE_HERMES_NO_WORK',
    'FAKE_HERMES_WAIT_FILE',
    'FAKE_HERMES_READY_FILE',
    'FAKE_HERMES_OUTPUT',
    'FAKE_HERMES_STDERR',
]

function tmp ():string {
    return mkdtempSync(join(tmpdir(), 'redeye-hermes-test-'))
}

const GIT_ENV = {
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
}

function cleanEnv (
    extra:Record<string, string> = {}
):NodeJS.ProcessEnv {
    const env = { ...process.env }
    for (const key of FAKE_HERMES_KEYS) delete env[key]
    return { ...env, ...GIT_ENV, ...extra }
}

function initRepo ():string {
    const dir = tmp()
    execFileSync('git', ['init', '--template='], {
        cwd: dir, stdio: 'ignore',
    })
    execSync('git config user.email test@example.com', {
        cwd: dir,
    })
    execSync('git config user.name "Test User"', {
        cwd: dir,
    })
    execSync('git config core.hooksPath /dev/null', {
        cwd: dir,
    })
    execSync(
        'git commit --allow-empty -m "init" --no-verify',
        { cwd: dir, env: { ...process.env, ...GIT_ENV } }
    )
    return dir
}

function runFake (opts:{
    args?:string[]
    cwd?:string
    env?:NodeJS.ProcessEnv
    stdin?:string
    timeoutMs?:number
}):Promise<{
    code:number
    stdout:string
    stderr:string
}> {
    const args = opts.args ?? [
        '--yolo', 'chat', '--query-file', '-', '--quiet',
    ]
    return new Promise((resolve, reject) => {
        const child = spawn(FAKE_HERMES, args, {
            cwd: opts.cwd,
            env: opts.env ?? cleanEnv(),
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        const stdoutChunks:Buffer[] = []
        const stderrChunks:Buffer[] = []
        child.stdout.on('data', c => stdoutChunks.push(c))
        child.stderr.on('data', c => stderrChunks.push(c))

        const timeout = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error('fake hermes timed out'))
        }, opts.timeoutMs ?? 10_000)

        child.on('close', code => {
            clearTimeout(timeout)
            resolve({
                code: code ?? 1,
                stdout: Buffer.concat(
                    stdoutChunks
                ).toString(),
                stderr: Buffer.concat(
                    stderrChunks
                ).toString(),
            })
        })
        if (opts.stdin !== undefined) {
            child.stdin.write(opts.stdin)
        }
        child.stdin.end()
    })
}

// ---- Recording argv, cwd, stdin ----

test('fake hermes records argv to log file', async t => {
    const dir = tmp()
    try {
        const repo = initRepo()
        const argvLog = join(dir, 'argv.log')
        const result = await runFake({
            cwd: repo,
            env: cleanEnv({
                FAKE_HERMES_ARGV_LOG: argvLog,
            }),
            stdin: 'hello',
        })
        t.equal(result.code, 0, 'exits 0')
        const lines = readFileSync(argvLog, 'utf8')
            .trim().split('\n')
        t.equal(lines.length, 1, 'one argv entry')
        const argv = JSON.parse(lines[0])
        t.deepEqual(
            argv.slice(0, 5),
            [
                '--yolo', 'chat',
                '--query-file', '-', '--quiet',
            ],
            'records the hermes flags'
        )
        rmSync(repo, { recursive: true, force: true })
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('fake hermes records cwd to log file', async t => {
    const dir = tmp()
    try {
        const repo = initRepo()
        const cwdLog = join(dir, 'cwd.log')
        const result = await runFake({
            cwd: repo,
            env: cleanEnv({
                FAKE_HERMES_CWD_LOG: cwdLog,
            }),
            stdin: 'hello',
        })
        t.equal(result.code, 0, 'exits 0')
        const logged = readFileSync(cwdLog, 'utf8').trim()
        t.equal(
            realpathSync(logged),
            realpathSync(repo),
            'records the working directory'
        )
        rmSync(repo, { recursive: true, force: true })
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('fake hermes records stdin to log file', async t => {
    const dir = tmp()
    try {
        const repo = initRepo()
        const stdinLog = join(dir, 'stdin.log')
        const prompt = 'Build the feature\nLine two'
        const result = await runFake({
            cwd: repo,
            env: cleanEnv({
                FAKE_HERMES_STDIN_LOG: stdinLog,
            }),
            stdin: prompt,
        })
        t.equal(result.code, 0, 'exits 0')
        const captured = readFileSync(stdinLog, 'utf8')
        t.equal(
            captured, prompt,
            'captures complete stdin'
        )
        rmSync(repo, { recursive: true, force: true })
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('fake hermes records all three outside worktree',
    async t => {
        const dataDir = tmp()
        try {
            const repo = initRepo()
            const argvLog = join(dataDir, 'argv.log')
            const cwdLog = join(dataDir, 'cwd.log')
            const stdinLog = join(dataDir, 'stdin.log')
            const result = await runFake({
                cwd: repo,
                env: cleanEnv({
                    FAKE_HERMES_ARGV_LOG: argvLog,
                    FAKE_HERMES_CWD_LOG: cwdLog,
                    FAKE_HERMES_STDIN_LOG: stdinLog,
                }),
                stdin: 'combined test',
            })
            t.equal(result.code, 0, 'exits 0')
            t.ok(existsSync(argvLog), 'argv log exists')
            t.ok(existsSync(cwdLog), 'cwd log exists')
            t.ok(existsSync(stdinLog), 'stdin log exists')
            // logs are outside the repo (the worktree)
            t.ok(
                !argvLog.startsWith(repo),
                'argv log is outside repo'
            )
            rmSync(repo, { recursive: true, force: true })
        } finally {
            rmSync(dataDir, {
                recursive: true, force: true,
            })
        }
    })

// ---- Flag validation ----

test('fake hermes rejects missing --yolo', async t => {
    const result = await runFake({
        args: ['chat', '--query-file', '-', '--quiet'],
        stdin: '',
    })
    t.equal(result.code, 2, 'exits 2 on missing --yolo')
    t.ok(
        result.stderr.includes('missing or wrong flag'),
        'error message mentions missing flag'
    )
})

test('fake hermes rejects missing --query-file', async t => {
    const result = await runFake({
        args: ['--yolo', 'chat', '--quiet'],
        stdin: '',
    })
    t.equal(
        result.code, 2,
        'exits 2 on missing --query-file'
    )
})

test('fake hermes rejects missing --quiet', async t => {
    const result = await runFake({
        args: [
            '--yolo', 'chat', '--query-file', '-',
        ],
        stdin: '',
    })
    t.equal(result.code, 2, 'exits 2 on missing --quiet')
})

test('fake hermes rejects misplaced --yolo ' +
    '(after chat)', async t => {
    const result = await runFake({
        args: [
            'chat', '--yolo', '--query-file', '-',
            '--quiet',
        ],
        stdin: '',
    })
    t.equal(
        result.code, 2,
        'exits 2 when --yolo follows chat'
    )
    t.ok(
        result.stderr.includes('missing or wrong flag'),
        'error mentions wrong flag position'
    )
})

// ---- Success mode: creates and commits ----

test('fake hermes success mode commits a change',
    async t => {
        const repo = initRepo()
        try {
            const before = execSync(
                'git rev-list --count HEAD',
                { cwd: repo }
            ).toString().trim()
            const result = await runFake({
                cwd: repo,
                stdin: 'do the work',
            })
            t.equal(result.code, 0, 'exits 0')
            const after = execSync(
                'git rev-list --count HEAD',
                { cwd: repo }
            ).toString().trim()
            t.ok(
                parseInt(after) > parseInt(before),
                'commit count increased'
            )
            const log = execSync(
                'git log -1 --format=%s',
                { cwd: repo }
            ).toString().trim()
            t.equal(
                log, 'hermes agent change',
                'commit message matches'
            )
        } finally {
            rmSync(repo, { recursive: true, force: true })
        }
    })

// ---- Nonzero exit mode ----

test('fake hermes nonzero exit', async t => {
    const repo = initRepo()
    try {
        const before = execSync(
            'git rev-list --count HEAD',
            { cwd: repo }
        ).toString().trim()
        const result = await runFake({
            cwd: repo,
            env: cleanEnv({ FAKE_HERMES_EXIT: '1' }),
            stdin: 'do the work',
        })
        t.equal(result.code, 1, 'exits with given code')
        const after = execSync(
            'git rev-list --count HEAD',
            { cwd: repo }
        ).toString().trim()
        t.equal(
            after, before,
            'no new commits on nonzero exit'
        )
    } finally {
        rmSync(repo, { recursive: true, force: true })
    }
})

// ---- No-work mode ----

test('fake hermes no-work mode exits 0 without committing',
    async t => {
        const repo = initRepo()
        try {
            const before = execSync(
                'git rev-list --count HEAD',
                { cwd: repo }
            ).toString().trim()
            const result = await runFake({
                cwd: repo,
                env: cleanEnv({
                    FAKE_HERMES_NO_WORK: '1',
                }),
                stdin: 'do the work',
            })
            t.equal(result.code, 0, 'exits 0')
            const after = execSync(
                'git rev-list --count HEAD',
                { cwd: repo }
            ).toString().trim()
            t.equal(
                after, before,
                'no commits in no-work mode'
            )
        } finally {
            rmSync(repo, { recursive: true, force: true })
        }
    })

// ---- Coordinated-wait mode ----

test('fake hermes coordinated-wait mode', async t => {
    const dir = tmp()
    const repo = initRepo()
    try {
        const waitFile = join(dir, 'go')
        const readyFile = join(dir, 'ready')
        const stdinLog = join(dir, 'stdin.log')

        const done = runFake({
            cwd: repo,
            env: cleanEnv({
                FAKE_HERMES_WAIT_FILE: waitFile,
                FAKE_HERMES_READY_FILE: readyFile,
                FAKE_HERMES_STDIN_LOG: stdinLog,
            }),
            stdin: 'coordinated prompt',
            timeoutMs: 15_000,
        })

        // Wait for the ready file (proves stdin was read)
        const deadline = Date.now() + 10_000
        while (!existsSync(readyFile)) {
            if (Date.now() > deadline) {
                t.fail('ready file never appeared')
                return
            }
            await new Promise(r => setTimeout(r, 50))
        }

        t.ok(
            existsSync(stdinLog),
            'stdin captured before wait'
        )
        t.equal(
            readFileSync(stdinLog, 'utf8'),
            'coordinated prompt',
            'stdin content correct before release'
        )

        // The process should still be running
        // Release it
        writeFileSync(waitFile, '')

        const result = await done
        t.equal(result.code, 0, 'exits 0 after release')

        const after = execSync(
            'git log -1 --format=%s',
            { cwd: repo }
        ).toString().trim()
        t.equal(
            after, 'hermes agent change',
            'committed after release'
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(repo, { recursive: true, force: true })
    }
})

// ---- Reads stdin to EOF before work ----

test('fake hermes reads stdin to EOF before committing',
    async t => {
        const dir = tmp()
        const repo = initRepo()
        try {
            const readyFile = join(dir, 'ready')
            const waitFile = join(dir, 'go')

            const done = runFake({
                cwd: repo,
                env: cleanEnv({
                    FAKE_HERMES_READY_FILE: readyFile,
                    FAKE_HERMES_WAIT_FILE: waitFile,
                }),
                stdin: 'full prompt content',
                timeoutMs: 15_000,
            })

            // ready file proves EOF was reached
            const deadline = Date.now() + 10_000
            while (!existsSync(readyFile)) {
                if (Date.now() > deadline) {
                    t.fail('ready file never created')
                    return
                }
                await new Promise(r => setTimeout(r, 50))
            }
            t.ok(true, 'ready file created after stdin EOF')

            // Before release, no commit should exist
            const before = execSync(
                'git rev-list --count HEAD',
                { cwd: repo }
            ).toString().trim()
            t.equal(before, '1', 'no commit yet while waiting')

            writeFileSync(waitFile, '')
            const result = await done
            t.equal(result.code, 0, 'exits 0')
        } finally {
            rmSync(dir, { recursive: true, force: true })
            rmSync(repo, { recursive: true, force: true })
        }
    })

// ---- Output markers ----

test('fake hermes emits stdout and stderr markers',
    async t => {
        const repo = initRepo()
        try {
            const result = await runFake({
                cwd: repo,
                env: cleanEnv({
                    FAKE_HERMES_OUTPUT: 'STDOUT_MARKER\n',
                    FAKE_HERMES_STDERR: 'STDERR_MARKER\n',
                }),
                stdin: 'work',
            })
            t.equal(result.code, 0, 'exits 0')
            t.ok(
                result.stdout.includes('STDOUT_MARKER'),
                'stdout marker present'
            )
            t.ok(
                result.stderr.includes('STDERR_MARKER'),
                'stderr marker present'
            )
        } finally {
            rmSync(repo, { recursive: true, force: true })
        }
    })

// ---- Hermetic Git: local user.name/email ----

test('fake hermes uses local git identity', async t => {
    const repo = initRepo()
    try {
        await runFake({ cwd: repo, stdin: 'work' })
        const author = execSync(
            'git log -1 --format=%an',
            { cwd: repo }
        ).toString().trim()
        t.equal(
            author, 'Fake Hermes',
            'commit uses the fake identity'
        )
    } finally {
        rmSync(repo, { recursive: true, force: true })
    }
})

// ---- Isolation: no FAKE_ env leaks between runs ----

test('fake hermes env isolation', async t => {
    const dir = tmp()
    const repo = initRepo()
    try {
        // Run with logging, then run without -- the second
        // run should not create any log files in `dir`.
        const argvLog = join(dir, 'argv.log')
        await runFake({
            cwd: repo,
            env: cleanEnv({
                FAKE_HERMES_ARGV_LOG: argvLog,
            }),
            stdin: 'first run',
        })
        t.ok(existsSync(argvLog), 'first run created log')

        // Reset the repo for the second run
        const repo2 = initRepo()
        const argvLog2 = join(dir, 'argv2.log')
        await runFake({
            cwd: repo2,
            env: cleanEnv(),
            stdin: 'second run',
        })
        t.ok(
            !existsSync(argvLog2),
            'second run did not create log without env'
        )
        rmSync(repo2, { recursive: true, force: true })
    } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(repo, { recursive: true, force: true })
    }
})

// ---- Sharding independence ----

test('fake hermes tests are independent under sharding',
    async t => {
        // Each test creates its own repo and data dir,
        // so there is no shared state. This test verifies
        // that by running two isolated operations.
        const repo1 = initRepo()
        const repo2 = initRepo()
        try {
            const [r1, r2] = await Promise.all([
                runFake({ cwd: repo1, stdin: 'a' }),
                runFake({ cwd: repo2, stdin: 'b' }),
            ])
            t.equal(r1.code, 0, 'first parallel run ok')
            t.equal(r2.code, 0, 'second parallel run ok')

            const c1 = execSync(
                'git rev-list --count HEAD',
                { cwd: repo1 }
            ).toString().trim()
            const c2 = execSync(
                'git rev-list --count HEAD',
                { cwd: repo2 }
            ).toString().trim()
            t.equal(c1, '2', 'repo1 has one new commit')
            t.equal(c2, '2', 'repo2 has one new commit')
        } finally {
            rmSync(repo1, {
                recursive: true, force: true,
            })
            rmSync(repo2, {
                recursive: true, force: true,
            })
        }
    })
