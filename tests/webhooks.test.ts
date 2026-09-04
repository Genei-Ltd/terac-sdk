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

/** JSON whose bytes hold a lone 0xFF, which is not a valid UTF-8 sequence. */
const INVALID_UTF8_BODY = Buffer.concat([
  Buffer.from('{"event_type":"x.y","event_id":"e1","n":"'),
  Buffer.from([0xff]),
  Buffer.from('"}'),
])

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

    // `Infinity` is the one deliberate escape hatch. Everything else that
    // would skip the comparison fails closed instead: `Number(process.env.X)`
    // on an unset variable is `NaN`, and accepting that would quietly delete
    // replay protection from a deployment.
    describe.each([
      ['NaN', Number.NaN],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['a negative number', -1],
      ['a large negative number', -300],
    ])('an invalid tolerance (%s)', (_name, toleranceSeconds) => {
      test('is rejected even for a delivery that is perfectly fresh', () => {
        expectFailure(
          () => verify(validHeaders(), RAW_BODY, toleranceSeconds),
          'invalid_tolerance',
        )
      })

      test('is rejected for an ancient delivery, rather than accepting it', () => {
        const ancient = '1000000000'
        expectFailure(
          () =>
            verify(
              validHeaders({
                [TERAC_SIGNATURE_HEADER]: sign(ancient, RAW_BODY),
                [TERAC_TIMESTAMP_HEADER]: ancient,
              }),
              RAW_BODY,
              toleranceSeconds,
            ),
          'invalid_tolerance',
        )
      })
    })

    test('rejects a tolerance that is not a number', () => {
      // A misconfiguration reaches this parameter as whatever the environment
      // held. `JSON.parse` is how a non-number gets past the declared type
      // without a type assertion, which ESLint rejects repository-wide.
      const notANumber: number = JSON.parse('"300"')

      expectFailure(
        () =>
          verifyTeracWebhook({
            payload: RAW_BODY,
            headers: validHeaders(),
            secret: SECRET,
            now: NOW_MS,
            toleranceSeconds: notANumber,
          }),
        'invalid_tolerance',
      )
    })

    test.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ])('rejects a non-finite now (%s)', (_name, now) => {
      // A non-finite `now` makes every age comparison pass, so an ancient
      // delivery would sail straight through the window.
      const ancient = '1000000000'
      expectFailure(
        () =>
          verifyTeracWebhook({
            payload: RAW_BODY,
            headers: validHeaders({
              [TERAC_SIGNATURE_HEADER]: sign(ancient, RAW_BODY),
              [TERAC_TIMESTAMP_HEADER]: ancient,
            }),
            secret: SECRET,
            now,
          }),
        'invalid_now',
      )
    })
  })

  describe('event id', () => {
    test('a header that disagrees with the signed body value is rejected', () => {
      // The HMAC covers the timestamp and the body, never `X-Event-ID`. A
      // captured delivery replayed under a fresh header id would otherwise
      // walk straight past deduplication.
      expectFailure(
        () => verify(validHeaders({ [TERAC_EVENT_ID_HEADER]: 'dlv_attacker' })),
        'event_id_mismatch',
      )
    })

    test('a matching header is accepted, and the signed value is returned', () => {
      expect(verify(validHeaders()).eventId).toBe(EVENT.event_id)
    })

    test('the signed value is used when there is no header at all', () => {
      expect(
        verify(validHeaders({ [TERAC_EVENT_ID_HEADER]: undefined })).eventId,
      ).toBe(EVENT.event_id)
    })

    test('falls back to the header only when the body omits event_id', () => {
      const body = JSON.stringify({
        event_type: 'submission.approved',
        resource_id: 'sub_1',
      })
      const delivery = verify(
        {
          [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, body),
          [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
          [TERAC_EVENT_ID_HEADER]: 'dlv_header_only',
        },
        body,
      )
      expect(delivery.eventId).toBe('dlv_header_only')
    })

    // A body that HAS the property but not a usable value is not a body that
    // omits it. Reading it as "absent" would hand the decision back to the
    // unsigned header, which is the replay the rule above exists to stop.
    test.each([
      ['an empty string', '""'],
      ['a number', '42'],
      ['null', 'null'],
      ['an object', '{"id":"dlv_1"}'],
      ['an array', '["dlv_1"]'],
    ])(
      'rejects a body whose event_id is %s, rather than using the header',
      (_name, encoded) => {
        const body = `{"event_type":"submission.approved","event_id":${encoded}}`
        expectFailure(
          () =>
            verify(
              {
                [TERAC_SIGNATURE_HEADER]: sign(TIMESTAMP, body),
                [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
                [TERAC_EVENT_ID_HEADER]: 'dlv_attacker',
              },
              body,
            ),
          'malformed_payload',
        )
      },
    )
  })

  describe('byte-exact payloads', () => {
    test('the HMAC covers the bytes given, not their UTF-8 decoding', () => {
      // 0xFF is not a valid UTF-8 sequence. Decoding first replaces it with
      // U+FFFD, so an HMAC over the decoded string covers bytes the sender
      // never sent.
      const overBytes = createHmac('sha256', SECRET)
        .update(TIMESTAMP, 'utf-8')
        .update(INVALID_UTF8_BODY)
        .digest('base64')
      const overDecoded = sign(TIMESTAMP, INVALID_UTF8_BODY.toString('utf-8'))
      expect(overBytes).not.toBe(overDecoded)

      // The signature over the BYTES passes the signature check and is then
      // refused for its encoding; the signature over the DECODED form never
      // gets that far. Two different failures, so which digest matched is not
      // a guess.
      expectFailure(
        () =>
          verify(
            {
              [TERAC_SIGNATURE_HEADER]: overBytes,
              [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
              [TERAC_EVENT_ID_HEADER]: 'e1',
            },
            INVALID_UTF8_BODY,
          ),
        'malformed_payload',
      )

      expectFailure(
        () =>
          verify(
            {
              [TERAC_SIGNATURE_HEADER]: overDecoded,
              [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
              [TERAC_EVENT_ID_HEADER]: 'e1',
            },
            INVALID_UTF8_BODY,
          ),
        'signature_mismatch',
      )
    })

    test('rejects a body that is not valid UTF-8, rather than substituting', () => {
      // A lenient decode turns 0xFF into U+FFFD, `JSON.parse` accepts the
      // result, and the delivery is accepted with a `rawBody` the sender never
      // sent.
      const signature = createHmac('sha256', SECRET)
        .update(TIMESTAMP, 'utf-8')
        .update(INVALID_UTF8_BODY)
        .digest('base64')

      const error = expectFailure(
        () =>
          verify(
            {
              [TERAC_SIGNATURE_HEADER]: signature,
              [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
              [TERAC_EVENT_ID_HEADER]: 'e1',
            },
            INVALID_UTF8_BODY,
          ),
        'malformed_payload',
      )
      expect(error.message).toContain('UTF-8')
    })

    test('rawBody re-encodes to exactly the bytes that were signed', () => {
      // Multi-byte characters, so a decoding bug shows up as changed bytes
      // rather than as an identical ASCII round trip.
      const body = JSON.stringify({
        event_type: 'submission.approved',
        event_id: 'dlv_utf8',
        note: 'café — naïve 😀',
      })
      const bytes = Buffer.from(body, 'utf-8')

      const delivery = verify(
        {
          [TERAC_SIGNATURE_HEADER]: createHmac('sha256', SECRET)
            .update(TIMESTAMP, 'utf-8')
            .update(bytes)
            .digest('base64'),
          [TERAC_TIMESTAMP_HEADER]: TIMESTAMP,
        },
        bytes,
      )

      expect(Buffer.from(delivery.rawBody, 'utf-8').equals(bytes)).toBe(true)
    })

    test('a Uint8Array view is hashed over its own window, not its buffer', () => {
      const framed = Buffer.concat([
        Buffer.from('XXXX'),
        Buffer.from(RAW_BODY, 'utf-8'),
        Buffer.from('YYYY'),
      ])
      const view = new Uint8Array(
        framed.buffer,
        framed.byteOffset + 4,
        Buffer.byteLength(RAW_BODY, 'utf-8'),
      )

      expect(verify(validHeaders(), view).eventId).toBe('dlv_7h3k9')
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
