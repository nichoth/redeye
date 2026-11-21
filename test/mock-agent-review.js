#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Plays every role in a run, picked from the prompt:
//   reviewer  (prompt has the review marker)  per MOCK_REVIEW:
//             findings | clean | none
//   fixer     (prompt has the findings marker) per MOCK_FIX:
//             pass | break
//          or per MOCK_FIX_RESPONSES + MOCK_FIX_COUNTER:
//             pass | break | hang | dispute | fix-all
//             (fix-all commits a fix and prints [x] for every
//             finding listed in its prompt)
//   ticket    otherwise, per MOCK_TICKET: pass | fail
// Each run writes { time, role, cwd, prompt } into MOCK_RECORD_DIR.

const GIT_ENV = {
    ...process.env,
    GIT_COMMITTER_NAME:'Mock Agent',
    GIT_COMMITTER_EMAIL:'mock@example.com',
    GIT_AUTHOR_NAME:'Mock Agent',
    GIT_AUTHOR_EMAIL:'mock@example.com',
}

function commitFile (name) {
    writeFileSync(join(process.cwd(), name), String(Date.now()))
    execSync(`git add ${name}`, { stdio:'ignore', env:GIT_ENV })
    execSync('git commit -m "mock change" --no-verify',
        { stdio:'ignore', env:GIT_ENV })
}

function writeFindings (text) {
    mkdirSync(join(process.cwd(), '.redeye'), { recursive:true })
    writeFileSync(
        join(process.cwd(), '.redeye', 'findings.md'), text
    )
}

function writeNotes (text) {
    mkdirSync(join(process.cwd(), '.redeye'), { recursive:true })
    writeFileSync(
        join(process.cwd(), '.redeye', 'notes.md'), text
    )
}

function getFixMode () {
    const responses = process.env.MOCK_FIX_RESPONSES
    const counterFile = process.env.MOCK_FIX_COUNTER
    if (responses && counterFile) {
        const list = responses.split(',')
        let idx = 0
        try {
            idx = parseInt(readFileSync(counterFile, 'utf8'), 10)
        } catch {
            // first invocation
        }
        writeFileSync(counterFile, String(idx + 1))
        return list[idx] || 'pass'
    }
    return process.env.MOCK_FIX || 'pass'
}

function run (prompt) {
    const role = prompt.includes('---- REVIEW INSTRUCTIONS ----') ?
        'reviewer' :
        prompt.includes('---- REVIEW FINDINGS ----') ?
            'fixer' :
            'ticket'
    writeFileSync(
        join(process.env.MOCK_RECORD_DIR,
            `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify({
            time:Date.now(), role, cwd:process.cwd(), prompt,
        })
    )

    if (role === 'reviewer') {
        const mode = process.env.MOCK_REVIEW
        if (mode === 'findings') {
            writeFindings(
                '- [ ] mock finding one\n' +
                '    src/x.ts:1 breaks\n' +
                '- [ ] mock finding two\n'
            )
        } else if (mode === 'clean') {
            writeFindings('No findings.\n')
        }
        process.exit(0)
    }
    if (role === 'fixer') {
        const fixMode = getFixMode()
        if (fixMode === 'hang') {
            writeFileSync(
                join(process.cwd(), 'pending-fix.ts'),
                String(Date.now())
            )
            setInterval(() => {}, 60000)
            return
        }
        if (fixMode === 'dispute') {
            writeNotes('Disputed: the finding is a false positive')
            process.exit(0)
        }
        if (fixMode === 'fix-all') {
            commitFile(`fix-${randomUUID()}.ts`)
            const findings = prompt
                .split('---- REVIEW FINDINGS ----')[1] ?? ''
            for (const line of findings.split('\n')) {
                const m = line.match(/^- \[ \] (.+)$/)
                if (m) process.stdout.write(`[x] ${m[1]}\n`)
            }
            process.exit(0)
        }
        if (fixMode === 'break') {
            commitFile('broken.txt')
        } else {
            commitFile(`fix-${randomUUID()}.ts`)
            process.stdout.write('[x] mock finding one\n')
        }
        process.exit(0)
    }
    if (process.env.MOCK_TICKET === 'fail') process.exit(1)
    commitFile(`mock-change-${randomUUID()}.ts`)
    process.exit(0)
}

const chunks = []
process.stdin.on('data', chunk => chunks.push(chunk))
process.stdin.on('end', () => {
    run(Buffer.concat(chunks).toString('utf8'))
})
