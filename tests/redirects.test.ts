import { describe, expect, test } from 'vitest'
import { TeracSdk, TeracTransportError } from '../src/index'
import { json, startServer } from './helpers/server'

const API_KEY = 'tk_redirect_secret_key'

describe('redirect handling', () => {
  test('refuses to follow a cross-origin redirect and never sends the key onward', async () => {
    const target = await startServer((_request, response) => {
      json(response, 200, { id: 'leaked' })
    })

    const origin = await startServer((_request, response) => {
      response.writeHead(302, { location: `${target.origin}/projects` })
      response.end()
    })

    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: origin.origin })

    await expect(terac.projects.list()).rejects.toBeInstanceOf(
      TeracTransportError,
    )

    // The redirect was issued, and refused.
    expect(origin.requests).toHaveLength(1)
    // Nothing reached the host we were redirected to.
    expect(target.requests).toHaveLength(0)

    await Promise.all([origin.close(), target.close()])
  })

  test('refuses a same-origin redirect too, so the key cannot be replayed', async () => {
    const server = await startServer((request, response) => {
      if (request.path === '/projects') {
        response.writeHead(307, { location: '/elsewhere' })
        response.end()
        return
      }
      json(response, 200, { ok: true })
    })

    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    await expect(terac.projects.list()).rejects.toBeInstanceOf(
      TeracTransportError,
    )
    expect(server.requests.map((entry) => entry.path)).toEqual(['/projects'])

    await server.close()
  })

  test('the refused request carries only a redacted summary', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(302, { location: 'https://example.invalid/' })
      response.end()
    })

    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(TeracTransportError)
    if (!(error instanceof TeracTransportError)) {
      throw new Error('expected a TeracTransportError')
    }

    expect(error.request?.headers.authorization).toBe('[redacted]')
    expect(JSON.stringify(error)).not.toContain(API_KEY)

    await server.close()
  })
})
