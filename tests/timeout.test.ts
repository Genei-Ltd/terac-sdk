import { describe, expect, test } from 'vitest'
import { TeracSdk, TeracTimeoutError } from '../src/index'
import { json, startServer } from './helpers/server'

const API_KEY = 'tk_timeout'

describe('timeoutMs', () => {
  test('rejects a positive-number timeout at construction', () => {
    expect(() => new TeracSdk({ apiKey: API_KEY, timeoutMs: 0 })).toThrow(
      /positive number/,
    )
    expect(() => new TeracSdk({ apiKey: API_KEY, timeoutMs: -1 })).toThrow(
      /positive number/,
    )
    expect(
      () => new TeracSdk({ apiKey: API_KEY, timeoutMs: Number.NaN }),
    ).toThrow(/positive number/)
  })

  test('rejects a timeout above the largest delay setTimeout honours', () => {
    // `setTimeout` wraps a delay above 2_147_483_647ms round to 1ms, so a
    // caller asking for a very long deadline would otherwise have every
    // request aborted almost at once.
    expect(
      () => new TeracSdk({ apiKey: API_KEY, timeoutMs: 2_147_483_648 }),
    ).toThrow(/at most 2147483647ms/)
    expect(
      () =>
        new TeracSdk({ apiKey: API_KEY, timeoutMs: Number.MAX_SAFE_INTEGER }),
    ).toThrow(/at most 2147483647ms/)

    // The boundary itself is still accepted.
    expect(
      () => new TeracSdk({ apiKey: API_KEY, timeoutMs: 2_147_483_647 }),
    ).not.toThrow()
  })

  test('trips when the server never answers', async () => {
    const server = await startServer(() => {
      // Never answers.
    })
    const terac = new TeracSdk({
      apiKey: API_KEY,
      baseUrl: server.origin,
      timeoutMs: 40,
    })

    const started = Date.now()
    await expect(terac.projects.list()).rejects.toBeInstanceOf(
      TeracTimeoutError,
    )
    expect(Date.now() - started).toBeLessThan(2000)

    await server.close()
  })

  test('trips when the server sends headers and then stalls the body', async () => {
    // The failure the response-header-only deadline misses: the response
    // arrives, `fetch()` resolves, and the body never completes.
    const server = await startServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        // Promise more bytes than we will ever send.
        'content-length': '4096',
      })
      response.write('{"data":')
      // Never ends the response.
    })

    const terac = new TeracSdk({
      apiKey: API_KEY,
      baseUrl: server.origin,
      timeoutMs: 60,
    })

    const started = Date.now()
    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    const elapsed = Date.now() - started

    expect(error).toBeInstanceOf(TeracTimeoutError)
    if (!(error instanceof TeracTimeoutError)) {
      throw new Error('expected a TeracTimeoutError')
    }
    expect(error.timeoutMs).toBe(60)
    // Must not hang: the promise settles close to the deadline.
    expect(elapsed).toBeLessThan(2000)

    await server.close()
  })

  test('trips when the body streams slowly past the deadline', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"data":[')
      const interval = setInterval(() => {
        response.write('{},')
      }, 20)
      response.on('close', () => {
        clearInterval(interval)
      })
    })

    const terac = new TeracSdk({
      apiKey: API_KEY,
      baseUrl: server.origin,
      timeoutMs: 80,
    })

    await expect(terac.projects.list()).rejects.toBeInstanceOf(
      TeracTimeoutError,
    )
    await server.close()
  })

  test('a response that completes inside the deadline is returned intact', async () => {
    const server = await startServer((_request, response) => {
      setTimeout(() => {
        json(response, 200, { data: [{ id: 'p1' }], pagination: {} })
      }, 20)
    })

    const terac = new TeracSdk({
      apiKey: API_KEY,
      baseUrl: server.origin,
      timeoutMs: 1000,
    })

    const result = await terac.projects.list()
    expect(result.data[0]?.id).toBe('p1')

    await server.close()
  })

  test('no timeout is armed when timeoutMs is omitted', async () => {
    const server = await startServer((_request, response) => {
      setTimeout(() => {
        json(response, 200, { data: [], pagination: {} })
      }, 120)
    })

    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })
    await expect(terac.projects.list()).resolves.toBeDefined()

    await server.close()
  })
})
