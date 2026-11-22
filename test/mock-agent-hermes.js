#!/usr/bin/env node
// Fake Hermes agent for tests. The shell wrapper
// test/fake-hermes/hermes runs this, so spawnAgent's basename
// check sees "hermes". Env vars drive behavior:
//
//   FAKE_HERMES_ARGV_LOG   -- append argv as JSON array per run
//   FAKE_HERMES_CWD_LOG    -- append cwd per run
//   FAKE_HERMES_STDIN_LOG  -- write complete stdin to this path
//   FAKE_HERMES_EXIT       -- exit code (default 0)
//   FAKE_HERMES_NO_WORK    -- "1" to exit without committing
//   FAKE_HERMES_WAIT_FILE  -- path: block until this file exists,
//                             then do the controlled turn
//   FAKE_HERMES_READY_FILE -- path: created after stdin EOF,
//                             before waiting on WAIT_FILE
//   FAKE_HERMES_OUTPUT     -- text written to stdout before exit
//   FAKE_HERMES_STDERR     -- text written to stderr before exit
import { execSync } from 'node:child_process'
import {
    appendFileSync,
    existsSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const REQUIRED_PREFIX = [
    '--yolo', 'chat', '--query-file', '-', '--quiet',
]

function validateArgs (argv) {
    const args = argv.slice(2)
    for (let i = 0; i < REQUIRED_PREFIX.length; i++) {
        if (args[i] !== REQUIRED_PREFIX[i]) {
            process.stderr.write(
                `fake-hermes: missing or wrong flag ` +
                `at position ${i}: expected ` +
                `"${REQUIRED_PREFIX[i]}" got ` +
                `"${args[i] ?? '(none)'}"\n`
            )
            process.exit(2)
        }
    }
}

const GIT_ENV = {
    ...process.env,
    GIT_COMMITTER_NAME: 'Fake Hermes',
    GIT_COMMITTER_EMAIL: 'hermes@example.com',
    GIT_AUTHOR_NAME: 'Fake Hermes',
    GIT_AUTHOR_EMAIL: 'hermes@example.com',
}

function commitChange () {
    const filename = `hermes-change-${randomUUID()}.txt`
    writeFileSync(
        join(process.cwd(), filename),
        String(Date.now())
    )
    execSync(`git add ${filename}`, {
        stdio: 'ignore', env: GIT_ENV,
    })
    execSync(
        'git commit -m "hermes agent change" --no-verify',
        { stdio: 'pipe', env: GIT_ENV }
    )
}

function waitForFile (path, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs
        const check = () => {
            if (existsSync(path)) {
                resolve()
                return
            }
            if (Date.now() >= deadline) {
                reject(new Error(
                    `fake-hermes: timed out waiting ` +
                    `for ${path}`
                ))
                return
            }
            setTimeout(check, 50)
        }
        check()
    })
}

validateArgs(process.argv)

const chunks = []
process.stdin.on('data', chunk => chunks.push(chunk))
process.stdin.on('end', async () => {
    const stdin = Buffer.concat(chunks).toString('utf8')

    const argvLog = process.env.FAKE_HERMES_ARGV_LOG
    if (argvLog) {
        appendFileSync(
            argvLog,
            JSON.stringify(process.argv.slice(2)) + '\n'
        )
    }

    const cwdLog = process.env.FAKE_HERMES_CWD_LOG
    if (cwdLog) {
        appendFileSync(cwdLog, process.cwd() + '\n')
    }

    const stdinLog = process.env.FAKE_HERMES_STDIN_LOG
    if (stdinLog) {
        writeFileSync(stdinLog, stdin)
    }

    const readyFile = process.env.FAKE_HERMES_READY_FILE
    if (readyFile) {
        writeFileSync(readyFile, '')
    }

    const waitFile = process.env.FAKE_HERMES_WAIT_FILE
    if (waitFile) {
        try {
            await waitForFile(waitFile)
        } catch (err) {
            process.stderr.write(err.message + '\n')
            process.exit(2)
        }
    }

    const exitCode = parseInt(
        process.env.FAKE_HERMES_EXIT || '0', 10
    )
    const noWork = process.env.FAKE_HERMES_NO_WORK === '1'

    if (exitCode === 0 && !noWork) {
        try {
            commitChange()
        } catch (err) {
            process.stderr.write(
                `fake-hermes: commit failed: ${err}\n`
            )
            process.exit(2)
        }
    }

    const output = process.env.FAKE_HERMES_OUTPUT
    if (output) process.stdout.write(output)

    const stderrOut = process.env.FAKE_HERMES_STDERR
    if (stderrOut) process.stderr.write(stderrOut)

    process.exit(exitCode)
})
