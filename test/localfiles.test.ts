import { test } from './shard.js'
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    readlinkSync,
    existsSync,
    symlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { listLocalFiles, copyLocalFiles } from '../src/localfiles.js'

// -- helpers --

function git (cwd:string, args:string[]):string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

// A repo with no git template, so no hooks or excludes leak in
function initRepo ():string {
    const dir = mkdtempSync(join(tmpdir(), 'redeye-localfiles-'))
    git(dir, ['init', '--template=', '--initial-branch=main'])
    git(dir, ['config', 'user.email', 'test@example.com'])
    git(dir, ['config', 'user.name', 'Test User'])
    git(dir, ['commit', '--allow-empty', '-m', 'init'])
    return dir
}

function commitFile (repo:string, path:string, body:string):void {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), body)
    git(repo, ['add', '--force', '--', path])
    git(repo, ['commit', '-m', `add ${path}`])
}

function ignoreAll (repo:string):void {
    commitFile(repo, '.gitignore', '.agents/\n.env\n.dev.vars\n')
}

function addSkill (repo:string):void {
    const dir = join(repo, '.agents', 'skills', 'x')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '# x\n')
}

function addWorktree (repo:string, branch = 't'):string {
    const wt = join(
        mkdtempSync(join(tmpdir(), 'redeye-localfiles-wt-')),
        'wt'
    )
    git(repo, ['worktree', 'add', '-b', branch, wt, 'main'])
    return wt
}

// -- listLocalFiles --

test('listLocalFiles - nothing present', t => {
    const repo = initRepo()
    t.deepEqual(listLocalFiles(repo), { copy: [], skipped: [] })
})

test('listLocalFiles - ignored candidates are copied', t => {
    const repo = initRepo()
    ignoreAll(repo)
    addSkill(repo)
    writeFileSync(join(repo, '.env'), 'A=1\n')
    writeFileSync(join(repo, '.dev.vars'), 'B=2\n')
    t.deepEqual(listLocalFiles(repo), {
        copy: ['.agents', '.env', '.dev.vars'],
        skipped: [],
    })
})

test('listLocalFiles - tracked .agents is neither', t => {
    const repo = initRepo()
    commitFile(repo, '.agents/skills/x/SKILL.md', '# x\n')
    t.deepEqual(listLocalFiles(repo), { copy: [], skipped: [] })
})

test('listLocalFiles - unignored .env is skipped', t => {
    const repo = initRepo()
    writeFileSync(join(repo, '.env'), 'A=1\n')
    t.deepEqual(listLocalFiles(repo), {
        copy: [],
        skipped: ['.env'],
    })
})

test('listLocalFiles - nested secrets are not candidates', t => {
    const repo = initRepo()
    ignoreAll(repo)
    mkdirSync(join(repo, 'packages', 'api'), { recursive: true })
    writeFileSync(join(repo, 'packages', 'api', '.dev.vars'), 'B=2\n')
    t.deepEqual(listLocalFiles(repo), { copy: [], skipped: [] })
})

// -- copyLocalFiles --

test('copyLocalFiles - copies into the worktree', t => {
    const repo = initRepo()
    ignoreAll(repo)
    addSkill(repo)
    writeFileSync(join(repo, '.env'), 'A=1\n')
    writeFileSync(join(repo, '.dev.vars'), 'B=2\n')
    const wt = addWorktree(repo)

    const copied = copyLocalFiles(repo, wt)

    t.deepEqual(copied, ['.agents', '.env', '.dev.vars'])
    t.equal(readFileSync(join(wt, '.env'), 'utf8'), 'A=1\n')
    t.equal(readFileSync(join(wt, '.dev.vars'), 'utf8'), 'B=2\n')
    t.ok(existsSync(join(wt, '.agents', 'skills', 'x', 'SKILL.md')))
    t.equal(
        git(wt, ['status', '--porcelain']).trim(),
        '',
        'the copied files leave the worktree clean'
    )
})

test('copyLocalFiles - keeps symlinks verbatim', t => {
    const repo = initRepo()
    ignoreAll(repo)
    addSkill(repo)
    symlinkSync('x', join(repo, '.agents', 'skills', 'y'))
    const wt = addWorktree(repo)

    copyLocalFiles(repo, wt)

    t.equal(readlinkSync(join(wt, '.agents', 'skills', 'y')), 'x')
})

test('copyLocalFiles - does not overwrite the branch', t => {
    const repo = initRepo()
    ignoreAll(repo)
    git(repo, ['branch', 'tracks-env'])
    git(repo, ['switch', '--quiet', 'tracks-env'])
    commitFile(repo, '.env', 'branch\n')
    git(repo, ['switch', '--quiet', 'main'])
    writeFileSync(join(repo, '.env'), 'root\n')
    const wt = join(
        mkdtempSync(join(tmpdir(), 'redeye-localfiles-wt-')),
        'wt'
    )
    git(repo, ['worktree', 'add', wt, 'tracks-env'])

    copyLocalFiles(repo, wt)

    t.equal(readFileSync(join(wt, '.env'), 'utf8'), 'branch\n')
})
