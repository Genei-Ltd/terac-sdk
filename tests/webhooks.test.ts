import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  TERAC_EVENT_ID_HEADER,
  TERAC_OCCURRED_AT_HEADER,
  TERAC_PING_EVENT_TYPE,
  TERAC_SIGNATURE_HEADER,
  TERAC_TIMESTAMP_HEADER,
  TeracWebhookVerificationError,
  isSubmissionStatusChangeEvent,
  isTeracWebhookVerificationError,
  verifyTeracWebhook,
} from '../src/webhooks'

const SECRET = 'whsec_9f8e7d6c5b4a3210'
const NOW_MS = 1_786_000_000_000
const TIMESTAMP = String(Math.floor(NOW_MS / 1000))

const EVENT = {
  event_type: 'submission.status.change',
  event_id: 'dlv_7h3k9',
  resource_id: 'sub_abc123',
  occurred_at: '2026-08-11T21:00:00.000Z',
  opportunity_id: 'fy8auvdlx7ei5y5jdiy7w35z',
  from: 'screening',
  to: 'screened_out',
}

const RAW_BODY = JSON.stringify(EVENT)

/** Signs exactly as the guide describes: timestamp + raw body, no separator. */
const sign = (timestamp: string, body: string, secret = SECRET): string =>
  createHmac('sha256', secret)
    .update(timestamp + body)
    .digest('base64')

