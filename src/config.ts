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
