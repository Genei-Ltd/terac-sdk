/**
 * The fetch wrapper every {@link TeracSdk} request goes through.
 *
 * It exists for two reasons the generated client cannot cover:
 *
 * 1. **Redirects are refused.** Node forwards an `Authorization` header across
 *    a redirect, so following one would hand the API key to whatever host
 *    Terac redirected to. Every request is issued with `redirect: 'error'`.
 * 2. **The timeout covers the body.** A deadline that is cleared when the
 *    response headers arrive does nothing about a server that then stalls the
 *    body. The whole body is buffered while the abort signal is still armed,
 *    and the buffered copy is handed back as a fresh `Response`.
 */
import {
  TeracTimeoutError,
  TeracTransportError,
  isTeracError,
  summarizeRequest,
} from './errors'

/**
 * The global `fetch` signature, which is what the generated client's `fetch`
 * option expects. The client only ever calls it with a single `Request`.
 */
export type TeracFetch = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>

export type CreateTeracFetchOptions = {
  /** Milliseconds until the request is aborted. Omit for no deadline. */
  timeoutMs?: number
  /** Underlying fetch. Injected by the tests; defaults to `globalThis.fetch`. */
  fetch?: TeracFetch
}

/**
 * Re-reads the response into memory and rebuilds it, so nothing downstream can
 * be left waiting on a stalled stream after the deadline is cleared.
 */
const bufferResponse = async (response: Response): Promise<Response> => {
  const headers = new Headers(response.headers)
  // The body was decoded on the way in; the original framing headers no longer
  // describe the bytes we are about to hand back.
  headers.delete('content-encoding')

  // 204/205/304 must not carry a body.
  if (
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    headers.delete('content-length')
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  const body = await response.arrayBuffer()
  headers.set('content-length', String(body.byteLength))

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const createTeracFetch = ({
  timeoutMs,
  fetch: underlyingFetch,
}: CreateTeracFetchOptions = {}): TeracFetch => {
  const doFetch: TeracFetch =
    underlyingFetch ?? ((input, init) => globalThis.fetch(input, init))

  return async (input, init) => {
    const request =
      input instanceof Request && init === undefined
        ? input
        : new Request(input, init)

    const controller = new AbortController()
    const callerSignal = request.signal
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // Forward the caller's abort, keeping `signal.reason` intact so
    // `AbortSignal.timeout()` and a custom `controller.abort(reason)` both
    // surface the reason the caller chose.
    const forwardAbort = () => {
      controller.abort(callerSignal.reason)
    }

    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason)
    } else {
      callerSignal.addEventListener('abort', forwardAbort, { once: true })
    }

    const finalRequest = new Request(request, {
      signal: controller.signal,
      redirect: 'error',
    })
    const summary = summarizeRequest(finalRequest)

    if (timeoutMs !== undefined && !controller.signal.aborted) {
      // Abort WITH the error we want to raise, so the catch below identifies a
      // deadline by the reason rather than by a flag a closure has to keep in
      // sync.
      const timeoutError = new TeracTimeoutError({
        timeoutMs,
        request: summary,
      })
      timeoutId = setTimeout(() => {
        controller.abort(timeoutError)
      }, timeoutMs)
    }

    try {
      const response = await doFetch(finalRequest)
      // Still inside the deadline: a stalled body aborts here.
      return await bufferResponse(response)
    } catch (error) {
      const abortReason: unknown = controller.signal.reason

      if (abortReason instanceof TeracTimeoutError) {
        throw abortReason
      }

      if (callerSignal.aborted) {
        // The caller's reason, exactly as given. No `??` fallback: a caller
        // who aborts with `null`, `''`, `0` or `false` gets that value back,
        // because the documented guarantee is identity, not truthiness.
        // `signal.reason` is never `undefined` once `aborted` is true —
        // `abort()` with no argument fills in an `AbortError`.
        throw callerSignal.reason
      }

      if (isTeracError(error)) {
        throw error
      }

      throw new TeracTransportError({ request: summary, cause: error })
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      callerSignal.removeEventListener('abort', forwardAbort)
    }
  }
}