const validHeaders = (
  overrides: Record<string, string | string[] | undefined> = {},
): Record<string, string | string[] | undefined> => ({
  [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, RAW_BODY),
  [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
  [TERAC_EVENT_ID_HEADER]: 'dlv_7h3k9',
  [TERAC_OCCURRED_AT_HEADER]: '2026-08-11T21:00:00.000Z',
  ...overrides,
})

const verify = (
  headers: Record<string, string | string[] | undefined> | Headers,
  payload: string | Uint8Array = RAW_BODY,
  toleranceSeconds?: number,
) =>
  verifyTeracWebhook({
    payload,
    headers,
    secret: SECRET,
    now: NOW_MS,
    ...(toleranceSeconds === undefined ? {} : { toleranceSeconds }),
  })

const expectFailure = (
  run: () => unknown,
  reason: string,
): TeracWebhookVerificationError => {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(isTeracWebhookVerificationError(thrown)).toBe(true)
  if (!(thrown instanceof TeracWebhookVerificationError)) {
    throw new Error('expected a TeracWebhookVerificationError')
  }
  expect(thrown.reason).toBe(reason)
  return thrown
}

describe('verifyTeracWebhook', () => {
  test('accepts a correctly signed delivery', () => {
    const delivery = verify(validHeaders())
    expect(delivery.eventId).toBe('dlv_7h3k9')
    expect(delivery.signedAtSeconds).toBe(Number(TIMESTAMP))
    expect(delivery.occurredAt).toBe('2026-08-11T21:00:00.000Z')
    expect(delivery.event.event_type).toBe('submission.status.change')
    expect(delivery.rawBody).toBe(RAW_BODY)
  })

  test('accepts a Headers instance as well as a plain object', () => {
    const headers = new Headers()
    headers.set(TERAC_SIGNATURE_HEADER, sign(TIMESTAMP, RAW_BODY))
    headers.set(TERAC_TIMESTAMP_HEADER, TIMESTAMP)
    headers.set(TERAC_EVENT_ID_HEADER, 'dlv_7h3k9')

    expect(verify(headers).eventId).toBe('dlv_7h3k9')
  })

  test('accepts raw bytes, not just a string', () => {
    expect(verify(validHeaders(), Buffer.from(RAW_BODY, 'utf-8')).eventId).toBe(
      'dlv_7h3k9',
    )
  })

  test('accepts the confirmation ping', () => {
    const pingBody = JSON.stringify({
      event_type: TERAC_PING_EVENT_TYPE,
      event_id: 'png_1',
    })
    const delivery = verify(
      {
        [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, pingBody),
        [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
        [TERAC_EVENT_ID_HEADER]: 'png_1',
      },
      pingBody,
    )
    expect(delivery.event.event_type).toBe(TERAC_PING_EVENT_TYPE)
  })

  test('rejects a body altered after signing', () => {
    expectFailure(
      () => verify(validHeaders(), `${RAW_BODY} `),
      'signature_mismatch',
    )
  })

  test('rejects a signature made with a different secret', () => {
    expectFailure(
      () =>
        verify(
          validHeaders({
            [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, RAW_BODY, 'whsec_other'),
          }),
        ),
      'signature_mismatch',
    )
  })

  test('rejects a re-serialised body, because the bytes change', () => {
    // The docs are explicit: parsing and re-serialising changes the bytes.
    const reserialized = JSON.stringify(JSON.parse(RAW_BODY), null, 2)
    expect(reserialized).not.toBe(RAW_BODY)
    expectFailure(
      () => verify(validHeaders(), reserialized),
      'signature_mismatch',
    )
  })

  describe('strict base64', () => {
    test('rejects a valid signature with trailing junk appended', () => {
      // `Buffer.from(value, 'base64')` ignores trailing junk, so a lenient
      // decode would accept this.
      const signature = sign(TIMESTAMP, RAW_BODY)
      expect(
        Buffer.from(`${signature}!!!!`, 'base64').equals(
          Buffer.from(signature, 'base64'),
        ),
      ).toBe(true)

      expectFailure(
        () =>
          verify(
            validHeaders({ [TERAC_SIGNATURE_HEADER]: `${signature}!!!!` }),
          ),
        'malformed_signature',
      )
    })

    test('rejects whitespace inside the signature', () => {
      const signature = sign(TIMESTAMP, RAW_BODY)
      expectFailure(
        () =>
          verify(
            validHeaders({
              [TERAC_SIGNATURE_HEADER]: `${signature.slice(0, 8)} ${signature.slice(8)}`,
            }),
          ),
        'malformed_signature',
      )
    })

    test('rejects a non-canonical length', () => {
      expectFailure(
        () => verify(validHeaders({ [TERAC_SIGNATURE_HEADER]: 'abcde' })),
        'malformed_signature',
      )
    })

    test('rejects base64url, which Terac does not send', () => {
      const signature = sign(TIMESTAMP, RAW_BODY)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
      if (signature === sign(TIMESTAMP, RAW_BODY)) {
        // This signature happened to contain no + or /; nothing to assert.
        return
      }
      expectFailure(
        () => verify(validHeaders({ [TERAC_SIGNATURE_HEADER]: signature })),
        'malformed_signature',
      )
    })
  })

  describe('duplicate headers', () => {
    test('rejects two signature headers sent as an array', () => {
      expectFailure(
        () =>
          verify(
            validHeaders({
              [TERAC_SIGNATURE_HEADER]: [
                sign(TIMESTAMP, RAW_BODY),
                sign(TIMESTAMP, RAW_BODY, 'whsec_attacker'),
              ],
            }),
          ),
        'duplicate_header',
      )
    })

    test('rejects two signature headers comma-joined by Node', () => {
      expectFailure(
        () =>
          verify(
            validHeaders({
              [TERAC_SIGNATURE_HEADER]: `${sign(TIMESTAMP, RAW_BODY)},${sign(TIMESTAMP, RAW_BODY, 'whsec_attacker')}`,
            }),
          ),
        'duplicate_header',
      )
    })

    test('rejects two signature headers differing only in case', () => {
      expectFailure(
        () =>
          verify({
            [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, RAW_BODY),
            'X-Terac-Request-Signature': sign(
              TIMESTAMP,
              RAW_BODY,
              'whsec_attacker',
            ),
            [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
            [TERAC_EVENT_ID_HEADER]: 'dlv_7h3k9',
          }),
        'duplicate_header',
      )
    })

    test('rejects duplicate timestamp headers', () => {
      expectFailure(
        () =>
          verify(
            validHeaders({
              [TERAC_TIMESTAMP_HEADER]: [TIMESTAMP, TIMESTAMP],
            }),
          ),
        'duplicate_header',
      )
    })

    test('rejects duplicates via a Headers instance', () => {
      const headers = new Headers()
      headers.append(TERAC_SIGNATURE_HEADER, sign(TIMESTAMP, RAW_BODY))
      headers.append(TERAC_SIGNATURE_HEADER, 'AAAA')
      headers.set(TERAC_TIMESTAMP_HEADER, TIMESTAMP)
      headers.set(TERAC_EVENT_ID_HEADER, 'dlv_7h3k9')

      expectFailure(() => verify(headers), 'duplicate_header')
    })
  })

  describe('replay window', () => {
    test('rejects a delivery older than the tolerance', () => {
      const oldTimestamp = String(
        Math.floor(NOW_MS / 1000) - DEFAULT_WEBHOOK_TOLERANCE_SECONDS - 1,
      )
      expectFailure(
        () =>
          verify(
            validHeaders({
              [TERAC_SIGNATURE_HEADER]: sign(oldTimestamp, RAW_BODY),
              [TERAC_TIMESTAMP_HEADER]: oldTimestamp,
            }),
          ),
        'timestamp_out_of_tolerance',
      )
    })

    test('rejects a delivery from too far in the future', () => {
      const futureTimestamp = String(
        Math.floor(NOW_MS / 1000) + DEFAULT_WEBHOOK_TOLERANCE_SECONDS + 60,
      )
      expectFailure(
        () =>
          verify(
            validHeaders({
              [TERAC_SIGNATURE_HEADER]: sign(futureTimestamp, RAW_BODY),
              [TERAC_TIMESTAMP_HEADER]: futureTimestamp,
            }),
          ),
        'timestamp_out_of_tolerance',
      )
    })

    test('honours a custom tolerance', () => {
      const oldTimestamp = String(Math.floor(NOW_MS / 1000) - 30)
      const headers = validHeaders({
        [TERAC_SIGNATURE_HEADER]: sign(oldTimestamp, RAW_BODY),
        [TERAC_TIMESTAMP_HEADER]: oldTimestamp,
      })

      expectFailure(
        () => verify(headers, RAW_BODY, 10),
        'timestamp_out_of_tolerance',
      )
      expect(verify(headers, RAW_BODY, 60).eventId).toBe('dlv_7h3k9')
    })

    test('Infinity disables the freshness check', () => {
      const ancient = '1000000000'
      const headers = validHeaders({
        [TERAC_SIGNATURE_HEADER]: sign(ancient, RAW_BODY),
        [TERAC_TIMESTAMP_HEADER]: ancient,
      })
      expect(verify(headers, RAW_BODY, Number.POSITIVE_INFINITY).eventId).toBe(
        'dlv_7h3k9',
      )
    })
  })

  describe('malformed input', () => {
    test('rejects a missing signature header', () => {
      expectFailure(
        () => verify(validHeaders({ [TERAC_SIGNATURE_HEADER]: undefined })),
        'missing_signature',
      )
    })

    test('rejects a missing timestamp header', () => {
      expectFailure(
        () => verify(validHeaders({ [TERAC_TIMESTAMP_HEADER]: undefined })),
        'missing_timestamp',
      )
    })

    test('rejects a non-numeric timestamp', () => {
      expectFailure(
        () => verify(validHeaders({ [TERAC_TIMESTAMP_HEADER]: 'yesterday' })),
        'malformed_timestamp',
      )
    })

    test('rejects an empty secret', () => {
      expect(() =>
        verifyTeracWebhook({
          payload: RAW_BODY,
          headers: validHeaders(),
          secret: '',
        }),
      ).toThrow(TeracWebhookVerificationError)
    })

    test('rejects a signed body that is not JSON', () => {
      const body = 'not json'
      expectFailure(
        () =>
          verify(
            {
              [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, body),
              [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
              [TERAC_EVENT_ID_HEADER]: 'dlv_1',
            },
            body,
          ),
        'malformed_payload',
      )
    })

    test('rejects a signed JSON body that is not an event', () => {
      const body = JSON.stringify({ hello: 'world' })
      expectFailure(
        () =>
          verify(
            {
              [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, body),
              [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
              [TERAC_EVENT_ID_HEADER]: 'dlv_1',
            },
            body,
          ),
        'malformed_payload',
      )
    })

    test('rejects a delivery with no event id to deduplicate on', () => {
      const body = JSON.stringify({ event_type: 'submission.approved' })
      expectFailure(
        () =>
          verify(
            {
              [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, body),
              [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
            },
            body,
          ),
        'missing_event_id',
      )
    })
  })
})

describe('isSubmissionStatusChangeEvent', () => {
  test('narrows a status change event', () => {
    const { event } = verify(validHeaders())
    expect(isSubmissionStatusChangeEvent(event)).toBe(true)
    if (!isSubmissionStatusChangeEvent(event)) {
      throw new Error('expected a status change event')
    }
    expect(event.from).toBe('screening')
    expect(event.to).toBe('screened_out')
  })

  test('does not narrow an unrelated event type', () => {
    expect(
      isSubmissionStatusChangeEvent({ event_type: TERAC_PING_EVENT_TYPE }),
    ).toBe(false)
  })

  test('does not narrow an event type Terac adds later', () => {
    // Event types are an open set: `GET /hooks/event-types` is the source of
    // truth, so an unknown type must verify and parse, not throw.
    const body = JSON.stringify({
      event_type: 'opportunity.something.new',
      event_id: 'dlv_new',
    })
    const delivery = verify(
      {
        [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, body),
        [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
        [TERAC_EVENT_ID_HEADER]: 'dlv_new',
      },
      body,
    )
    expect(delivery.event.event_type).toBe('opportunity.something.new')
    expect(isSubmissionStatusChangeEvent(delivery.event)).toBe(false)
  })
})
