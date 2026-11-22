import { test } from './shard.js'
import {
    mkdtempSync, mkdirSync, writeFileSync, existsSync,
    lstatSync, readlinkSync, readFileSync, symlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    setup, SKILL_DIRS, DOC_TEMPLATES, checkGhAuth,
    findSkillCollisions,
} from '../src/setup.js'

function makeTempProject ():{
    projectDir:string;
    bundledSkillsDir:string;
    docsTemplatesDir:string;
} {
    const base = mkdtempSync(
        join(tmpdir(), 'redeye-test-')
    )
    const projectDir = join(base, 'project')
    mkdirSync(projectDir, { recursive: true })

    const bundledSkillsDir = join(base, 'bundled')
    mkdirSync(bundledSkillsDir, { recursive: true })

    writeFileSync(
        join(bundledSkillsDir, 'upstream.json'),
        JSON.stringify({
            repo: 'test/repo',
            commit: 'abc123',
        })
    )

    for (const skill of SKILL_DIRS) {
        const dir = join(bundledSkillsDir, skill)
        mkdirSync(dir, { recursive: true })
        writeFileSync(
            join(dir, 'SKILL.md'),
            `# ${skill}`
        )
    }

    const docsTemplatesDir = join(base, 'docs-templates')
    mkdirSync(docsTemplatesDir, { recursive: true })
    for (const tmpl of DOC_TEMPLATES) {
        writeFileSync(
            join(docsTemplatesDir, tmpl),
            `# ${tmpl}`
        )
    }
    writeFileSync(
        join(docsTemplatesDir, 'issue-tracker.md'),
        '# issue-tracker.md'
    )
    writeFileSync(
        join(docsTemplatesDir, 'issue-tracker-github.md'),
        '# issue-tracker-github.md'
    )

    return { projectDir, bundledSkillsDir, docsTemplatesDir }
}

test('setup copies skills to .agents/skills', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    for (const skill of SKILL_DIRS) {
        const dest = join(
            projectDir, '.agents', 'skills', skill
        )
        t.ok(
            existsSync(dest),
            `${skill}/ should exist in .agents/skills`
        )
        t.ok(
            existsSync(join(dest, 'SKILL.md')),
            `${skill}/SKILL.md should be copied`
        )
    }
})

test('setup creates symlinks in .claude/skills', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    for (const skill of SKILL_DIRS) {
        const agentsDest = join(
            projectDir, '.agents', 'skills', skill
        )
        t.ok(
            existsSync(agentsDest),
            `${skill}/ should exist in .agents/skills`
        )

        const claudeDest = join(
            projectDir, '.claude', 'skills', skill
        )
        t.ok(
            existsSync(claudeDest),
            `${skill}/ should exist in .claude/skills`
        )

        if (!existsSync(claudeDest)) {
            t.fail(`symlink missing for ${skill}`)
            continue
        }

        const stat = lstatSync(claudeDest)
        t.ok(
            stat.isSymbolicLink(),
            `.claude/skills/${skill} should be a symlink`
        )

        const target = readlinkSync(claudeDest)
        const expected = join(
            '..', '..', '.agents', 'skills', skill
        )
        t.equal(
            target,
            expected,
            `symlink should point to ${expected}`
        )
    }
})

test('setup creates docs/agents/ templates', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    for (const tmpl of DOC_TEMPLATES) {
        const dest = join(
            projectDir, 'docs', 'agents', tmpl
        )
        t.ok(
            existsSync(dest),
            `docs/agents/${tmpl} should be created`
        )
    }
})

test('setup does not overwrite non-tracker docs', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    const triagePath = join(
        projectDir, 'docs', 'agents', 'triage-labels.md'
    )
    mkdirSync(join(projectDir, 'docs', 'agents'), {
        recursive: true,
    })
    writeFileSync(triagePath, 'custom triage content')

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    const content = readFileSync(triagePath, 'utf8')
    t.equal(
        content,
        'custom triage content',
        'should preserve existing triage-labels.md'
    )
})

test('setup is idempotent', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    const opts = {
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local' as const,
    }

    setup(opts)
    setup(opts)

    for (const skill of SKILL_DIRS) {
        const agentsDest = join(
            projectDir, '.agents', 'skills', skill
        )
        t.ok(
            existsSync(agentsDest),
            `${skill}/ should still exist after second run`
        )

        const claudeDest = join(
            projectDir, '.claude', 'skills', skill
        )
        if (!existsSync(claudeDest)) {
            t.fail(`symlink missing for ${skill}`)
            continue
        }
        const stat = lstatSync(claudeDest)
        t.ok(
            stat.isSymbolicLink(),
            `${skill} symlink should still be valid`
        )
    }

    for (const tmpl of DOC_TEMPLATES) {
        const dest = join(
            projectDir, 'docs', 'agents', tmpl
        )
        t.ok(
            existsSync(dest),
            `docs/agents/${tmpl} should still exist`
        )
    }
})

