import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yargs from 'yargs'
import { ALL_EFFORT_LEVELS } from './retry.js'

export interface RoleStringOptions {
    alias?:string
    type:'string'|'number'|'boolean'
    choices?:readonly string[]
    describe?:string
}

export const ROLE_OPTIONS:{
    [key:string]:RoleStringOptions
} = {
    m: {
        alias: 'model',
        type: 'string',
        describe: 'Model passed to the agent',
    },
    effort: {
        type: 'string',
        choices: ALL_EFFORT_LEVELS as unknown as string[],
        describe: 'Starting effort level',
    },
    'max-turns': {
        type: 'number',
        describe: 'Max agentic turns per ticket',
    },
    'prefer-subagent': {
        type: 'string',
        describe: 'Model that subagents default to',
    },
} as const

export interface ParsedRole {
    provider:string
    model?:string
    effort?:string
    maxTurns?:number
    preferSubagent?:string
}

export function parseRoleString (input:string):ParsedRole {
    const trimmed = input.trim()
    if (trimmed === '') {
        throw new Error('Role string is empty')
    }

    const args = trimmed.split(/\s+/)

    const parsed = yargs(args)
        .command(
            '$0 <provider>',
            false,
            y => y.positional('provider', {
                type: 'string',
                demandOption: true,
            })
        )
        .strict()
        .strictCommands(false)
        .option('m', ROLE_OPTIONS.m)
        .option('effort', ROLE_OPTIONS.effort)
        .option('max-turns', ROLE_OPTIONS['max-turns'])
        .option(
            'prefer-subagent',
            ROLE_OPTIONS['prefer-subagent']
        )
        .help(false)
        .version(false)
        .exitProcess(false)
        .fail((msg:string|null, err:unknown) => {
            const message = msg ??
                (err instanceof Error ? err.message : String(err))
            throw new Error(message)
        })
        .parseSync()

    const positionals = parsed._ as (string|number)[]
    if (positionals.length > 0) {
        throw new Error(
            'Extra positional argument: ' +
            `"${positionals.join(' ')}"`
        )
    }

    const provider = parsed.provider as string

    const rawSubagent = parsed.preferSubagent as
        string|undefined
    const preferSubagent = rawSubagent === '' ?
        'true' :
        rawSubagent || undefined

    return {
        provider,
        model: parsed.model as string|undefined,
        effort: parsed.effort as string|undefined,
        maxTurns: parsed.maxTurns as number|undefined,
        preferSubagent,
    }
}

export interface AdversarialConfig {
    implement:ParsedRole
    review:ParsedRole
    maxRounds:number
    minRounds:number
}

function isPositiveInteger (v:unknown):v is number {
    return typeof v === 'number' &&
        Number.isInteger(v) &&
        v > 0
}

// Reads .redeye.json from `root`. Returns null when the file
// is absent or has no adversarial key (loop off). Throws on
// any validation error so the caller can exit before work
// starts.
export function loadConfig (
    root:string
):AdversarialConfig|null {
    const file = join(root, '.redeye.json')
    if (!existsSync(file)) return null

    let raw:unknown
    try {
        raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
        const msg = err instanceof Error ?
            err.message :
            String(err)
        throw new Error(
            `.redeye.json: ${msg}`
        )
    }

    if (
        raw === null ||
        typeof raw !== 'object' ||
        !('adversarial' in raw)
    ) {
        return null
    }

    const adv = (raw as Record<string, unknown>)
        .adversarial as Record<string, unknown>|null
    if (adv === null || typeof adv !== 'object') {
        return null
    }

    if (typeof adv.implement !== 'string') {
        throw new Error(
            '.redeye.json: adversarial.implement is ' +
            'required (a role string)'
        )
    }
    if (typeof adv.review !== 'string') {
        throw new Error(
            '.redeye.json: adversarial.review is ' +
            'required (a role string)'
        )
    }

    const implement = parseRoleString(adv.implement)
    const review = parseRoleString(adv.review)

    const maxRounds = adv.maxRounds ?? 3
    const minRounds = adv.minRounds ?? 1

    if (!isPositiveInteger(maxRounds)) {
        throw new Error(
            '.redeye.json: maxRounds must be a ' +
            'positive integer'
        )
    }
    if (!isPositiveInteger(minRounds)) {
        throw new Error(
            '.redeye.json: minRounds must be a ' +
            'positive integer'
        )
    }
    if (minRounds > maxRounds) {
        throw new Error(
            '.redeye.json: minRounds (' + minRounds +
            ') must not exceed maxRounds (' +
            maxRounds + ')'
        )
    }

    return { implement, review, maxRounds, minRounds }
}
