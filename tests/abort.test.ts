import { describe, expect, test } from 'vitest'
import { TeracSdk, TeracTimeoutError } from '../src/index'
import { json, startServer } from './helpers/server'

const API_KEY = 'tk_abort'

describe('caller-supplied AbortSignal', () => {
  test('aborting mid-flight rejects with the caller reason', async () => {
    const server = await startServer(() => {
      // Never answers.
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const reason = new Error('caller changed their mind')
    const controller = new AbortController()
    const pending = terac.projects.list(undefined, {
      signal: controller.signal,
    })
    setTimeout(() => {
      controller.abort(reason)
    }, 20)

    await expect(pending).rejects.toBe(reason)
    await server.close()
  })

  test('an already-aborted signal rejects immediately with its reason', async () => {
    const server = await startServer((_request, response) => {
      json(response, 200, { data: [], pagination: {} })
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const reason = new Error('too late')
    const controller = new AbortController()
    controller.abort(reason)

    await expect(
      terac.projects.list(undefined, { signal: controller.signal }),
    ).rejects.toBe(reason)
    expect(server.requests).toHaveLength(0)

    await server.close()
  })

  test('AbortSignal.timeout surfaces its own TimeoutError reason', async () => {
    const server = await startServer(() => {
      // Never answers.
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const error = await terac.projects
      .list(undefined, { signal: AbortSignal.timeout(30) })
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(DOMException)
    if (!(error instanceof DOMException)) {
      throw new Error('expected a DOMException')
    }
    expect(error.name).toBe('TimeoutError')
    // The caller's signal wins over the SDK's own timeout classification.
    expect(error).not.toBeInstanceOf(TeracTimeoutError)

    await server.close()
  })

  // The guarantee is identity, not truthiness. A falsy reason used to be lost
  // twice over: `reason ?? error` in the fetch wrapper, and the generated
  // client's `finalError || {}` on anything the error interceptor RETURNED.
  describe.each([
    ['an empty string', ''],
    ['zero', 0],
    ['false', false],
    ['null', null],
  ])('a falsy abort reason (%s)', (_name, reason) => {
    test('survives an abort before dispatch', async () => {
      const server = await startServer((_request, response) => {
        json(response, 200, { data: [], pagination: {} })
      })
      const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

      const controller = new AbortController()
      controller.abort(reason)

      const settled = await terac.projects
        .list(undefined, { signal: controller.signal })
        .then(
          () => ({ rejected: false, error: undefined }),
          (error: unknown) => ({ rejected: true, error }),
        )

      expect(settled.rejected).toBe(true)
      expect(settled.error).toBe(reason)
      expect(server.requests).toHaveLength(0)

      await server.close()
    })

    test('survives an abort mid-flight', async () => {
      const server = await startServer(() => {
        // Never answers.
      })
      const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

      const controller = new AbortController()
      const pending = terac.projects.list(undefined, {
        signal: controller.signal,
      })
      setTimeout(() => {
        controller.abort(reason)
      }, 20)

      const settled = await pending.then(
        () => ({ rejected: false, error: undefined }),
        (error: unknown) => ({ rejected: true, error }),
      )

      expect(settled.rejected).toBe(true)
      expect(settled.error).toBe(reason)

      await server.close()
    })
  })

  test('the signal reaches every operation shape', async () => {
    const server = await startServer(() => {
      // Never answers.
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const reason = new Error('cancelled')
    const controller = new AbortController()
    controller.abort(reason)
    const signal = controller.signal

    await Promise.all([
      // No arguments before the options.
      expect(terac.filters.list({ signal })).rejects.toBe(reason),
      // A path parameter.
      expect(terac.projects.retrieve('p1', { signal })).rejects.toBe(reason),
      // A body.
      expect(terac.projects.create({ name: 'x' }, { signal })).rejects.toBe(
        reason,
      ),
      // Path plus body.
      expect(
        terac.projects.update('p1', { name: 'y' }, { signal }),
      ).rejects.toBe(reason),
      // A defaulted body.
      expect(terac.opportunities.launch('o1', { signal })).rejects.toBe(reason),
      // Path plus query.
      expect(
        terac.submissions.list('o1', { limit: 5 }, { signal }),
      ).rejects.toBe(reason),
    ])

    expect(server.requests).toHaveLength(0)
    await server.close()
  })
})
