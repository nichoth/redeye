import {
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

export const SKILL_DIRS = [
    'grill', 'grilling', 'domain-modeling',
    'to-spec', 'to-tickets', 'tdd',
    'codebase-design', 'improve-codebase-architecture'
] as const

export const DOC_TEMPLATES = [
    'triage-labels.md',
    'domain.md',
] as const

const START_MARKER = '<!-- redeye:start -->'
const END_MARKER = '<!-- redeye:end -->'

export function writeManagedSection (
    filePath:string,
    content:string,
):void {
    const block = [
        START_MARKER,
        content,
        END_MARKER,
    ].join('\n')

    if (!existsSync(filePath)) {
        writeFileSync(filePath, block + '\n')
        return
    }

    const existing = readFileSync(filePath, 'utf8')
    const startIdx = existing.indexOf(START_MARKER)
    const endIdx = existing.indexOf(END_MARKER)

    if (startIdx !== -1 && endIdx !== -1) {
        const before = existing.slice(0, startIdx)
        const after = existing.slice(
            endIdx + END_MARKER.length
        )
        writeFileSync(filePath, before + block + after)
    } else {
        const sep = existing.endsWith('\n') ? '\n' : '\n\n'
        writeFileSync(filePath, existing + sep + block + '\n')
    }
}

function ensureGitAttribute (
    filePath:string,
    line:string,
):void {
    if (!existsSync(filePath)) {
        writeFileSync(filePath, line + '\n')
        return
    }
    const existing = readFileSync(filePath, 'utf8')
    if (existing.split('\n').includes(line)) return
    const sep = existing.endsWith('\n') ? '' : '\n'
    writeFileSync(filePath, existing + sep + line + '\n')
}

export function checkGhAuth ():boolean {
    try {
        execSync('gh auth status', { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

export type TrackerKind = 'github'|'local'

// lstat-based, so a broken symlink still counts as an entry
function entryExists (p:string):boolean {
    try {
        lstatSync(p)
        return true
    } catch {
        return false
    }
}

function sameTree (a:string, b:string):boolean {
    let statA, statB
    try {
        statA = statSync(a)
        statB = statSync(b)
    } catch {
        return false
    }
    if (statA.isDirectory() !== statB.isDirectory()) return false
    if (!statA.isDirectory()) {
        return readFileSync(a).equals(readFileSync(b))
    }
    const namesA = readdirSync(a).sort()
    const namesB = readdirSync(b).sort()
    if (namesA.length !== namesB.length) return false
    return namesA.every((name, i) => {
        return name === namesB[i] &&
            sameTree(join(a, name), join(b, name))
    })
}

function claudeLinkTarget (skill:string):string {
    return join('..', '..', '.agents', 'skills', skill)
}

function isClaudeLink (linkPath:string, skill:string):boolean {
    try {
        return lstatSync(linkPath).isSymbolicLink() &&
            readlinkSync(linkPath) === claudeLinkTarget(skill)
    } catch {
        return false
    }
}

export type SkillCollision = {
    skill:string
    paths:string[]
}

/**
 * Existing entries that installing the bundled skills would replace.
 * An `.agents/skills/<name>` folder that already matches the bundled
 * copy, and a `.claude/skills/<name>` link that already points at it,
 * are not collisions, so re-running `init` asks nothing.
 */
export function findSkillCollisions (
    bundledSkillsDir:string,
    skillsRoot:string,
):SkillCollision[] {
    const collisions:SkillCollision[] = []
    for (const skill of SKILL_DIRS) {
        const paths:string[] = []
        const agentsPath = join(skillsRoot, '.agents', 'skills', skill)
        if (entryExists(agentsPath)) {
            const isBundledCopy =
                !lstatSync(agentsPath).isSymbolicLink() &&
                sameTree(join(bundledSkillsDir, skill), agentsPath)
            if (!isBundledCopy) paths.push(agentsPath)
        }
        const claudePath = join(skillsRoot, '.claude', 'skills', skill)
        if (
            entryExists(claudePath) &&
            !isClaudeLink(claudePath, skill)
        ) {
            paths.push(claudePath)
        }
        if (paths.length) collisions.push({ skill, paths })
    }
    return collisions
}

export type SetupOpts = {
    bundledSkillsDir:string
    docsTemplatesDir:string
    projectDir:string
    tracker:TrackerKind
    // Where `.agents/skills` and `.claude/skills` go. Defaults to
    // projectDir; `init --global` passes the user's home dir.
    skillsRoot?:string
    // Skills whose existing entries are left alone; missing entries
    // for them are still created. Every other skill is replaced.
    skip?:ReadonlySet<string>
}

const TRACKER_TEMPLATES:Record<TrackerKind, string> = {
    local: 'issue-tracker.md',
    github: 'issue-tracker-github.md',
}

export function setup (opts:SetupOpts):void {
    const {
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker,
    } = opts
    const skillsRoot = opts.skillsRoot ?? projectDir
    const isGlobal = skillsRoot !== projectDir
    const agentsSkillsDir = join(
        skillsRoot, '.agents', 'skills'
    )
    const claudeSkillsDir = join(skillsRoot, '.claude', 'skills')
    const skip = opts.skip ?? new Set<string>()

    const upstream = JSON.parse(
        readFileSync(join(bundledSkillsDir, 'upstream.json'), 'utf8')
    ) as { repo:string; commit:string }

    console.log(
        `Installing skills to ${
            isGlobal ? agentsSkillsDir : '.agents/skills'
        }/\n`
    )

    mkdirSync(agentsSkillsDir, { recursive: true })

    for (const skill of SKILL_DIRS) {
        const src = join(bundledSkillsDir, skill)
        const dest = join(agentsSkillsDir, skill)
        if (skip.has(skill) && entryExists(dest)) {
            console.log(`  ${skill}/ (already exists, skipped)`)
            continue
        }
        // rm removes a symlink itself, never what it points to
        rmSync(dest, { recursive: true, force: true })
        cpSync(src, dest, { recursive: true })
        const files = readdirSync(src)
        console.log(`  ${skill}/ (${files.join(', ')})`)
    }

    mkdirSync(claudeSkillsDir, { recursive: true })

    for (const skill of SKILL_DIRS) {
        const linkPath = join(claudeSkillsDir, skill)
        if (isClaudeLink(linkPath, skill)) continue
        if (entryExists(linkPath)) {
            if (skip.has(skill)) continue
            rmSync(linkPath, { recursive: true, force: true })
        }
        symlinkSync(claudeLinkTarget(skill), linkPath)
    }

    console.log(
        `\nCreated symlinks in ${
            isGlobal ? claudeSkillsDir : '.claude/skills'
        }/`
    )

    const docsAgentsDir = join(projectDir, 'docs', 'agents')
    mkdirSync(docsAgentsDir, { recursive: true })

    console.log('')
    for (const tmpl of DOC_TEMPLATES) {
        const dest = join(docsAgentsDir, tmpl)
        if (existsSync(dest)) {
            console.log(
                `  docs/agents/${tmpl} (already exists)`
            )
            continue
        }
        const src = join(docsTemplatesDir, tmpl)
        writeFileSync(dest, readFileSync(src, 'utf8'))
        console.log(`  docs/agents/${tmpl} (created)`)
    }

    const trackerSrc = join(
        docsTemplatesDir, TRACKER_TEMPLATES[tracker]
    )
    const trackerDest = join(docsAgentsDir, 'issue-tracker.md')
    writeFileSync(trackerDest, readFileSync(trackerSrc, 'utf8'))
    console.log(
        `  docs/agents/issue-tracker.md (${tracker})`
    )

    const trackerLine = tracker === 'github' ?
        'Issues are tracked via GitHub Issues using the `gh` ' +
        'CLI.' :
        'Issues are tracked as local markdown files under ' +
        '`.scratch/`.'

    const managedContent = [
        '## Agent skills',
        '',
        '### Issue tracker',
        '',
        `${trackerLine} See \`docs/agents/issue-tracker.md\`.`,
        '',
        '### Triage labels',
        '',
        'Default label vocabulary. See ' +
        '`docs/agents/triage-labels.md`.',
        '',
        '### Domain docs',
        '',
        'Single-context layout. See `docs/agents/domain.md`.',
    ].join('\n')

    const agentsPath = join(projectDir, 'AGENTS.md')
    writeManagedSection(agentsPath, managedContent)
    console.log('\n  AGENTS.md (updated)')

    ensureGitAttribute(
        join(projectDir, '.gitattributes'),
        'AGENTS.md merge=union',
    )
    console.log('  .gitattributes (AGENTS.md merge=union)')

    console.log(
        `\nSource: ${upstream.repo} @ ${upstream.commit}`
    )
}
