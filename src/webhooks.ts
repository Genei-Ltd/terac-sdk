/**
 * Inbound webhook verification for Terac.
 *
 * Hand-written: Terac's OpenAPI document describes the `/hooks/*` management
 * endpoints but not the deliveries themselves — no payload schemas, no
 * signature scheme. Everything here comes from the webhooks guide.
 *
 * @see https://terac.com/docs/developers/guides/webhooks
 *
 * This module is a standalone entry point (`@coloop-ai/terac-sdk/webhooks`).
 * It deliberately shares no code with the API client, so a receiver can import
 * it without pulling in the generated client, and so `instanceof` on
 * {@link TeracWebhookVerificationError} means the same thing in both bundles.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** `base64(HMAC-SHA256(secret, timestamp + rawBody))`. */
export const TERAC_SIGNATURE_HEADER = 'x-terac-request-signature'

/** Unix seconds. Part of the signed string, so it changes on each retry. */
export const TERAC_TIMESTAMP_HEADER = 'x-terac-request-timestamp'

/** Unique per delivery and stable across retries. Deduplicate on this. */
export const TERAC_EVENT_ID_HEADER = 'x-event-id'

/** ISO-8601, when the event happened. Stable across retries. Order by this. */
export const TERAC_OCCURRED_AT_HEADER = 'x-timestamp'

/**
 * How far the signed timestamp may be from now, in seconds.
 *
 * A valid signature proves authenticity, never freshness: without a window, a
 * captured delivery replays forever. Terac's own example uses 300 seconds.
 */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300

/** The event type Terac sends when confirming a subscription. */
export const TERAC_PING_EVENT_TYPE = 'webhook.ping'

export type TeracWebhookVerificationFailure =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'duplicate_header'
  | 'malformed_signature'
  | 'malformed_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch'
  | 'malformed_payload'
  | 'missing_event_id'
  | 'event_id_mismatch'
  | 'invalid_secret'
  | 'invalid_tolerance'
  | 'invalid_now'

/**
 * Raised by {@link verifyTeracWebhook}. `reason` says which check failed, so a
 * receiver can log the cause without leaking it in the HTTP response.
 */
export class TeracWebhookVerificationError extends Error {
  public readonly reason: TeracWebhookVerificationFailure

  constructor(reason: TeracWebhookVerificationFailure, message: string) {
    super(message)
    this.name = 'TeracWebhookVerificationError'
    this.reason = reason
  }
}

export const isTeracWebhookVerificationError = (
  error: unknown,
): error is TeracWebhookVerificationError =>
  error instanceof TeracWebhookVerificationError

/**
 * A delivery's envelope.
 *
 * `event_type` is a plain `string`, not a union: the docs say to read
 * `GET /hooks/event-types` because new types ship without a version bump, so a
 * closed enum here would reject events the API considers valid.
 */
export type TeracWebhookEvent = {
  event_type: string
  event_id?: string
  resource_id?: string
  occurred_at?: string
} & Record<string, unknown>

/**
 * A submission status transition. Sent as `submission.status.change` for every
 * transition, and again as `submission.approved` for the approval alone.
 *
 * `from` uses the submission status vocabulary plus `init` (entered, nothing
 * answered) and `screening` (mid-screener). A submission in either of those is
 * not fetchable, which is why they name a `from` and never a `to`.
 */
export type TeracSubmissionStatusChangeEvent = TeracWebhookEvent & {
  event_type: 'submission.status.change' | 'submission.approved'
  resource_id: string
  opportunity_id: string
  from: string
  to: string
}

export const isSubmissionStatusChangeEvent = (
  event: TeracWebhookEvent,
): event is TeracSubmissionStatusChangeEvent =>
  (event.event_type === 'submission.status.change' ||
    event.event_type === 'submission.approved') &&
  typeof event.resource_id === 'string' &&
  typeof event.opportunity_id === 'string' &&
  typeof event.from === 'string' &&
  typeof event.to === 'string'

/** Headers, in any of the shapes a Node or Fetch server hands you. */
export type TeracWebhookHeaders =
  Headers | Record<string, string | string[] | undefined>

/** A verified delivery. */
export type TeracWebhookDeliveryEnvelope = {
  /**
   * Stable across retries. Deduplicate on this before doing any work.
   *
   * The body's signed `event_id` when it has one, and the `X-Event-ID` header
   * only when the body omits it. A header that disagrees with the signed value
   * fails verification.
   */
  eventId: string
  /** The signed Unix-seconds timestamp, as a number. */
  signedAtSeconds: number
  /** `X-Timestamp`, when the event happened. Order by this. */
  occurredAt?: string
  /** The parsed body. */
  event: TeracWebhookEvent
  /** The exact bytes that were verified. */
  rawBody: string
}

