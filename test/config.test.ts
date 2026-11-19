import { test } from '@substrate-system/tapzero'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    parseRoleString,
    loadConfig,
    mergeRoleWithCli,
    type AdversarialConfig,
    type ParsedRole,
} from '../src/config.js'

function tmp ():string {
    return mkdtempSync(join(tmpdir(), 'redeye-cfg-'))
}

test('parse a full role string', t => {
    const result = parseRoleString(
        'claude -m opus --effort high ' +
        '--max-turns 40 --prefer-subagent sonnet'
    )
    t.equal(result.provider, 'claude')
    t.equal(result.model, 'opus')
    t.equal(result.effort, 'high')
    t.equal(result.maxTurns, 40)
    t.equal(result.preferSubagent, 'sonnet')
})

test('--model works as the long form of -m', t => {
    const result = parseRoleString('claude --model sonnet')
    t.equal(result.provider, 'claude')
    t.equal(result.model, 'sonnet')
})

test('provider-only role string', t => {
    const result = parseRoleString('pi')
    t.equal(result.provider, 'pi')
    t.equal(result.model, undefined)
    t.equal(result.effort, undefined)
    t.equal(result.maxTurns, undefined)
    t.equal(result.preferSubagent, undefined)
})

test('reject an unsupported flag', t => {
    t.throws(
        () => parseRoleString('claude --timeout 60'),
        /unknown.*timeout/i
    )
})

test('reject an extra positional', t => {
    t.throws(
        () => parseRoleString('claude opus'),
        /extra positional|unknown argument/i
    )
})

test('reject an empty string', t => {
    t.throws(
        () => parseRoleString(''),
        /empty/i
    )
})

test('bare --prefer-subagent gives true', t => {
    const result = parseRoleString(
        'claude --prefer-subagent'
    )
    t.equal(result.preferSubagent, 'true')
})

test('--prefer-subagent with a value', t => {
    const result = parseRoleString(
        'claude --prefer-subagent haiku'
    )
    t.equal(result.preferSubagent, 'haiku')
})

test('--effort alone without model', t => {
    const result = parseRoleString('pi --effort medium')
    t.equal(result.provider, 'pi')
    t.equal(result.model, undefined)
    t.equal(result.effort, 'medium')
})

test('--max-turns alone', t => {
    const result = parseRoleString('claude --max-turns 25')
    t.equal(result.provider, 'claude')
    t.equal(result.maxTurns, 25)
})

// --- loadConfig tests ---

