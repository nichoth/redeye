import { cpSync, existsSync, lstatSync, readdirSync } from 'node:fs'
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
// are copied, so no `git add -A` (the agent's, or the timeout
// auto-commit) can stage a secret. A directory counts as ignored
// when every file in it is, whatever pattern does it
// (`.agents/`, `.agents/*`, ...).
export function listLocalFiles (repoRoot:string):LocalFiles {
    const result:LocalFiles = { copy: [], skipped: [] }
    for (const path of LOCAL_FILES) {
        if (!existsSync(join(repoRoot, path))) continue
        if (isTracked(repoRoot, path)) continue
        const files = filesUnder(repoRoot, path)
        if (files.length === 0) continue
        if (allIgnored(repoRoot, files)) {
            result.copy.push(path)
        } else {
            result.skipped.push(path)
        }
    }
    return result
}

// Copies the root's gitignored local files into a worktree. The
// worktree's branch must ignore them too: a continued or resumed
// ticket branch may predate the `.gitignore` line, and there a
// copied secret would be committable, so it is left out. Never
// overwrites a path the worktree already has (the branch may
// track it), and keeps symlinks as they are, so relative links
// such as `../../.agents/skills/x` still resolve. Returns the
// paths it copied.
export function copyLocalFiles (
    repoRoot:string,
    worktreePath:string
):string[] {
    const copy = listLocalFiles(repoRoot).copy.filter(path => {
        return allIgnored(worktreePath, filesUnder(repoRoot, path))
    })
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

// Repo-relative paths of every file and symlink at or under
// `path`. Symlinks are listed, never followed.
function filesUnder (repoRoot:string, path:string):string[] {
    if (!lstatSync(join(repoRoot, path)).isDirectory()) return [path]
    return readdirSync(join(repoRoot, path)).flatMap(name => {
        return filesUnder(repoRoot, join(path, name))
    })
}

// True when git ignores every path in `cwd`'s checkout. Works for
// paths that do not exist there yet. A path the checkout tracks
// is not ignored.
function allIgnored (cwd:string, paths:string[]):boolean {
    let out:string
    try {
        out = execFileSync(
            'git',
            ['check-ignore', '--stdin', '-z'],
            {
                cwd,
                encoding: 'utf8',
                input: paths.join('\0') + '\0',
                stdio: ['pipe', 'pipe', 'ignore'],
            }
        )
    } catch (err) {
        // exit 1 means none is ignored; anything else is a real error
        if ((err as { status?:number }).status === 1) return false
        throw err
    }
    const ignored = new Set(out.split('\0').filter(Boolean))
    return paths.every(p => ignored.has(p))
}