test('checkGhAuth exists and is callable', t => {
    t.equal(
        typeof checkGhAuth,
        'function',
        'checkGhAuth should be a function'
    )
})

test('setup with tracker:local copies local markdown template', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    const trackerPath = join(
        projectDir, 'docs', 'agents', 'issue-tracker.md'
    )
    t.ok(
        existsSync(trackerPath),
        'docs/agents/issue-tracker.md should exist'
    )
    const content = readFileSync(trackerPath, 'utf8')
    t.ok(
        content.includes('# issue-tracker.md'),
        'should copy local markdown template'
    )
})

test('local ticket publishing uses the runnable status convention', t => {
    const {
        projectDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir: join(process.cwd(), 'src', 'skills'),
        docsTemplatesDir: join(
            process.cwd(), 'src', 'docs-templates'
        ),
        projectDir,
        tracker: 'local',
    })

    const skill = readFileSync(
        join(
            projectDir, '.agents', 'skills', 'to-tickets',
            'SKILL.md'
        ),
        'utf8'
    )
    const templateStart = skill.indexOf(
        '<local-ticket-template>'
    )
    const templateEnd = skill.indexOf(
        '</local-ticket-template>'
    )
    const localTemplate = skill.slice(templateStart, templateEnd)
    t.ok(
        localTemplate.includes('**Status:** ready-for-agent'),
        'published local tickets should be runnable'
    )

    const tracker = readFileSync(
        join(projectDir, 'docs', 'agents', 'issue-tracker.md'),
        'utf8'
    )
    t.ok(
        tracker.includes('**Status:**'),
        'tracker docs should describe the runnable status syntax'
    )
})

test('setup with tracker:github copies github template', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'github',
    })

    const trackerPath = join(
        projectDir, 'docs', 'agents', 'issue-tracker.md'
    )
    t.ok(
        existsSync(trackerPath),
        'docs/agents/issue-tracker.md should exist'
    )
    const content = readFileSync(trackerPath, 'utf8')
    t.ok(
        content.includes('# issue-tracker-github.md'),
        'should copy github template'
    )
})

test('setup creates AGENTS.md with local markdown text', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    const agentsMdPath = join(projectDir, 'AGENTS.md')
    t.ok(
        existsSync(agentsMdPath),
        'AGENTS.md should exist'
    )
    const content = readFileSync(agentsMdPath, 'utf8')
    t.ok(
        content.includes('local markdown files'),
        'should mention local markdown'
    )
})

test('setup creates AGENTS.md with GitHub Issues text', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'github',
    })

    const agentsMdPath = join(projectDir, 'AGENTS.md')
    t.ok(
        existsSync(agentsMdPath),
        'AGENTS.md should exist'
    )
    const content = readFileSync(agentsMdPath, 'utf8')
    t.ok(
        content.includes('GitHub Issues'),
        'should mention GitHub Issues'
    )
})

test('setup creates AGENTS.md with managed markers when no file exists', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    const content = readFileSync(
        join(projectDir, 'AGENTS.md'), 'utf8'
    )
    t.ok(
        content.includes('<!-- redeye:start -->'),
        'should contain start marker'
    )
    t.ok(
        content.includes('<!-- redeye:end -->'),
        'should contain end marker'
    )
    t.ok(
        content.includes('Agent skills'),
        'should contain managed content'
    )
})

test('setup appends managed section to existing AGENTS.md without markers', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    const agentsPath = join(projectDir, 'AGENTS.md')
    writeFileSync(agentsPath, '# My Project\n\nCustom instructions.\n')

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    const content = readFileSync(agentsPath, 'utf8')
    t.ok(
        content.includes('# My Project'),
        'should preserve existing content'
    )
    t.ok(
        content.includes('Custom instructions.'),
        'should preserve existing instructions'
    )
    t.ok(
        content.includes('<!-- redeye:start -->'),
        'should append start marker'
    )
    t.ok(
        content.includes('<!-- redeye:end -->'),
        'should append end marker'
    )
    t.ok(
        content.includes('Agent skills'),
        'should include managed content'
    )
})

