import {
  TeracSdk,
  isTeracApiError,
  isTeracRateLimitError,
  isTeracResponseError,
  isTeracTimeoutError,
  isTeracTransportError,
} from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

const terac = new TeracSdk({ apiKey, timeoutMs: 15_000 })

try {
  await terac.opportunities.launch('opp_does_not_exist')
} catch (error) {
  if (isTeracRateLimitError(error)) {
    // 100 requests per minute per key. Terac documents no Retry-After, so
    // `retryAfterSeconds` is populated only when a header is actually present.
    console.warn(
      `rate limited; retry after ${String(error.retryAfterSeconds ?? 60)}s`,
    )
  } else if (isTeracApiError(error)) {
    // The server answered. `status` is a status Terac really sent.
    console.error(
      `${String(error.status)} ${error.code ?? ''}: ${error.message}`,
    )
    for (const detail of error.details ?? []) {
      console.error(`  ${detail.field ?? 'body'}: ${detail.message}`)
    }
  } else if (isTeracTimeoutError(error)) {
    // The deadline covers reading the body, not just the headers. Retryable.
    console.warn(`timed out after ${String(error.timeoutMs)}ms`)
  } else if (isTeracTransportError(error)) {
    // No usable response: DNS, TLS, a reset, or a redirect the SDK refuses.
    console.error('could not reach Terac', error.cause)
  } else if (isTeracResponseError(error)) {
    // Terac answered successfully with a body that could not be decoded.
    console.error('undecodable response', error.cause)
  } else {
    throw error
  }
}
