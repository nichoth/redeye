import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

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

// --- Device client ---

export type ResidentModelsResult =
    | { ids:string[] }
    | { error:string }

export async function residentModels (
    baseUrl:string,
    apiKey:string,
):Promise<ResidentModelsResult> {
    let res:Response
    try {
        res = await fetch(baseUrl + '/models', {
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        })
    } catch (err) {
        return {
            error: `GET /models failed: ${
                (err as Error).message ?? err
            }`,
        }
    }

    if (!res.ok) {
        return {
            error: `GET /models returned ${res.status}`,
        }
    }

    const body = await res.json() as {
        data:{ id:string }[]
    }
    return {
        ids: (body.data ?? []).map(m => m.id),
    }
}

export interface LoadModelOpts {
    host:string
    apiKey:string
    baseUrl:string
    tiinyBin?:string
    pollMs?:number
    deadlineMs?:number
}

function defaultTiinyBin ():string {
    return process.env.TIINY_BIN ??
        join(homedir(), '.local', 'tiiny', 'bin', 'tiiny')
}

function defaultHost ():string {
    return process.env.TIINY_HOST ??
        'http://tiinyhost.local'
}

function runCmd (
    cmd:string,
    args:string[],
):Promise<{ ok:boolean, error?:string }> {
    return new Promise(resolve => {
        execFile(cmd, args, { timeout: 60_000 }, err => {
            if (err) {
                resolve({
                    ok: false,
                    error: err.message,
                })
            } else {
                resolve({ ok: true })
            }
        })
    })
}

async function runCliFallback (
    bin:string,
    modelId:string,
):Promise<{ ok:boolean, error?:string }> {
    const scriptResult = await runCmd('script', [
        '-q', '/dev/null', bin, 'load', modelId, '-y',
    ])
    if (scriptResult.ok) return scriptResult

    const directResult = await runCmd(
        bin, ['load', modelId, '-y']
    )
    if (directResult.ok) return directResult

    return {
        ok: false,
        error: `CLI fallback failed: ${
            directResult.error
        }`,
    }
}

function sleep (ms:number):Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export type LoadModelResult =
    | { ok:true }
    | { error:string }

export async function loadModel (
    modelId:string,
    opts:LoadModelOpts,
):Promise<LoadModelResult> {
    const host = opts.host ?? defaultHost()
    const bin = opts.tiinyBin ?? defaultTiinyBin()
    const pollMs = opts.pollMs ?? 2000
    const deadlineMs = opts.deadlineMs ?? 180_000

    let httpStartOk = false
    try {
        const url = `${host}/api/v1/models/` +
            `${encodeURIComponent(modelId)}/start`
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${opts.apiKey}`,
            },
        })
        httpStartOk = res.ok
    } catch {
        httpStartOk = false
    }

    if (!httpStartOk) {
        const cli = await runCliFallback(bin, modelId)
        if (!cli.ok) {
            return {
                error: cli.error ??
                    `Failed to start ${modelId}`,
            }
        }
    }

    const deadline = Date.now() + deadlineMs
    while (Date.now() < deadline) {
        const check = await residentModels(
            opts.baseUrl,
            opts.apiKey,
        )
        if ('ids' in check &&
            check.ids.includes(modelId)
        ) {
            return { ok: true }
        }
        if (Date.now() + pollMs >= deadline) break
        await sleep(pollMs)
    }

    return {
        error: `Timed out waiting for ${modelId} ` +
            'to become resident',
    }
}