test('setup replaces only managed section in existing AGENTS.md', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    const agentsPath = join(projectDir, 'AGENTS.md')
    writeFileSync(agentsPath, [
        '# My Project',
        '',
        'Custom instructions.',
        '',
        '<!-- redeye:start -->',
        'old managed content',
        '<!-- redeye:end -->',
        '',
        'More custom content.',
        '',
    ].join('\n'))

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })

    const content = readFileSync(agentsPath, 'utf8')
    t.ok(
        content.includes('# My Project'),
        'should preserve content before markers'
    )
    t.ok(
        content.includes('Custom instructions.'),
        'should preserve instructions before markers'
    )
    t.ok(
        content.includes('More custom content.'),
        'should preserve content after markers'
    )
    t.ok(
        !content.includes('old managed content'),
        'should remove old managed content'
    )
    t.ok(
        content.includes('Agent skills'),
        'should insert new managed content'
    )
})

test(
    'tracker template overwrites when switching trackers',
    t => {
        const {
            projectDir, bundledSkillsDir,
            docsTemplatesDir,
        } = makeTempProject()

        setup({
            bundledSkillsDir,
            docsTemplatesDir,
            projectDir,
            tracker: 'local',
        })

        const trackerPath = join(
            projectDir, 'docs', 'agents',
            'issue-tracker.md'
        )
        const localContent = readFileSync(
            trackerPath, 'utf8'
        )
        t.ok(
            localContent.includes('# issue-tracker.md'),
            'should have local template initially'
        )

        setup({
            bundledSkillsDir,
            docsTemplatesDir,
            projectDir,
            tracker: 'github',
        })

        const githubContent = readFileSync(
            trackerPath, 'utf8'
        )
        t.ok(
            githubContent.includes('# issue-tracker-github.md'),
            'should overwrite with GitHub template'
        )
        t.ok(
            !githubContent.includes('# issue-tracker.md'),
            'should not contain local template anymore'
        )
    }
)

test('setup writes AGENTS.md merge=union to .gitattributes',
    t => {
        const {
            projectDir, bundledSkillsDir, docsTemplatesDir,
        } = makeTempProject()
        setup({
            bundledSkillsDir,
            docsTemplatesDir,
            projectDir,
            tracker: 'local',
        })
        const attrs = readFileSync(
            join(projectDir, '.gitattributes'), 'utf8'
        )
        t.ok(
            attrs.split('\n').includes('AGENTS.md merge=union'),
            'contains the union merge rule'
        )
    }
)

test('setup preserves existing .gitattributes entries', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    const attrsPath = join(projectDir, '.gitattributes')
    writeFileSync(attrsPath, '*.png binary\n')
    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })
    const lines = readFileSync(attrsPath, 'utf8').split('\n')
    t.ok(lines.includes('*.png binary'), 'keeps existing rule')
    t.ok(
        lines.includes('AGENTS.md merge=union'),
        'adds the union merge rule'
    )
})

test('setup does not duplicate the .gitattributes rule', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    const opts = {
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local' as const,
    }
    setup(opts)
    setup(opts)
    const lines = readFileSync(
        join(projectDir, '.gitattributes'), 'utf8'
    ).split('\n')
    const count = lines.filter(
        l => l === 'AGENTS.md merge=union'
    ).length
    t.equal(count, 1, 'rule appears exactly once')
})

test('setup with skillsRoot installs skills there', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    const skillsRoot = mkdtempSync(
        join(tmpdir(), 'redeye-home-')
    )

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
        skillsRoot,
    })

    for (const skill of SKILL_DIRS) {
        t.ok(
            existsSync(join(
                skillsRoot, '.agents', 'skills', skill, 'SKILL.md'
            )),
            `${skill} should be copied under skillsRoot`
        )
        const link = join(skillsRoot, '.claude', 'skills', skill)
        t.ok(
            lstatSync(link).isSymbolicLink(),
            `${skill} should be linked from skillsRoot/.claude`
        )
        t.ok(
            existsSync(join(link, 'SKILL.md')),
            `${skill} symlink should resolve`
        )
    }

    t.ok(
        !existsSync(join(projectDir, '.agents')),
        'no .agents dir in the project'
    )
    t.ok(
        !existsSync(join(projectDir, '.claude')),
        'no .claude dir in the project'
    )
    t.ok(
        existsSync(join(projectDir, 'docs', 'agents',
            'issue-tracker.md')),
        'doc templates still go in the project'
    )
    t.ok(
        existsSync(join(projectDir, 'AGENTS.md')),
        'AGENTS.md still goes in the project'
    )
})

