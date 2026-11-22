#!/usr/bin/env node
// Records how many sibling agents are running at the same
// time. Each agent drops a marker file in the directory
// named by MOCK_CONCURRENCY_DIR, waits, then appends the
// peak marker count it observed to <dir>/peaks.
import {
    writeFileSync, appendFileSync, readdirSync, unlinkSync,
    existsSync, readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const dir = process.env.MOCK_CONCURRENCY_DIR
const marker = join(dir, `running-${randomUUID()}`)

// Agents in the run; once every one has started, no peer is left
// to wait for
const total = Number(process.env.MOCK_CONCURRENCY_TOTAL ?? Infinity)

function countFinished () {
    const peaks = join(dir, 'peaks')
    if (!existsSync(peaks)) return 0
    return readFileSync(peaks, 'utf8').split('\n').filter(Boolean).length
}

function countRunning () {
    return readdirSync(dir)
        .filter(n => n.startsWith('running-')).length
}

process.stdin.resume()
process.stdin.on('end', () => {
    writeFileSync(marker, '')
    let peak = countRunning()
    // Holds until a sibling is seen (or none can still start, or
    // a deadline when the cap is 1), then a while longer, so a
    // slow machine still shows the overlap and a third agent past
    // a broken cap would too
    const deadline = Date.now() + 10_000
    let until = null
    const tick = setInterval(() => {
        const running = countRunning()
        peak = Math.max(peak, running)
        const lastOnes = countFinished() + running >= total
        if (until === null &&
            (peak >= 2 || lastOnes || Date.now() >= deadline)) {
            until = Date.now() + 400
        }
        if (until !== null && Date.now() >= until) {
            clearInterval(tick)
            unlinkSync(marker)
            appendFileSync(join(dir, 'peaks'), `${peak}\n`)
            process.exit(0)
        }
    }, 20)
})