export type VerifyTeracWebhookOptions = {
  /**
   * The **raw** request body, exactly as received. Parsing and re-serialising
   * changes the bytes and the signature will not match.
   */
  payload: string | Uint8Array
  headers: TeracWebhookHeaders
  /** The subscription's signing secret (`whsec_…`). */
  secret: string
  /**
   * Seconds of clock skew and delivery latency to tolerate. Defaults to
   * {@link DEFAULT_WEBHOOK_TOLERANCE_SECONDS}. Pass `Infinity` to disable the
   * freshness check, which makes deliveries replayable — only do that if you
   * deduplicate on `eventId` in durable storage.
   *
   * Anything else — `NaN`, `-Infinity`, a negative number, a non-number — is
   * rejected rather than treated as "no window". `Number(process.env.X)` on an
   * unset variable is `NaN`, and silently accepting it would remove replay
   * protection from a misconfigured deployment.
   */
  toleranceSeconds?: number
  /** Current time in milliseconds. Must be finite. Injected by tests. */
  now?: number
}

/**
 * A single header value, rejecting duplicates.
 *
 * Two `X-Terac-Request-Signature` headers are not a valid delivery, and both
 * Node (`req.headers`, comma-joined) and Fetch (`Headers.get`, comma-joined)
 * flatten them into one string. Neither base64 nor a Unix timestamp can
 * legitimately contain a comma, so a comma means a duplicate.
 */
const readSingleHeader = (
  headers: TeracWebhookHeaders,
  name: string,
): string | undefined => {
  if (headers instanceof Headers) {
    const value = headers.get(name)
    if (value === null) {
      return undefined
    }
    if (value.includes(',')) {
      throw new TeracWebhookVerificationError(
        'duplicate_header',
        `Received more than one ${name} header`,
      )
    }
    return value.trim()
  }

  const lowered = name.toLowerCase()
  const matches = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === lowered,
  )

  if (matches.length === 0) {
    return undefined
  }
  if (matches.length > 1) {
    throw new TeracWebhookVerificationError(
      'duplicate_header',
      `Received more than one ${name} header`,
    )
  }

  const value = matches[0]?.[1]
  if (value === undefined) {
    return undefined
  }
  if (Array.isArray(value)) {
    if (value.length > 1) {
      throw new TeracWebhookVerificationError(
        'duplicate_header',
        `Received more than one ${name} header`,
      )
    }
    const single = value[0]
    return single === undefined ? undefined : single.trim()
  }
  if (value.includes(',')) {
    throw new TeracWebhookVerificationError(
      'duplicate_header',
      `Received more than one ${name} header`,
    )
  }
  return value.trim()
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Strict base64.
 *
 * `Buffer.from(value, 'base64')` silently ignores trailing junk and invalid
 * characters, so `"<valid signature>garbage!!"` decodes to the valid signature
 * and would pass verification. Require canonical base64, then confirm the
 * decode round-trips.
 */
const decodeStrictBase64 = (
  value: string,
  reason: TeracWebhookVerificationFailure,
  label: string,
): Buffer => {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new TeracWebhookVerificationError(
      reason,
      `${label} is not valid base64`,
    )
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new TeracWebhookVerificationError(
      reason,
      `${label} is not canonical base64`,
    )
  }

  return decoded
}

/**
 * Verifies a delivery and returns its envelope, or throws
 * {@link TeracWebhookVerificationError}.
 *
 * Verification proves the delivery came from Terac and is recent. It does not
 * prove the delivery is new: deduplicate on `eventId` before acting on it.
 *
 * ```ts
 * const delivery = verifyTeracWebhook({
 *   payload: rawBody,
 *   headers: request.headers,
 *   secret: process.env.TERAC_WEBHOOK_SECRET!,
 * })
 * ```
 */
