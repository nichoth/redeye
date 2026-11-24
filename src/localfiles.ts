import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Root-level files a fresh worktree lacks because git never checks
// them out: the agent skills and the secrets files. Root only.
export const LOCAL_FILES:readonly string[] = [
    '.agents',
    '.env',
    '.dev.vars',
]

export type LocalFiles = {
    // present, untracked and gitignored: copied into worktrees
    copy:string[]
    // present, untracked and not ignored: never copied
    skipped:string[]
}

// Sorts the candidates that exist in `repoRoot`. A tracked one is
// neither, since git puts it in the worktree. Only ignored files
// are copied: the worktree ignores them too, so no `git add -A`
// (the agent's, or the timeout auto-commit) can stage a secret.
export function listLocalFiles (repoRoot:string):LocalFiles {
    const result:LocalFiles = { copy: [], skipped: [] }
    for (const path of LOCAL_FILES) {
        if (!existsSync(join(repoRoot, path))) continue
        if (isTracked(repoRoot, path)) continue
        if (isIgnored(repoRoot, path)) {
            result.copy.push(path)
        } else {
            result.skipped.push(path)
        }
    }
    return result
}

// Copies the root's gitignored local files into a worktree. Never
// overwrites a path the worktree already has (the branch may
// track it), and keeps symlinks as they are, so relative links
// such as `../../.agents/skills/x` still resolve. Returns the
// paths it copied.
export function copyLocalFiles (
    repoRoot:string,
    worktreePath:string
):string[] {
    const { copy } = listLocalFiles(repoRoot)
    for (const path of copy) {
        cpSync(join(repoRoot, path), join(worktreePath, path), {
            recursive: true,
            force: false,
            errorOnExist: false,
            verbatimSymlinks: true,
        })
    }
    return copy
}

function isTracked (repoRoot:string, path:string):boolean {
    const out = execFileSync('git', ['ls-files', '--', path], {
        cwd: repoRoot,
        encoding: 'utf8',
    })
    return out.trim().length > 0
}

function isIgnored (repoRoot:string, path:string):boolean {
    try {
        execFileSync('git', ['check-ignore', '-q', '--', path], {
            cwd: repoRoot,
            stdio: 'ignore',
        })
        return true
    } catch (err) {
        // exit 1 means not ignored; anything else is a real error
        if ((err as { status?:number }).status === 1) return false
        throw err
    }
}
