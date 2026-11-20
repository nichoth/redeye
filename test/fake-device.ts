import { createServer, type Server } from 'node:http'

export interface FakeDevice {
    url:string
    server:Server
    resident:Set<string>
    loadRequests:string[]
    close:() => Promise<void>
}

export function createFakeDevice (
    opts?:{ resident?:string[] },
):Promise<FakeDevice> {
    const resident = new Set<string>(opts?.resident ?? [])
    const loadRequests:string[] = []

    const server = createServer((req, res) => {
        if (
            req.method === 'GET' &&
            req.url === '/v1/models'
        ) {
            const data = [...resident].map(id => ({ id }))
            res.writeHead(200, {
                'Content-Type': 'application/json',
            })
            res.end(JSON.stringify({ data }))
            return
        }

        const startMatch = req.method === 'POST' &&
            req.url?.match(
                /^\/api\/v1\/models\/(.+)\/start$/
            )
        if (startMatch) {
            const id = decodeURIComponent(startMatch[1])
            loadRequests.push(id)
            res.writeHead(200, {
                'Content-Type': 'application/json',
            })
            res.end(JSON.stringify({ ok: true }))
            return
        }

        res.writeHead(404)
        res.end('not found')
    })

    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address()
            if (!addr || typeof addr === 'string') {
                reject(new Error('unexpected address'))
                return
            }
            resolve({
                url: `http://127.0.0.1:${addr.port}`,
                server,
                resident,
                loadRequests,
                close: () => new Promise<void>(
                    (res, rej) => {
                        server.close(
                            err => err ? rej(err) : res()
                        )
                    }
                ),
            })
        })
    })
}