test('loadConfig - missing file returns loop off', t => {
    const dir = tmp()
    try {
        const cfg = loadConfig(dir)
        t.equal(cfg, null, 'null means loop off')
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - file with no adversarial key returns ' +
    'loop off', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({ something: 'else' })
        )
        const cfg = loadConfig(dir)
        t.equal(cfg, null, 'null means loop off')
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - valid adversarial config', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude -m opus',
                    review: 'pi --effort high',
                },
            })
        )
        const cfg = loadConfig(dir) as AdversarialConfig
        t.ok(cfg, 'config is not null')
        t.equal(
            cfg.implement.provider, 'claude',
            'implement provider'
        )
        t.equal(cfg.implement.model, 'opus')
        t.equal(cfg.review.provider, 'pi')
        t.equal(cfg.review.effort, 'high')
        t.equal(cfg.maxRounds, 3, 'maxRounds defaults to 3')
        t.equal(cfg.minRounds, 1, 'minRounds defaults to 1')
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - explicit maxRounds and minRounds', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude',
                    review: 'pi',
                    maxRounds: 5,
                    minRounds: 2,
                },
            })
        )
        const cfg = loadConfig(dir) as AdversarialConfig
        t.equal(cfg.maxRounds, 5)
        t.equal(cfg.minRounds, 2)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - missing implement rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    review: 'pi',
                },
            })
        )
        t.throws(
            () => loadConfig(dir),
            /implement/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - missing review rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude',
                },
            })
        )
        t.throws(
            () => loadConfig(dir),
            /review/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - invalid JSON rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            '{ not valid json'
        )
        t.throws(
            () => loadConfig(dir),
            /parse|json|syntax/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - invalid role string rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude --timeout 60',
                    review: 'pi',
                },
            })
        )
        t.throws(
            () => loadConfig(dir),
            /unknown.*timeout/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - maxRounds not a positive integer ' +
    'rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude',
                    review: 'pi',
                    maxRounds: 0,
                },
            })
        )
        t.throws(
            () => loadConfig(dir),
            /maxRounds/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - maxRounds float rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude',
                    review: 'pi',
                    maxRounds: 2.5,
                },
            })
        )
        t.throws(
            () => loadConfig(dir),
            /maxRounds/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - minRounds greater than maxRounds ' +
    'rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude',
                    review: 'pi',
                    maxRounds: 2,
                    minRounds: 5,
                },
            })
        )
        t.throws(
            () => loadConfig(dir),
            /minRounds/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadConfig - minRounds not a positive integer ' +
    'rejects', t => {
    const dir = tmp()
    try {
        writeFileSync(
            join(dir, '.redeye.json'),
            JSON.stringify({
                adversarial: {
                    implement: 'claude',
                    review: 'pi',
                    minRounds: -1,
                },
            })
        )
        t.throws(
            () => loadConfig(dir),
            /minRounds/i
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

// --- mergeRoleWithCli tests ---

test('mergeRoleWithCli - role flag wins over CLI flag', t => {
    const role:ParsedRole = {
        provider: 'claude',
        effort: 'high',
    }
    const cli = {
        effort: 'low' as const,
        maxTurns: 50,
    }
    const merged = mergeRoleWithCli(role, cli)
    t.equal(merged.provider, 'claude')
    t.equal(merged.effort, 'high', 'role effort wins')
    t.equal(merged.maxTurns, 50, 'CLI fills in maxTurns')
})

test('mergeRoleWithCli - CLI fills in missing fields', t => {
    const role:ParsedRole = {
        provider: 'pi',
    }
    const cli = {
        model: 'sonnet',
        effort: 'medium' as const,
        maxTurns: 30,
        preferSubagent: 'haiku',
    }
    const merged = mergeRoleWithCli(role, cli)
    t.equal(merged.provider, 'pi')
    t.equal(merged.model, 'sonnet')
    t.equal(merged.effort, 'medium')
    t.equal(merged.maxTurns, 30)
    t.equal(merged.preferSubagent, 'haiku')
})

test('mergeRoleWithCli - role with all fields ignores ' +
    'CLI', t => {
    const role:ParsedRole = {
        provider: 'claude',
        model: 'opus',
        effort: 'high',
        maxTurns: 40,
        preferSubagent: 'sonnet',
    }
    const cli = {
        model: 'haiku',
        effort: 'low' as const,
        maxTurns: 10,
        preferSubagent: 'opus',
    }
    const merged = mergeRoleWithCli(role, cli)
    t.equal(merged.model, 'opus')
    t.equal(merged.effort, 'high')
    t.equal(merged.maxTurns, 40)
    t.equal(merged.preferSubagent, 'sonnet')
})

test('mergeRoleWithCli - empty CLI leaves role ' +
    'unchanged', t => {
    const role:ParsedRole = {
        provider: 'claude',
        model: 'opus',
    }
    const merged = mergeRoleWithCli(role, {})
    t.equal(merged.provider, 'claude')
    t.equal(merged.model, 'opus')
    t.equal(merged.effort, undefined)
    t.equal(merged.maxTurns, undefined)
    t.equal(merged.preferSubagent, undefined)
})

test('mergeRoleWithCli - applies separately to implement ' +
    'and review', t => {
    const impl:ParsedRole = {
        provider: 'claude',
        model: 'opus',
    }
    const rev:ParsedRole = {
        provider: 'pi',
        effort: 'high',
    }
    const cli = {
        effort: 'low' as const,
        maxTurns: 20,
    }
    const mergedImpl = mergeRoleWithCli(impl, cli)
    const mergedRev = mergeRoleWithCli(rev, cli)
    t.equal(mergedImpl.effort, 'low',
        'implement has no effort, gets CLI')
    t.equal(mergedImpl.maxTurns, 20)
    t.equal(mergedRev.effort, 'high',
        'review effort wins over CLI')
    t.equal(mergedRev.maxTurns, 20)
})
