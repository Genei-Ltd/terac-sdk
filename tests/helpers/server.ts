import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type RecordedRequest = {
  method: string
  url: string
  path: string
  query: URLSearchParams
  headers: Record<string, string | string[] | undefined>
  body: string
}

export type TestServer = {
  origin: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

export type Handler = (
  request: RecordedRequest,
  response: ServerResponse,
) => void | Promise<void>

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/** Starts an HTTP server on an ephemeral port and records everything it sees. */
export const startServer = async (handler: Handler): Promise<TestServer> => {
  const requests: RecordedRequest[] = []

  const server = createServer((incoming, response) => {
    void (async () => {
      const rawUrl = incoming.url ?? '/'
      const parsed = new URL(rawUrl, 'http://localhost')
      const recorded: RecordedRequest = {
        method: incoming.method ?? 'GET',
        url: rawUrl,
        path: parsed.pathname,
        query: parsed.searchParams,
        headers: incoming.headers,
        body: await readBody(incoming),
      }
      requests.push(recorded)

      try {
        await handler(recorded, response)
      } catch {
        if (!response.headersSent) {
          response.writeHead(500)
        }
        response.end()
      }
    })()
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port')
  }
  const { port } = address satisfies AddressInfo

  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      }),
  }
}

/** Replies with JSON and the given status. */
export const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    ...headers,
  })
  response.end(payload)
}
