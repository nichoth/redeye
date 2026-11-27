import { readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
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
    // tokens after `--`, passed to the harness unparsed
    extraArgs?:string[]
}

export function parseRoleString (input:string):ParsedRole {
    const trimmed = input.trim()
    if (trimmed === '') {
        throw new Error('Role string is empty')
    }

    const args = trimmed.split(/\s+/)

    // populate-- keeps the tokens after `--` out of the strict
    // option and positional checks
    const parsed = yargs(args)
        .parserConfiguration({ 'populate--': true })
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
    const extraArgs = readExtraArgs(parsed['--'])

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
        ...(extraArgs.length ? { extraArgs } : {}),
    }
}

// The tokens yargs collects after `--` when populate-- is on.
// yargs turns numeric tokens into numbers, so each one goes
// back to a string; the harness gets them as written.
export function readExtraArgs (dashDash:unknown):string[] {
    if (!Array.isArray(dashDash)) return []
    return dashDash.map(String)
}

export interface CliOptions {
    model?:string
    effort?:string
    maxTurns?:number
    preferSubagent?:string
    // the tokens after `--` on the command line
    extraArgs?:string[]
}

// Merges a parsed role with CLI options. The role's flags
// win; CLI fills in whatever the role leaves out. The role keeps
// its own extra args; CLI extra args are not merged here, since
// only resolveRoles knows which role they belong to.
export function mergeRoleWithCli (
    role:ParsedRole,
    cli:CliOptions
):ParsedRole {
    return {
        provider: role.provider,
        model: role.model ?? cli.model,
        effort: role.effort ?? cli.effort,
        maxTurns: role.maxTurns ?? cli.maxTurns,
        preferSubagent: role.preferSubagent ??
            cli.preferSubagent,
        ...(role.extraArgs?.length ?
            { extraArgs: [...role.extraArgs] } :
            {}),
    }
}

// `role` with `extra` appended to its extra args. extraArgs stays
// unset when both lists are empty.
function withExtraArgs (role:ParsedRole, extra:string[]):ParsedRole {
    const merged = [...(role.extraArgs ?? []), ...extra]
    const { extraArgs: _, ...rest } = role
    return merged.length ? { ...rest, extraArgs: merged } : rest
}

export interface ResolvedRoles {
    // the role that implements tickets in this run
    implement:ParsedRole
    // null when .redeye.json has no adversarial key
    review:ParsedRole|null
    // true when a command-line provider replaced `implement`
    overridden:boolean
    // one line per provider that lost an unsupported option
    warnings:string[]
    // the implement role as a command string, for logs: the
    // config string, or the command-line provider and flags
    implementStr:string
}

// A role as a role string, in the form parseRoleString reads
export function renderRoleString (role:ParsedRole):string {
    const parts = [role.provider]
    if (role.model) parts.push('-m', role.model)
    if (role.effort) parts.push('--effort', role.effort)
    if (role.maxTurns) parts.push('--max-turns', String(role.maxTurns))
    if (role.preferSubagent) {
        parts.push('--prefer-subagent', role.preferSubagent)
    }
    if (role.extraArgs?.length) parts.push('--', ...role.extraArgs)
    return parts.join(' ')
}

// claude is the only provider with subagents, so every other
// role loses prefer-subagent, with one warning per provider.
function dropUnsupported (
    roles:ParsedRole[],
    warnings:string[]
):void {
    for (const role of roles) {
        if (!role.preferSubagent) continue
        const name = basename(role.provider)
        if (name === 'claude') continue
        role.preferSubagent = undefined
        const warning =
            `--prefer-subagent not supported by ${name}, skipping`
        if (!warnings.includes(warning)) warnings.push(warning)
    }
}

// The effective roles for a run. A command-line provider replaces
// the whole implement role, so its flags do not carry over; with
// no provider, `implement` is used. Each role's own flags win and
// the CLI flags fill in the rest. Throws when there is neither a
// provider nor a config.
//
// Extra args (the tokens after `--`) are decided here and nowhere
// else. CLI extras go to the implement role only: with a CLI
// provider they are its whole list; with none they follow the
// implement role string's own. The review role gets only the
// extras in its own role string.
export function resolveRoles (
    cliProvider:string|undefined,
    cli:CliOptions,
    adv:AdversarialConfig|null
):ResolvedRoles {
    const review = adv ? mergeRoleWithCli(adv.review, cli) : null
    if (!cliProvider && !adv) {
        throw new Error(
            'Specify a provider (e.g. redeye claude) ' +
            'or set implement in .redeye.json'
        )
    }
    const cliExtra = cli.extraArgs ?? []
    const implement = withExtraArgs(
        cliProvider ?
            mergeRoleWithCli({ provider: cliProvider }, cli) :
            mergeRoleWithCli(adv!.implement, cli),
        cliExtra
    )
    const warnings:string[] = []
    dropUnsupported(review ? [implement, review] : [implement], warnings)
    return {
        implement,
        review,
        overridden: !!cliProvider && adv !== null,
        warnings,
        implementStr: implementString(cliProvider, implement, adv, cliExtra),
    }
}

// The implement role for logs. With no CLI provider it is the
// config string, re-rendered with the CLI extras appended when
// there are any.
function implementString (
    cliProvider:string|undefined,
    implement:ParsedRole,
    adv:AdversarialConfig|null,
    cliExtra:string[]
):string {
    if (cliProvider || !adv) return renderRoleString(implement)
    if (!cliExtra.length) return adv.implementStr
    return renderRoleString(withExtraArgs(adv.implement, cliExtra))
}

// True when two roles run the same provider (by basename) and the
// same model. A role with no model runs its provider's default.
export function sameModel (a:ParsedRole, b:ParsedRole):boolean {
    return basename(a.provider) === basename(b.provider) &&
        (a.model ?? '') === (b.model ?? '')
}

export interface AdversarialConfig {
    implement:ParsedRole
    review:ParsedRole
    implementStr:string
    reviewStr:string
    maxRounds:number
    minRounds:number
}

function isPositiveInteger (v:unknown):v is number {
    return typeof v === 'number' &&
        Number.isInteger(v) &&
        v > 0
}

function isPlainObject (
    v:unknown
):v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
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

    if (!isPlainObject(raw)) {
        throw new Error('.redeye.json: must be a JSON object')
    }
    if (!('adversarial' in raw)) return null

    const adv = raw.adversarial
    if (!isPlainObject(adv)) {
        throw new Error(
            '.redeye.json: adversarial must be an object ' +
            'with implement and review role strings'
        )
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

    return {
        implement,
        review,
        implementStr: adv.implement as string,
        reviewStr: adv.review as string,
        maxRounds,
        minRounds,
    }
}
