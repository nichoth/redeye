#!/usr/bin/env node
// A mock agent whose tickets all write the same file, so two
// tickets in one wave conflict at merge time. Given the merge
// prompt, it resolves the conflict left in its worktree and
// commits the merge.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const GIT_ENV = {
    ...process.env,
    GIT_COMMITTER_NAME: 'Mock Agent',
    GIT_COMMITTER_EMAIL: 'mock@example.com',
    GIT_AUTHOR_NAME: 'Mock Agent',
    GIT_AUTHOR_EMAIL: 'mock@example.com',
}

const chunks = []
process.stdin.on('data', chunk => chunks.push(chunk))
process.stdin.on('end', () => {
    const prompt = Buffer.concat(chunks).toString('utf8')
    const resolving = prompt.includes('resolving a merge conflict')
    writeFileSync('shared.txt', resolving ?
        'resolved\n' :
        `${randomUUID()}\n`)
    execSync('git add -A', { stdio: 'ignore', env: GIT_ENV })
    execSync(
        'git commit --no-verify -m "mock conflict change"',
        { stdio: 'ignore', env: GIT_ENV }
    )
    process.exit(0)
})
