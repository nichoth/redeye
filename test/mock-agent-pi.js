#!/usr/bin/env node
// A stand-in for the pi CLI. Tests run it through
// test/fake-pi/pi, whose basename makes spawnAgent take
// the pi branch. With FAKE_PI_DELEGATE set to a mock
// script path, it runs that mock with the prompt piped
// via stdin. With FAKE_PI_RESPONSES and FAKE_PI_COUNTER,
// it scripts ordered responses per invocation:
//   finding     -- writes an open finding to .redeye/findings.md
//   clean       -- writes "No findings." to .redeye/findings.md
//   unparseable -- writes garbage to .redeye/findings.md
//   exit1       -- exits with code 1
// FAKE_PI_RECORD_DIR: writes { provider, model, prompt, cwd }
// as one JSON file per invocation.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
    mkdirSync, readFileSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)

let promptFile = null
let model = null
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('@')) {
        promptFile = args[i].slice(1)
    }
    if (args[i] === '--model' && i + 1 < args.length) {
        model = args[i + 1]
    }
}

const prompt = promptFile ?
    readFileSync(promptFile, 'utf8') :
    ''

const recordDir = process.env.FAKE_PI_RECORD_DIR
if (recordDir) {
    writeFileSync(
        join(
            recordDir,
            `${Date.now()}-${randomUUID()}.json`
        ),
        JSON.stringify({
            provider: 'pi',
            model,
            prompt,
            cwd: process.cwd(),
        })
    )
}

const responses = process.env.FAKE_PI_RESPONSES
const counterFile = process.env.FAKE_PI_COUNTER
if (responses && counterFile) {
    const list = responses.split(',')
    let idx = 0
    try {
        idx = parseInt(readFileSync(counterFile, 'utf8'), 10)
    } catch {
        // first invocation
    }
    writeFileSync(counterFile, String(idx + 1))

    const response = list[idx] || 'clean'
    if (response === 'exit1') {
        process.exitCode = 1
    } else if (response === 'finding') {
        mkdirSync(
            join(process.cwd(), '.redeye'),
            { recursive: true }
        )
        writeFileSync(
            join(process.cwd(), '.redeye', 'findings.md'),
            '- [ ] mock finding from pi\n' +
            '    src/x.ts:1 breaks\n'
        )
    } else if (response === 'clean') {
        mkdirSync(
            join(process.cwd(), '.redeye'),
            { recursive: true }
        )
        writeFileSync(
            join(process.cwd(), '.redeye', 'findings.md'),
            'No findings.\n'
        )
    } else if (response === 'unparseable') {
        mkdirSync(
            join(process.cwd(), '.redeye'),
            { recursive: true }
        )
        writeFileSync(
            join(process.cwd(), '.redeye', 'findings.md'),
            'this is not valid findings format\n'
        )
    } else if (response === 'verdict-fixed') {
        mkdirSync(
            join(process.cwd(), '.redeye'),
            { recursive: true }
        )
        writeFileSync(
            join(process.cwd(), '.redeye', 'findings.md'),
            '- [confirmed-fixed] mock finding from pi\n'
        )
    } else if (response === 'verdict-withdraw') {
        mkdirSync(
            join(process.cwd(), '.redeye'),
            { recursive: true }
        )
        writeFileSync(
            join(process.cwd(), '.redeye', 'findings.md'),
            '- [withdrawn] mock finding from pi\n'
        )
    } else if (response === 'verdict-open') {
        mkdirSync(
            join(process.cwd(), '.redeye'),
            { recursive: true }
        )
        writeFileSync(
            join(process.cwd(), '.redeye', 'findings.md'),
            '- [still-open] mock finding from pi\n'
        )
    }
} else {
    const delegate = process.env.FAKE_PI_DELEGATE
    if (delegate) {
        const r = spawnSync(
            process.execPath,
            [delegate, ...args],
            {
                input: prompt,
                stdio: ['pipe', 'inherit', 'inherit'],
                cwd: process.cwd(),
            }
        )
        process.exitCode = r.status ?? 1
    }
}
