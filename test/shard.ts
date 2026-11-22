import { test as tapTest, type TestFn } from '@substrate-system/tapzero'

// Splits one suite across processes. TEST_SHARD=i/n registers
// every nth test starting at i, so scripts/test.sh can run the
// slices of a large suite at the same time. Unset runs them all.
const [shardIndex, shardCount] = parseShard(process.env.TEST_SHARD)

function parseShard (value:string|undefined):[number, number] {
    if (!value) return [0, 1]
    const match = /^(\d+)\/(\d+)$/.exec(value)
    if (!match) throw new Error(`bad TEST_SHARD: ${value}`)
    const index = Number(match[1])
    const count = Number(match[2])
    if (count < 1 || index >= count) {
        throw new Error(`bad TEST_SHARD: ${value}`)
    }
    return [index, count]
}

let registered = 0

export function test (name:string, fn?:TestFn):void {
    const mine = registered % shardCount === shardIndex
    registered++
    if (mine) tapTest(name, fn)
}
