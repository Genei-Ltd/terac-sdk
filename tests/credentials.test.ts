import { inspect } from 'node:util'
import { describe, expect, test } from 'vitest'
import {
  TeracApiError,
  TeracSdk,
  TeracTimeoutError,
  TeracTransportError,
} from '../src/index'
import { json, startServer } from './helpers/server'

const API_KEY = 'tk_super_secret_do_not_log_me'

/** Walks every reachable enumerable property, following cycles safely. */
const collectEnumerableStrings = (root: unknown): string[] => {
  const found: string[] = []
  const seen = new Set<unknown>()

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      found.push(value)
      return
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) {
      return
    }
    seen.add(value)
    for (const entry of Object.values(value)) {
      visit(entry)
    }
  }

  visit(root)
  return found
}

describe('credential containment', () => {
  const sdk = new TeracSdk({ apiKey: API_KEY, timeoutMs: 1000 })

  test('JSON.stringify of the SDK does not contain the API key', () => {
    expect(JSON.stringify(sdk)).not.toContain(API_KEY)
  })

  test('util.inspect of the SDK does not contain the API key', () => {
    expect(inspect(sdk, { depth: null })).not.toContain(API_KEY)
    expect(inspect(sdk, { depth: null, showHidden: true })).not.toContain(
      API_KEY,
    )
  })

  test('no enumerable property anywhere under the SDK holds the API key', () => {
    expect(collectEnumerableStrings(sdk)).not.toContain(API_KEY)
  })

  test('modules do not expose the generated client as an enumerable property', () => {
    expect(Object.keys(sdk.projects)).toEqual([])
    expect(Object.keys(sdk.webhooks)).toEqual([])
    expect(JSON.stringify(sdk.projects)).toBe('{}')
  })

  test('the key is still sent, with the Bearer prefix the facade adds', async () => {
    const server = await startServer((_request, response) => {
      json(response, 200, { data: [], pagination: {} })
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    await terac.projects.list()

    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`)
    await server.close()
  })

  test('an API error carries a redacted summary, never the key', async () => {
    const server = await startServer((_request, response) => {
      json(response, 404, {
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      })
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects
      .retrieve('p1')
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(TeracApiError)
    if (!(error instanceof TeracApiError)) {
      throw new Error('expected a TeracApiError')
    }

    expect(error.request?.headers.authorization).toBe('[redacted]')
    expect(error.request?.headers['content-type']).toBeUndefined()
    expect(error.request?.method).toBe('GET')

    // The three ways an error normally reaches a log.
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(inspect(error, { depth: null })).not.toContain(API_KEY)
    expect(String(error.stack)).not.toContain(API_KEY)
    expect(collectEnumerableStrings(error)).not.toContain(API_KEY)

    await server.close()
  })

  test('a timeout error carries a redacted summary, never the key', async () => {
    const server = await startServer(() => {
      // Never answers.
    })
    const terac = new TeracSdk({
      apiKey: API_KEY,
      baseUrl: server.origin,
      timeoutMs: 30,
    })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(TeracTimeoutError)
    if (!(error instanceof TeracTimeoutError)) {
      throw new Error('expected a TeracTimeoutError')
    }

    expect(error.request?.headers.authorization).toBe('[redacted]')
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(inspect(error, { depth: null })).not.toContain(API_KEY)

    await server.close()
  })

  test('a transport error carries a redacted summary, never the key', async () => {
    const terac = new TeracSdk({
      apiKey: API_KEY,
      // Reserved TLD, so this can never resolve.
      baseUrl: 'https://terac-sdk-does-not-exist.invalid/api/external/v2',
    })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(TeracTransportError)
    if (!(error instanceof TeracTransportError)) {
      throw new Error('expected a TeracTransportError')
    }

    expect(error.request?.headers.authorization).toBe('[redacted]')
    expect(inspect(error, { depth: null })).not.toContain(API_KEY)
    expect(collectEnumerableStrings(error)).not.toContain(API_KEY)
  })

  test('a request that cannot even be built is a transport error', async () => {
    const terac = new TeracSdk({
      apiKey: API_KEY,
      // `new Request()` refuses a URL carrying userinfo.
      baseUrl: 'https://someone:hunter2@terac-sdk-does-not-exist.invalid/v2',
    })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(TeracTransportError)
    expect(inspect(error, { depth: null })).not.toContain(API_KEY)
  })
})
