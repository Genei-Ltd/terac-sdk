/**
 * Error types raised by {@link TeracSdk}.
 *
 * Four distinct failure modes, so a caller can tell them apart without
 * inspecting a message string:
 *
 * - {@link TeracApiError} — the server answered, with a non-2xx status.
 * - {@link TeracRateLimitError} — the same, narrowed to `429 RATE_LIMITED`.
 * - {@link TeracTransportError} — no usable response (DNS, TLS, connection
 *   reset, or a redirect the SDK refuses to follow).
 * - {@link TeracResponseError} — the server answered successfully but the body
 *   could not be decoded.
 * - {@link TeracTimeoutError} — the configured `timeoutMs` elapsed.
 *
 * None of them carry the `Request`, the `Response` or the API key. They carry a
 * {@link TeracRequestSummary}: method, URL and header NAMES, with every header
 * value redacted unless it is on a short transport allow-list.
 */

/** Header values that are safe to reproduce in an error. */
const REPRODUCIBLE_HEADER_NAMES = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'content-length',
  'content-type',
  'user-agent',
])

export const REDACTED = '[redacted]'

/**
 * A request, reduced to what is useful in a log and safe to put there.
 *
 * `headers` keeps every header NAME, because knowing that `authorization` was
 * sent is useful, and replaces the value with {@link REDACTED} unless the
 * header is a transport header whose value carries no secret.
 */
export type TeracRequestSummary = {
  method: string
  url: string
  headers: Record<string, string>
}

const redactHeaders = (headers: Headers): Record<string, string> => {
  const redacted: Record<string, string> = {}
  headers.forEach((value, name) => {
    redacted[name] = REPRODUCIBLE_HEADER_NAMES.has(name.toLowerCase())
      ? value
      : REDACTED
  })
  return redacted
}

/** Builds the only representation of a request this SDK ever exposes. */
export const summarizeRequest = (request: Request): TeracRequestSummary => ({
  method: request.method,
  // `new Request()` rejects a URL carrying userinfo, so a request URL can
  // never hold credentials, and Terac takes no secrets in query parameters.
  url: request.url,
  headers: redactHeaders(request.headers),
})

/**
 * Header names on a RESPONSE that may carry a credential.
 *
 * Response headers are the server's, not ours, and they carry the useful
 * rate-limit signals, so these are redacted by exception rather than by
 * allow-list.
 */
const SENSITIVE_RESPONSE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authenticate',
  'set-cookie',
  'www-authenticate',
])

/** Response headers, with any credential-bearing header redacted. */
export const summarizeResponseHeaders = (
  response: Response,
): Record<string, string> => {
  const summarized: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    summarized[name] = SENSITIVE_RESPONSE_HEADER_NAMES.has(name.toLowerCase())
      ? REDACTED
      : value
  })
  return summarized
}

export type TeracErrorOptions = {
  request?: TeracRequestSummary
  cause?: unknown
}

/** Base class for every error this SDK raises from an API call. */
export class TeracError extends Error {
  /** The failing request, with credentials redacted. */
  public readonly request?: TeracRequestSummary

  constructor(message: string, options: TeracErrorOptions = {}) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'TeracError'
    if (options.request) {
      this.request = options.request
    }
  }
}

export const isTeracError = (error: unknown): error is TeracError =>
  error instanceof TeracError

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** One entry of the optional `error.details` array. */
export type TeracErrorDetail = {
  field?: string
  message: string
}

type ParsedErrorBody = {
  code?: string
  message?: string
  details?: TeracErrorDetail[]
}

/**
 * Terac returns `{ "error": { "code", "message", "details"? } }`. The published
 * OpenAPI document declares a flat `{ message, code, issues }` instead, which
 * the live API never sends; `scripts/update-schema.ts` rewrites it during
 * vendoring. This parser reads the real shape and tolerates the declared one.
 *
 * @see https://terac.com/docs/developers/guides/errors
 */
export const parseTeracErrorBody = (payload: unknown): ParsedErrorBody => {
  const envelope =
    isRecord(payload) && isRecord(payload.error) ? payload.error : payload

  if (!isRecord(envelope)) {
    const asString = toNonEmptyString(payload)
    return asString === undefined ? {} : { message: asString }
  }

  const parsed: ParsedErrorBody = {}

  const code = toNonEmptyString(envelope.code)
  if (code !== undefined) {
    parsed.code = code
  }

  const message = toNonEmptyString(envelope.message)
  if (message !== undefined) {
    parsed.message = message
  }

  const rawDetails = envelope.details ?? envelope.issues
  if (Array.isArray(rawDetails)) {
    const details: TeracErrorDetail[] = []
    for (const entry of rawDetails) {
      if (!isRecord(entry)) {
        continue
      }
      const detailMessage = toNonEmptyString(entry.message)
      if (detailMessage === undefined) {
        continue
      }
      const field = toNonEmptyString(entry.field)
      details.push(
        field === undefined
          ? { message: detailMessage }
          : { field, message: detailMessage },
      )
    }
    if (details.length > 0) {
      parsed.details = details
    }
  }

  return parsed
}