export const verifyTeracWebhook = ({
  payload,
  headers,
  secret,
  toleranceSeconds = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  now = Date.now(),
}: VerifyTeracWebhookOptions): TeracWebhookDeliveryEnvelope => {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TeracWebhookVerificationError(
      'invalid_secret',
      'A non-empty signing secret is required',
    )
  }

  // Fail closed. `NaN` and `-Infinity` would both skip the freshness check
  // below exactly like the intentional `Infinity` escape hatch, so a bad
  // configuration value would silently disable replay protection.
  if (
    typeof toleranceSeconds !== 'number' ||
    !(
      toleranceSeconds === Number.POSITIVE_INFINITY ||
      (Number.isFinite(toleranceSeconds) && toleranceSeconds >= 0)
    )
  ) {
    throw new TeracWebhookVerificationError(
      'invalid_tolerance',
      'toleranceSeconds must be a non-negative finite number, or Infinity to disable the freshness check',
    )
  }

  // A non-finite `now` makes every age comparison pass.
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TeracWebhookVerificationError(
      'invalid_now',
      'now must be a finite number of milliseconds',
    )
  }

  const signature = readSingleHeader(headers, TERAC_SIGNATURE_HEADER)
  if (signature === undefined || signature.length === 0) {
    throw new TeracWebhookVerificationError(
      'missing_signature',
      `Missing ${TERAC_SIGNATURE_HEADER} header`,
    )
  }

  const timestamp = readSingleHeader(headers, TERAC_TIMESTAMP_HEADER)
  if (timestamp === undefined || timestamp.length === 0) {
    throw new TeracWebhookVerificationError(
      'missing_timestamp',
      `Missing ${TERAC_TIMESTAMP_HEADER} header`,
    )
  }

  if (!/^\d+$/.test(timestamp)) {
    throw new TeracWebhookVerificationError(
      'malformed_timestamp',
      `${TERAC_TIMESTAMP_HEADER} must be Unix seconds`,
    )
  }

  const signedAtSeconds = Number(timestamp)
  if (!Number.isSafeInteger(signedAtSeconds)) {
    throw new TeracWebhookVerificationError(
      'malformed_timestamp',
      `${TERAC_TIMESTAMP_HEADER} is out of range`,
    )
  }

  if (Number.isFinite(toleranceSeconds)) {
    const ageSeconds = Math.abs(now / 1000 - signedAtSeconds)
    if (ageSeconds > toleranceSeconds) {
      throw new TeracWebhookVerificationError(
        'timestamp_out_of_tolerance',
        `Delivery is ${String(Math.round(ageSeconds))}s away from now, outside the ${String(toleranceSeconds)}s tolerance`,
      )
    }
  }

  // The signed string is the timestamp header concatenated with the raw body,
  // with no separator. Feed the timestamp and the ORIGINAL bytes to the HMAC
  // separately: decoding first would replace any invalid UTF-8 sequence with
  // U+FFFD, and the digest would then cover bytes the sender never sent.
  const bodyBytes =
    typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload

  const expected = createHmac('sha256', secret)
    .update(timestamp, 'utf-8')
    .update(bodyBytes)
    .digest()

  const provided = decodeStrictBase64(
    signature,
    'malformed_signature',
    TERAC_SIGNATURE_HEADER,
  )

  // `timingSafeEqual` throws when the lengths differ, so compare lengths first
  // and keep the comparison itself constant-time.
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new TeracWebhookVerificationError(
      'signature_mismatch',
      'Signature does not match the request body',
    )
  }

  // Only now, with the bytes proven authentic, decode them for JSON.
  const rawBody =
    typeof payload === 'string'
      ? payload
      : Buffer.from(payload).toString('utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch (cause) {
    throw new TeracWebhookVerificationError(
      'malformed_payload',
      `Body is not valid JSON: ${cause instanceof Error ? cause.message : 'unknown error'}`,
    )
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof Reflect.get(parsed, 'event_type') !== 'string'
  ) {
    throw new TeracWebhookVerificationError(
      'malformed_payload',
      'Body is not a Terac webhook event',
    )
  }

  const event: TeracWebhookEvent = Object.assign(
    { event_type: String(Reflect.get(parsed, 'event_type')) },
    parsed,
  )

  // The HMAC covers the timestamp and the body, never `X-Event-ID`. So when
  // the body carries a signed `event_id`, that value wins and the header must
  // agree with it: letting an unsigned header decide would let a captured
  // delivery be replayed under a fresh id, straight past deduplication.
  const headerEventId = readSingleHeader(headers, TERAC_EVENT_ID_HEADER)
  const signedEventId =
    typeof event.event_id === 'string' && event.event_id.length > 0
      ? event.event_id
      : undefined

  if (
    signedEventId !== undefined &&
    headerEventId !== undefined &&
    headerEventId.length > 0 &&
    headerEventId !== signedEventId
  ) {
    throw new TeracWebhookVerificationError(
      'event_id_mismatch',
      `${TERAC_EVENT_ID_HEADER} does not match the signed event_id in the body`,
    )
  }

  const eventId = signedEventId ?? headerEventId
  if (typeof eventId !== 'string' || eventId.length === 0) {
    throw new TeracWebhookVerificationError(
      'missing_event_id',
      `Missing ${TERAC_EVENT_ID_HEADER} header, which deduplication depends on`,
    )
  }

  const occurredAt =
    readSingleHeader(headers, TERAC_OCCURRED_AT_HEADER) ??
    (typeof event.occurred_at === 'string' ? event.occurred_at : undefined)

  return {
    eventId,
    signedAtSeconds,
    ...(occurredAt === undefined ? {} : { occurredAt }),
    event,
    rawBody,
  }
}