// A skills root shaped like a real home dir: the user's own skills
// under .claude, linked (or broken-linked) from .agents, plus a
// .agents link to a folder that lives somewhere else entirely.
function makeCrowdedRoot ():{ root:string; external:string } {
    const root = mkdtempSync(join(tmpdir(), 'redeye-root-'))
    const external = mkdtempSync(join(tmpdir(), 'redeye-ext-'))
    const agents = join(root, '.agents', 'skills')
    const claude = join(root, '.claude', 'skills')
    mkdirSync(agents, { recursive: true })
    mkdirSync(claude, { recursive: true })

    // user's own skill in .claude, linked from .agents
    mkdirSync(join(claude, 'tdd'))
    writeFileSync(join(claude, 'tdd', 'SKILL.md'), 'mine')
    symlinkSync(join(claude, 'tdd'), join(agents, 'tdd'))

    // broken link in .agents
    symlinkSync('.claude/skills/nope', join(agents, 'codebase-design'))

    // user's own real folder in .agents
    mkdirSync(join(agents, 'to-spec'))
    writeFileSync(join(agents, 'to-spec', 'SKILL.md'), 'mine')

    // .agents link to a folder outside the root
    writeFileSync(join(external, 'SKILL.md'), 'mine')
    symlinkSync(external, join(agents, 'to-tickets'))

    return { root, external }
}

const CROWDED = ['tdd', 'codebase-design', 'to-spec', 'to-tickets']

test('findSkillCollisions is empty for a fresh root', t => {
    const { bundledSkillsDir } = makeTempProject()
    const root = mkdtempSync(join(tmpdir(), 'redeye-root-'))
    t.deepEqual(findSkillCollisions(bundledSkillsDir, root), [])
})

test('findSkillCollisions is empty after setup has run', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })
    t.deepEqual(
        findSkillCollisions(bundledSkillsDir, projectDir), [],
        'a re-run of init has nothing to ask about'
    )
})

test('findSkillCollisions reports changed bundled copies', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
    })
    writeFileSync(
        join(projectDir, '.agents', 'skills', 'tdd', 'SKILL.md'),
        'edited'
    )
    const found = findSkillCollisions(bundledSkillsDir, projectDir)
    t.deepEqual(found.map(c => c.skill), ['tdd'])
})

test('findSkillCollisions reports every pre-existing entry', t => {
    const { bundledSkillsDir } = makeTempProject()
    const { root } = makeCrowdedRoot()
    const found = findSkillCollisions(bundledSkillsDir, root)
    t.deepEqual(
        found.map(c => c.skill).sort(),
        [...CROWDED].sort(),
    )
    const tdd = found.find(c => c.skill === 'tdd')
    t.deepEqual(tdd?.paths, [
        join(root, '.agents', 'skills', 'tdd'),
        join(root, '.claude', 'skills', 'tdd'),
    ], 'both locations are reported for one skill')
})

test('setup leaves skipped skills untouched', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    const { root, external } = makeCrowdedRoot()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
        skillsRoot: root,
        skip: new Set(CROWDED),
    })

    const agents = join(root, '.agents', 'skills')
    const claude = join(root, '.claude', 'skills')
    t.equal(
        readFileSync(join(claude, 'tdd', 'SKILL.md'), 'utf8'),
        'mine'
    )
    t.ok(lstatSync(join(agents, 'tdd')).isSymbolicLink())
    t.ok(lstatSync(join(claude, 'tdd')).isDirectory())
    t.ok(lstatSync(join(agents, 'codebase-design')).isSymbolicLink())
    t.equal(
        readFileSync(join(agents, 'to-spec', 'SKILL.md'), 'utf8'),
        'mine'
    )
    t.equal(readFileSync(join(external, 'SKILL.md'), 'utf8'), 'mine')

    t.ok(
        existsSync(join(agents, 'grill', 'SKILL.md')),
        'skills that did not collide are still installed'
    )
    t.ok(
        existsSync(join(claude, 'to-spec', 'SKILL.md')),
        'a missing link is created even for a skipped skill'
    )
})

