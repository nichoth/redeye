import { test } from '@substrate-system/tapzero'
import { parseRoleString } from '../src/config.js'

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
