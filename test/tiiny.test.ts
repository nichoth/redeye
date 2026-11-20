import { test } from '@substrate-system/tapzero'
import {
    mkdtempSync, writeFileSync, rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    isTiinyRun,
    deviceModelIds,
    loadTiinyProvider,
    type TiinyProvider,
} from '../src/tiiny.js'

function tmp ():string {
    return mkdtempSync(join(tmpdir(), 'redeye-tiiny-'))
}

// --- isTiinyRun ---

test('isTiinyRun - pi provider with tiiny/ model', t => {
    t.ok(
        isTiinyRun('pi', [
            'tiiny/Qwen/Qwen3.6-35B-A3B-turbo',
        ]),
        'detects tiiny run'
    )
})

test('isTiinyRun - pi provider with mixed models', t => {
    t.ok(
        isTiinyRun('pi', [
            'some-other-model',
            'tiiny/Qwen/Qwen3.6-35B-A3B-turbo',
        ]),
        'any tiiny/ model is enough'
    )
})

test('isTiinyRun - pi provider with no tiiny/ model', t => {
    t.ok(
        !isTiinyRun('pi', ['gpt-4o', 'sonnet']),
        'no tiiny/ prefix means not a tiiny run'
    )
})

test('isTiinyRun - non-pi provider with tiiny/ model', t => {
    t.ok(
        !isTiinyRun('claude', [
            'tiiny/Qwen/Qwen3.6-35B-A3B-turbo',
        ]),
        'provider must be pi'
    )
})

test('isTiinyRun - pi provider with empty models', t => {
    t.ok(
        !isTiinyRun('pi', []),
        'no models means not a tiiny run'
    )
})

test('isTiinyRun - pi with undefined models', t => {
    t.ok(
        !isTiinyRun('pi', [undefined as unknown as string]),
        'undefined model is not tiiny'
    )
})

// --- deviceModelIds ---

test('deviceModelIds - strips tiiny/ prefix', t => {
    const ids = deviceModelIds([
        'tiiny/Qwen/Qwen3.6-35B-A3B-turbo',
        'tiiny/openai/gpt-oss-20b',
    ])
    t.deepEqual(ids, [
        'Qwen/Qwen3.6-35B-A3B-turbo',
        'openai/gpt-oss-20b',
    ])
})

test('deviceModelIds - ignores non-tiiny models', t => {
    const ids = deviceModelIds([
        'sonnet',
        'tiiny/Qwen/Qwen3.6-35B-A3B-turbo',
        'gpt-4o',
    ])
    t.deepEqual(ids, [
        'Qwen/Qwen3.6-35B-A3B-turbo',
    ])
})

test('deviceModelIds - returns distinct ids', t => {
    const ids = deviceModelIds([
        'tiiny/Qwen/Qwen3.6-35B-A3B-turbo',
        'tiiny/Qwen/Qwen3.6-35B-A3B-turbo',
        'tiiny/openai/gpt-oss-20b',
    ])
    t.deepEqual(ids, [
        'Qwen/Qwen3.6-35B-A3B-turbo',
        'openai/gpt-oss-20b',
    ])
})

test('deviceModelIds - empty when no tiiny models', t => {
    const ids = deviceModelIds(['sonnet', 'gpt-4o'])
    t.deepEqual(ids, [])
})

// --- loadTiinyProvider ---