test('setup replaces colliding skills that are not skipped', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()
    const { root, external } = makeCrowdedRoot()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
        skillsRoot: root,
    })

    t.deepEqual(
        findSkillCollisions(bundledSkillsDir, root), [],
        'every entry now matches the bundled install'
    )
    for (const skill of CROWDED) {
        t.ok(
            lstatSync(join(root, '.agents', 'skills', skill))
                .isDirectory(),
            `.agents/skills/${skill} is a real folder`
        )
    }
    t.equal(
        readFileSync(join(external, 'SKILL.md'), 'utf8'), 'mine',
        'replacing a symlink does not touch what it pointed to'
    )
})

test('setup writes .redeye.json when adversarial is given', t => {
    const {
        projectDir, bundledSkillsDir, docsTemplatesDir,
    } = makeTempProject()

    setup({
        bundledSkillsDir,
        docsTemplatesDir,
        projectDir,
        tracker: 'local',
        adversarial: {
            implement: 'claude -m opus',
            review: 'claude -m sonnet',
            maxRounds: 3,
            minRounds: 1,
        },
    })

    const cfgPath = join(projectDir, '.redeye.json')
    t.ok(existsSync(cfgPath), '.redeye.json should exist')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    t.equal(
        cfg.adversarial.implement, 'claude -m opus',
        'implement role string'
    )
    t.equal(
        cfg.adversarial.review, 'claude -m sonnet',
        'review role string'
    )
    t.equal(cfg.adversarial.maxRounds, 3, 'maxRounds')
    t.equal(cfg.adversarial.minRounds, 1, 'minRounds')
})

test(
    'setup merges adversarial into existing .redeye.json',
    t => {
        const {
            projectDir, bundledSkillsDir, docsTemplatesDir,
        } = makeTempProject()

        const cfgPath = join(projectDir, '.redeye.json')
        writeFileSync(cfgPath, JSON.stringify({
            someSetting: true,
            nested: { a: 1 },
        }))

        setup({
            bundledSkillsDir,
            docsTemplatesDir,
            projectDir,
            tracker: 'local',
            adversarial: {
                implement: 'pi',
                review: 'claude -m opus --effort high',
                maxRounds: 5,
                minRounds: 2,
            },
        })

        const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
        t.equal(
            cfg.someSetting, true,
            'existing key preserved'
        )
        t.deepEqual(
            cfg.nested, { a: 1 },
            'existing nested key preserved'
        )
        t.equal(
            cfg.adversarial.implement, 'pi',
            'implement written'
        )
        t.equal(
            cfg.adversarial.review,
            'claude -m opus --effort high',
            'review written'
        )
        t.equal(cfg.adversarial.maxRounds, 5, 'maxRounds')
        t.equal(cfg.adversarial.minRounds, 2, 'minRounds')
    }
)

test(
    'setup without adversarial leaves existing .redeye.json',
    t => {
        const {
            projectDir, bundledSkillsDir, docsTemplatesDir,
        } = makeTempProject()

        const cfgPath = join(projectDir, '.redeye.json')
        const original = JSON.stringify({ someSetting: true })
        writeFileSync(cfgPath, original)

        setup({
            bundledSkillsDir,
            docsTemplatesDir,
            projectDir,
            tracker: 'local',
        })

        t.equal(
            readFileSync(cfgPath, 'utf8'),
            original,
            '.redeye.json unchanged'
        )
    }
)

test(
    'setup without adversarial creates no .redeye.json',
    t => {
        const {
            projectDir, bundledSkillsDir, docsTemplatesDir,
        } = makeTempProject()

        setup({
            bundledSkillsDir,
            docsTemplatesDir,
            projectDir,
            tracker: 'local',
        })

        t.ok(
            !existsSync(join(projectDir, '.redeye.json')),
            'no .redeye.json created'
        )
    }
)

test(
    'setup writes round defaults explicitly',
    t => {
        const {
            projectDir, bundledSkillsDir, docsTemplatesDir,
        } = makeTempProject()

        setup({
            bundledSkillsDir,
            docsTemplatesDir,
            projectDir,
            tracker: 'local',
            adversarial: {
                implement: 'claude',
                review: 'pi',
                maxRounds: 3,
                minRounds: 1,
            },
        })

        const raw = readFileSync(
            join(projectDir, '.redeye.json'), 'utf8'
        )
        const cfg = JSON.parse(raw)
        t.ok(
            'maxRounds' in cfg.adversarial,
            'maxRounds key present even at default'
        )
        t.ok(
            'minRounds' in cfg.adversarial,
            'minRounds key present even at default'
        )
        t.equal(cfg.adversarial.maxRounds, 3)
        t.equal(cfg.adversarial.minRounds, 1)
    }
)