export type TeracApiErrorOptions = {
  status: number
  statusText: string
  payload: unknown
  request?: TeracRequestSummary
  responseHeaders?: Record<string, string>
}

/**
 * Raised when Terac answers with a non-2xx status. Never raised for a
 * transport failure or a decoding failure — those have their own classes, so
 * `error.status` is always a status the server really sent.
 */
export class TeracApiError extends TeracError {
  public readonly status: number
  public readonly statusText: string
  /** Terac's machine-readable code, for example `NOT_FOUND` or `CONFLICT`. */
  public readonly code?: string
  /** Field-level validation errors, when Terac attributes the failure. */
  public readonly details?: TeracErrorDetail[]
  /** The decoded response body, exactly as received. */
  public readonly payload: unknown
  public readonly responseHeaders: Record<string, string>

  constructor(options: TeracApiErrorOptions) {
    const parsed = parseTeracErrorBody(options.payload)
    const summary = [
      'Terac request failed with status',
      String(options.status),
      options.statusText ? `(${options.statusText})` : '',
    ]
      .filter(Boolean)
      .join(' ')

    super(parsed.message ?? summary, { request: options.request })
    this.name = 'TeracApiError'
    this.status = options.status
    this.statusText = options.statusText
    this.payload = options.payload
    this.responseHeaders = options.responseHeaders ?? {}
    if (parsed.code !== undefined) {
      this.code = parsed.code
    }
    if (parsed.details !== undefined) {
      this.details = parsed.details
    }
  }
}

export const isTeracApiError = (error: unknown): error is TeracApiError =>
  error instanceof TeracApiError

/**
 * Raised for `429 RATE_LIMITED`. Terac allows 100 requests per minute per API
 * key and does not document a `Retry-After`, so `retryAfterSeconds` is
 * populated only when the response actually carries one.
 *
 * @see https://terac.com/docs/developers/guides/authentication
 */
export class TeracRateLimitError extends TeracApiError {
  /** Seconds to wait, when Terac sends `Retry-After`. Usually absent. */
  public readonly retryAfterSeconds?: number

  constructor(options: TeracApiErrorOptions) {
    super(options)
    this.name = 'TeracRateLimitError'

    const rawRetryAfter = options.responseHeaders?.['retry-after']
    if (rawRetryAfter !== undefined) {
      const seconds = Number(rawRetryAfter)
      if (Number.isFinite(seconds) && seconds >= 0) {
        this.retryAfterSeconds = seconds
      }
    }
  }
}

export const isTeracRateLimitError = (
  error: unknown,
): error is TeracRateLimitError => error instanceof TeracRateLimitError

/**
 * Raised when the request never produced a usable response: DNS failure, TLS
 * failure, connection reset, or a redirect. This SDK sets `redirect: 'error'`,
 * because Node forwards an `Authorization` header across a same-origin
 * redirect and the API key must not reach a host Terac redirected to.
 */
export class TeracTransportError extends TeracError {
  constructor(options: TeracErrorOptions & { message?: string } = {}) {
    super(options.message ?? 'Terac request failed before a response arrived', {
      request: options.request,
      cause: options.cause,
    })
    this.name = 'TeracTransportError'
  }
}

export const isTeracTransportError = (
  error: unknown,
): error is TeracTransportError => error instanceof TeracTransportError

export type TeracResponseErrorOptions = TeracErrorOptions & {
  status: number
}

/**
 * Raised when Terac answered with a success status but the body could not be
 * decoded — malformed JSON on a `200`, for example. The original `SyntaxError`
 * is the `cause`.
 */
export class TeracResponseError extends TeracError {
  public readonly status: number

  constructor(options: TeracResponseErrorOptions) {
    super(
      `Terac returned status ${String(options.status)} with a body that could not be decoded`,
      { request: options.request, cause: options.cause },
    )
    this.name = 'TeracResponseError'
    this.status = options.status
  }
}

export const isTeracResponseError = (
  error: unknown,
): error is TeracResponseError => error instanceof TeracResponseError

export type TeracTimeoutErrorOptions = {
  timeoutMs: number
  request?: TeracRequestSummary
}

/**
 * Raised when a request exceeds the configured `timeoutMs`. The deadline
 * covers reading the response body, not just the response headers, so a server
 * that sends headers and then stalls still trips it. Treat it as retryable.
 */
export class TeracTimeoutError extends TeracError {
  public readonly timeoutMs: number

  constructor({ timeoutMs, request }: TeracTimeoutErrorOptions) {
    super(
      `Terac request aborted after exceeding timeout of ${String(timeoutMs)}ms`,
      { request },
    )
    this.name = 'TeracTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export const isTeracTimeoutError = (
  error: unknown,
): error is TeracTimeoutError => error instanceof TeracTimeoutError
