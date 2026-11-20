import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TIINY_PREFIX = 'tiiny/'

export interface TiinyProvider {
    baseUrl:string
    apiKey:string
    compat:Record<string, unknown>
}

export type TiinyProviderResult =
    | { provider:TiinyProvider }
    | { error:string }

export function isTiinyRun (
    provider:string,
    modelIds:string[],
):boolean {
    if (provider !== 'pi') return false
    return modelIds.some(
        id => typeof id === 'string' &&
            id.startsWith(TIINY_PREFIX)
    )
}

export function deviceModelIds (
    modelIds:string[],
):string[] {
    const seen = new Set<string>()
    const result:string[] = []
    for (const id of modelIds) {
        if (
            typeof id !== 'string' ||
            !id.startsWith(TIINY_PREFIX)
        ) {
            continue
        }
        const stripped = id.slice(TIINY_PREFIX.length)
        if (!seen.has(stripped)) {
            seen.add(stripped)
            result.push(stripped)
        }
    }
    return result
}

function defaultModelsFile ():string {
    return process.env.PI_MODELS_FILE ??
        join(homedir(), '.pi', 'agent', 'models.json')
}

function resolveApiKey (raw:string):string {
    if (!raw.startsWith('$')) return raw
    const envName = raw.slice(1)
    const val = process.env[envName]
    return val !== undefined ? val : raw
}

export function loadTiinyProvider (
    modelsFile?:string,
):TiinyProviderResult {
    const file = modelsFile ?? defaultModelsFile()

    let raw:string
    try {
        raw = readFileSync(file, 'utf8')
    } catch {
        return {
            error: `Cannot read models file: ${file}`,
        }
    }

    let parsed:unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return {
            error: `Invalid JSON in models file: ${file}`,
        }
    }

    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        !('providers' in parsed)
    ) {
        return {
            error: 'No providers in models file: ' +
                file,
        }
    }

    const providers = (
        parsed as { providers:Record<string, unknown> }
    ).providers

    if (
        typeof providers !== 'object' ||
        providers === null ||
        !('tiiny' in providers)
    ) {
        return {
            error: 'No tiiny provider in models ' +
                'file: ' + file,
        }
    }

    const tiiny = providers.tiiny as
        Record<string, unknown>

    const baseUrl = tiiny.baseUrl as string
    const rawKey = tiiny.apiKey as string
    const compat = (tiiny.compat ?? {}) as
        Record<string, unknown>

    return {
        provider: {
            baseUrl,
            apiKey: resolveApiKey(rawKey),
            compat,
        },
    }
}
