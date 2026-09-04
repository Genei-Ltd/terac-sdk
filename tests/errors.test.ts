import { inspect } from 'node:util'
import { describe, expect, test } from 'vitest'
import {
  TeracApiError,
  TeracError,
  TeracRateLimitError,
  TeracResponseError,
  TeracSdk,
  TeracTransportError,
  isTeracApiError,
  isTeracError,
  isTeracRateLimitError,
  isTeracResponseError,
  isTeracTransportError,
  parseTeracErrorBody,
} from '../src/index'
import { json, startServer } from './helpers/server'

const API_KEY = 'tk_errors'

describe('error classification', () => {
  test('a non-2xx response becomes a TeracApiError with the nested fields', async () => {
    const server = await startServer((_request, response) => {
      json(response, 400, {
        error: {
          code: 'BAD_REQUEST',
          message: 'Unknown filter slug: single_select--invalid',
          details: [{ field: 'filters[0]', message: 'Unknown filter slug' }],
        },
      })
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(isTeracApiError(error)).toBe(true)
    if (!(error instanceof TeracApiError)) {
      throw new Error('expected a TeracApiError')
    }

    expect(error.status).toBe(400)
    expect(error.code).toBe('BAD_REQUEST')
    expect(error.message).toBe('Unknown filter slug: single_select--invalid')
    expect(error.details).toEqual([
      { field: 'filters[0]', message: 'Unknown filter slug' },
    ])
    expect(error).toBeInstanceOf(TeracError)
    expect(error).not.toBeInstanceOf(TeracRateLimitError)

    await server.close()
  })

  test('a 429 becomes a TeracRateLimitError and keeps any headers present', async () => {
    const server = await startServer((_request, response) => {
      json(
        response,
        429,
        { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        { 'retry-after': '17' },
      )
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(isTeracRateLimitError(error)).toBe(true)
    if (!(error instanceof TeracRateLimitError)) {
      throw new Error('expected a TeracRateLimitError')
    }

    expect(error.status).toBe(429)
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.retryAfterSeconds).toBe(17)
    expect(error.responseHeaders['retry-after']).toBe('17')
    // A rate-limit error is still an API error.
    expect(error).toBeInstanceOf(TeracApiError)

    await server.close()
  })

  test('a 429 without Retry-After leaves retryAfterSeconds undefined', async () => {
    const server = await startServer((_request, response) => {
      json(response, 429, {
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      })
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    if (!(error instanceof TeracRateLimitError)) {
      throw new Error('expected a TeracRateLimitError')
    }
    // Terac documents no Retry-After, so this must not be invented.
    expect(error.retryAfterSeconds).toBeUndefined()

    await server.close()
  })

  test('invalid JSON on a 200 becomes a TeracResponseError, not an API error', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"data": [')
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(isTeracResponseError(error)).toBe(true)
    if (!(error instanceof TeracResponseError)) {
      throw new Error('expected a TeracResponseError')
    }

    expect(error.status).toBe(200)
    expect(error).not.toBeInstanceOf(TeracApiError)
    // The useful error is the cause, not something buried in a payload.
    expect(error.cause).toBeInstanceOf(SyntaxError)

    await server.close()
  })

  test('a network failure becomes a TeracTransportError with the cause kept', async () => {
    const terac = new TeracSdk({
      apiKey: API_KEY,
      baseUrl: 'https://terac-sdk-nowhere.invalid/api/external/v2',
    })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(isTeracTransportError(error)).toBe(true)
    if (!(error instanceof TeracTransportError)) {
      throw new Error('expected a TeracTransportError')
    }

    expect(error).not.toBeInstanceOf(TeracApiError)
    expect(error).not.toBeInstanceOf(TeracResponseError)
    expect(error.cause).toBeDefined()
    expect(isTeracError(error)).toBe(true)
  })

  test('a connection reset mid-body is a transport error, not a 200', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': '4096',
      })
      response.write('{"data":')
      response.destroy()
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(TeracTransportError)

    await server.close()
  })

  test('an error body with no message falls back to the status line', async () => {
    const server = await startServer((_request, response) => {
      json(response, 503, {})
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    if (!(error instanceof TeracApiError)) {
      throw new Error('expected a TeracApiError')
    }
    expect(error.message).toContain('503')
    expect(error.code).toBeUndefined()

    await server.close()
  })
})

describe('response header redaction', () => {
  test('keeps every name, and only allow-listed values', async () => {
    const server = await startServer((request, response) => {
      json(
        response,
        429,
        { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        {
          'retry-after': '11',
          'x-ratelimit-remaining': '0',
          'x-request-id': 'req_visible',
          // A proxy that echoes the inbound credential back. A block-list of
          // known credential headers would not catch this name, and the value
          // would end up in `responseHeaders` and in every rendering of the
          // error.
          'x-debug-authorization': String(request.headers.authorization),
          'set-cookie': 'session=leak',
        },
      )
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects.list().catch((thrown: unknown) => thrown)
    if (!(error instanceof TeracApiError)) {
      throw new Error('expected a TeracApiError')
    }

    // Useful values survive.
    expect(error.responseHeaders['retry-after']).toBe('11')
    expect(error.responseHeaders['x-ratelimit-remaining']).toBe('0')
    expect(error.responseHeaders['x-request-id']).toBe('req_visible')
    expect(error.responseHeaders['content-type']).toContain('application/json')

    // Everything else keeps its NAME and loses its value.
    expect(error.responseHeaders).toHaveProperty('x-debug-authorization')
    expect(error.responseHeaders['x-debug-authorization']).toBe('[redacted]')
    expect(error.responseHeaders['set-cookie']).toBe('[redacted]')

    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(inspect(error, { depth: null })).not.toContain(API_KEY)

    await server.close()
  })
})

describe('parseTeracErrorBody', () => {
  test('reads the nested shape the API actually returns', () => {
    expect(
      parseTeracErrorBody({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      }),
    ).toEqual({ code: 'NOT_FOUND', message: 'Resource not found' })
  })

  test('tolerates the flat shape the published spec declares', () => {
    expect(
      parseTeracErrorBody({
        code: 'BAD_REQUEST',
        message: 'Invalid input data',
        issues: [{ message: 'bad' }],
      }),
    ).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid input data',
      details: [{ message: 'bad' }],
    })
  })

  test('returns nothing useful for a body that is not an error envelope', () => {
    expect(parseTeracErrorBody(null)).toEqual({})
    expect(parseTeracErrorBody(42)).toEqual({})
    expect(parseTeracErrorBody('  ')).toEqual({})
    expect(parseTeracErrorBody('boom')).toEqual({ message: 'boom' })
  })
})