test('loadTiinyProvider - reads tiiny provider', t => {
    const dir = tmp()
    try {
        const modelsFile = join(dir, 'models.json')
        writeFileSync(modelsFile, JSON.stringify({
            providers: {
                tiiny: {
                    baseUrl: 'http://openai.api.tiiny/v1',
                    apiKey: 'literal-key-123',
                    compat: {
                        supportsDeveloperRole: false,
                    },
                },
            },
        }))

        const result = loadTiinyProvider(modelsFile)
        t.ok('provider' in result, 'returns provider')
        const p = (result as { provider:TiinyProvider })
            .provider
        t.equal(p.baseUrl, 'http://openai.api.tiiny/v1')
        t.equal(p.apiKey, 'literal-key-123')
        t.deepEqual(p.compat, {
            supportsDeveloperRole: false,
        })
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadTiinyProvider - resolves $ENV_VAR apiKey', t => {
    const dir = tmp()
    try {
        const modelsFile = join(dir, 'models.json')
        const envKey = 'REDEYE_TEST_TIINY_KEY_' +
            process.pid
        process.env[envKey] = 'resolved-secret-value'

        writeFileSync(modelsFile, JSON.stringify({
            providers: {
                tiiny: {
                    baseUrl: 'http://localhost:1234/v1',
                    apiKey: '$' + envKey,
                    compat: {},
                },
            },
        }))

        const result = loadTiinyProvider(modelsFile)
        t.ok('provider' in result, 'returns provider')
        const p = (result as { provider:TiinyProvider })
            .provider
        t.equal(
            p.apiKey,
            'resolved-secret-value',
            'env var resolved'
        )

        delete process.env[envKey]
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadTiinyProvider - $VAR that is not set uses ' +
    'literal', t => {
    const dir = tmp()
    try {
        const modelsFile = join(dir, 'models.json')
        const envKey = 'REDEYE_NONEXISTENT_' + process.pid
        delete process.env[envKey]

        writeFileSync(modelsFile, JSON.stringify({
            providers: {
                tiiny: {
                    baseUrl: 'http://localhost:1234/v1',
                    apiKey: '$' + envKey,
                    compat: {},
                },
            },
        }))

        const result = loadTiinyProvider(modelsFile)
        t.ok('provider' in result, 'returns provider')
        const p = (result as { provider:TiinyProvider })
            .provider
        t.equal(
            p.apiKey,
            '$' + envKey,
            'unset env var falls back to literal'
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadTiinyProvider - missing file returns error ' +
    'naming file', t => {
    const missing = '/tmp/redeye-nonexistent-' +
        process.pid + '/models.json'

    const result = loadTiinyProvider(missing)
    t.ok('error' in result, 'returns error')
    const msg = (result as { error:string }).error
    t.ok(
        msg.includes(missing),
        'error names the file: ' + msg
    )
})

test('loadTiinyProvider - no tiiny provider returns ' +
    'error naming file', t => {
    const dir = tmp()
    try {
        const modelsFile = join(dir, 'models.json')
        writeFileSync(modelsFile, JSON.stringify({
            providers: {
                openai: {
                    baseUrl: 'http://example.com',
                    apiKey: 'key',
                },
            },
        }))

        const result = loadTiinyProvider(modelsFile)
        t.ok('error' in result, 'returns error')
        const msg = (result as { error:string }).error
        t.ok(
            msg.includes(modelsFile),
            'error names the file: ' + msg
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadTiinyProvider - error never includes ' +
    'resolved key', t => {
    const dir = tmp()
    try {
        const modelsFile = join(dir, 'models.json')
        writeFileSync(modelsFile, JSON.stringify({
            providers: {},
        }))

        const result = loadTiinyProvider(modelsFile)
        t.ok('error' in result, 'returns error')
        const msg = (result as { error:string }).error
        t.ok(
            !msg.includes('secret'),
            'no secret in error message'
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadTiinyProvider - uses PI_MODELS_FILE env ' +
    'var', t => {
    const dir = tmp()
    const envKey = 'PI_MODELS_FILE'
    const prev = process.env[envKey]
    try {
        const modelsFile = join(dir, 'models.json')
        writeFileSync(modelsFile, JSON.stringify({
            providers: {
                tiiny: {
                    baseUrl: 'http://test/v1',
                    apiKey: 'test-key',
                    compat: {},
                },
            },
        }))
        process.env[envKey] = modelsFile

        const result = loadTiinyProvider()
        t.ok('provider' in result, 'returns provider')
        const p = (result as { provider:TiinyProvider })
            .provider
        t.equal(p.baseUrl, 'http://test/v1')
    } finally {
        if (prev === undefined) {
            delete process.env[envKey]
        } else {
            process.env[envKey] = prev
        }
        rmSync(dir, { recursive: true, force: true })
    }
})

test('loadTiinyProvider - invalid JSON returns error', t => {
    const dir = tmp()
    try {
        const modelsFile = join(dir, 'models.json')
        writeFileSync(modelsFile, '{ not valid }')

        const result = loadTiinyProvider(modelsFile)
        t.ok('error' in result, 'returns error')
        const msg = (result as { error:string }).error
        t.ok(
            msg.includes(modelsFile),
            'error names the file'
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
