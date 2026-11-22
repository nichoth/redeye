#!/usr/bin/env node
// Mock agent for continue-branch tests.
// First run: creates progress.txt and commits.
// Second run (progress.txt exists): appends 'seen' to
// progress.txt and creates pass.txt, then commits.
import { execSync } from 'node:child_process'
import {
    existsSync, readFileSync, writeFileSync,
    appendFileSync,
} from 'node:fs'
import { join } from 'node:path'

const GIT_ENV = {
    ...process.env,
    GIT_COMMITTER_NAME:'Mock Agent',
    GIT_COMMITTER_EMAIL:'mock@example.com',
    GIT_AUTHOR_NAME:'Mock Agent',
    GIT_AUTHOR_EMAIL:'mock@example.com',
}

const cwd = process.cwd()
const progressPath = join(cwd, 'progress.txt')

if (existsSync(progressPath)) {
    appendFileSync(progressPath, 'seen')
    writeFileSync(join(cwd, 'pass.txt'), 'ok')
} else {
    writeFileSync(progressPath, 'attempt1\n')
}

process.stdin.resume()
process.stdin.on('end', () => {
    execSync('git add -A', { cwd, env: GIT_ENV })
    execSync(
        'git commit -m "mock-agent-continue" --no-verify',
        { cwd, env: GIT_ENV, stdio: 'pipe' }
    )
    process.exit(0)
})
