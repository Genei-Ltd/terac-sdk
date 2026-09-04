# @coloop-ai/terac-sdk

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Genei-Ltd/terac-sdk/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?logo=typescript)](https://www.typescriptlang.org/)

Type-safe client bindings for the [Terac](https://terac.com/) External API v2.
Operations are generated from the provider's OpenAPI document and wrapped in an
ergonomic SDK.

> ⚠️ This project is maintained by CoLoop and is not affiliated with or endorsed
> by Terac — review their API terms before use.

> ⚠️ Terac marks the v2 API **beta**: "Endpoints and request/response shapes may
> change before general availability." The OpenAPI document is vendored in this
> repository and `pnpm run schema:update` diffs it, so a provider change shows
> up as a reviewable diff rather than a runtime surprise.

## Installation

```bash
pnpm add @coloop-ai/terac-sdk
```

`zod` is a runtime dependency (`^3.25.0 || ^4.0.0`); the generated Zod schemas
import from `zod/v4`.

## Quick start

```ts
import { TeracSdk } from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

const terac = new TeracSdk({ apiKey, timeoutMs: 30_000 })

// A project groups opportunities.
const project = await terac.projects.create({ name: 'Q3 developer research' })

// An opportunity is the unit of recruitment. It starts as a draft.
const opportunity = await terac.opportunities.create({
  project_id: project.id,
  title: 'How you debug production',
  description: 'A 30 minute conversation about your debugging workflow.',
  business_type: 'b2b',
  num_participants: 10,
  // The work happens at `task_url`; screening only decides who gets there.
  tasks: [
    {
      sequence: 1,
      task_type: 'interview',
      review_type: 'manual_review',
      task_url: 'https://research.example.com/session',
      duration_minutes: 30,
    },
  ],
  screening_questions: [
    {
      text: 'How often do you debug production incidents?',
      pick: 'one',
      answers: [
        { text: 'Weekly or more often', qualify_logic: 'must' },
        { text: 'A few times a year', qualify_logic: 'reject' },
        { text: 'Never', qualify_logic: 'reject' },
      ],
    },
  ],
})

// Launching spends funds and starts recruiting.
const live = await terac.opportunities.launch(opportunity.id)
console.log(`${live.id} is ${live.status}`)

// Read what came back, and pay the people whose work you accept.
const submissions = await terac.submissions.list(live.id, {
  status: 'awaiting_review',
})

for (const submission of submissions.data) {
  await terac.submissions.approve(submission.id)
}
```

## Authentication

Terac uses one credential: an organisation API key, sent as
`Authorization: Bearer tk_…`. Keys are managed in the Terac dashboard under
organisation settings.

The OpenAPI document models the key as an `apiKey` security scheme whose
location is the `Authorization` header, so the _generated_ client would send the
key raw. **The facade adds the `Bearer ` prefix**; pass the bare key.

There is no sandbox or staging environment. `https://terac.com/api/external/v2`
is the only server the document declares and the only one the docs name.

## What the SDK does about credentials

- The key lives in one ECMAScript `#private` field on `TeracSdk`, and is read
  through a closure when a request is signed. No module holds a copy, and no
  enumerable property anywhere under the SDK contains it — `JSON.stringify(sdk)`
  and `util.inspect(sdk)` are both safe to log.
- **A malformed key is rejected in the constructor.** A key with surrounding
  whitespace or any control character throws, with an error that names the
  fault and never quotes the value. This is not tidiness: `Headers.set` refuses
  a value containing a newline and puts the whole `Bearer <key>` string in the
  message, and that error would be kept as `TeracTransportError.cause`.
- **Redirects are refused.** Node forwards an `Authorization` header across a
  redirect, so following one would hand the key to whatever host the response
  named. Every request is issued with `redirect: 'error'`, and a redirect
  surfaces as a `TeracTransportError`.
- Thrown errors carry a **redacted request summary** — method, URL, and header
  names with every value replaced by `[redacted]` unless it is a transport
  header such as `content-type`. They never carry the `Request`, the
  `Response`, or the key.
- **Response header values are allow-listed too.** `error.responseHeaders`
  keeps every header name, and keeps the value only for `retry-after`, the
  rate-limit headers, `content-type` and request-id headers. A proxy that
  echoes your credential back in a header of its own invention cannot put it in
  your logs.

## Error handling

Five classes, one base, so a caller can branch without reading a message string.

| Class                 | Raised when                                                | Notable fields                                            |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `TeracApiError`       | Terac answered with a non-2xx status                       | `status`, `code`, `details`, `payload`, `responseHeaders` |
| `TeracRateLimitError` | The same, narrowed to `429 RATE_LIMITED`                   | `retryAfterSeconds` when a header is present              |
| `TeracTransportError` | No usable response: DNS, TLS, reset, or a refused redirect | `cause`                                                   |
| `TeracResponseError`  | A success status whose body could not be decoded           | `status`, `cause`                                         |
| `TeracTimeoutError`   | The configured `timeoutMs` elapsed                         | `timeoutMs`                                               |

All five extend `TeracError`. An HTTP error is constructed **only** when a
non-success response exists, so `error.status` is always a status Terac really
sent — a malformed body on a `200` is a `TeracResponseError`, not an
"API error with status 200".

Every response this API declares is JSON, so the client is pinned to
`parseAs: 'json'` rather than choosing a decoder from the `Content-Type`. JSON
labelled `text/plain`, or sent with no content type at all, is still decoded to
the declared object type; a body that is genuinely not JSON is a
`TeracResponseError` rather than a string or a `ReadableStream` handed back
under a type that promised an object.

```ts
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
```

Terac's documented error codes are `BAD_REQUEST` (400), `UNAUTHORIZED` (401),
`NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429) and
`INTERNAL_SERVER_ERROR` (500).

## Rate limits

100 requests per minute per API key. Exceeding it returns `429 RATE_LIMITED`,
which this SDK raises as `TeracRateLimitError`. Terac documents no
`Retry-After`, so `retryAfterSeconds` is populated only when the response
actually carries one — it is never invented.

## Request timeouts and cancellation

`timeoutMs` covers **reading the response body**, not just the response
headers. A server that sends headers and then stalls the body still trips the
deadline; without that, the SDK promise would hang forever.

Every operation takes an optional trailing `{ signal }`, forwarded to the
request. `signal.reason` is preserved by identity, so `AbortSignal.timeout(n)`
surfaces its own `TimeoutError`, `controller.abort(myError)` surfaces
`myError`, and `controller.abort(0)`, `abort('')`, `abort(false)` and
`abort(null)` each reject with exactly that value rather than a stand-in.

```ts
import { TeracSdk } from '@coloop-ai/terac-sdk'
import type { TeracFilter, TeracOpportunity } from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

const terac = new TeracSdk({ apiKey })

// Cancel any call by passing a signal as the last argument.
const controller = new AbortController()
setTimeout(() => {
  controller.abort(new Error('took too long'))
}, 5_000)

const organization = await terac.organizations.retrieveContext({
  signal: controller.signal,
})
console.log(
  `${organization.organizationName}: $${String(organization.balanceDollars)}`,
)

// Read the event types rather than hardcoding them; Terac adds new ones
// without a version bump.
const eventTypes = await terac.webhooks.listEventTypes()
console.log(eventTypes.data.map((entry) => entry.event_type))

const filters: TeracFilter[] = (await terac.filters.list()).data
console.log(`${String(filters.length)} filters available`)

const opportunity: TeracOpportunity =
  await terac.opportunities.retrieve('opp_abc123')
console.log(opportunity.submission_stats)
```

## Operations

Grouped by the resource each one acts on. Every method takes an optional
trailing `{ signal }`.

| Group                 | Methods                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `terac.projects`      | `list`, `create`, `retrieve`, `update`                                                                                            |
| `terac.filters`       | `list`, `listOptions`                                                                                                             |
| `terac.opportunities` | `list`, `create`, `retrieve`, `update`, `delete`, `launch`, `pause`, `resume`, `stop`                                             |
| `terac.submissions`   | `list`, `retrieve`, `approve`, `reject`, and `listApplicants`, `invite`, `decline` — **undocumented, see below**                  |
| `terac.quotes`        | `create`, `retrieve`, `launch` — **undocumented, see below**                                                                      |
| `terac.feasibility`   | `create`, `list`, `retrieve`                                                                                                      |
| `terac.organizations` | `retrieveContext`                                                                                                                 |
| `terac.webhooks`      | `listEventTypes`, `list`, `create`, `retrieve`, `update`, `confirm`, `delete`, `retrieveSecret`, `rotateSecret`, `listDeliveries` |

All 39 generated operations are wrapped. A table-driven test asserts the method,
path, query and body of every one, and fails if the provider adds an endpoint
that is not yet wrapped.

### Domain aliases

Terac's document names only five component schemas, all of them errors — every
request and response body is inline, so the generated types are named after
operations. These aliases give the objects the names the docs use, and follow
the generated types when the spec changes:

`TeracProject`, `TeracProjectSummary`, `TeracOpportunity`,
`TeracOpportunitySummary`, `TeracSubmission`, `TeracSubmissionSummary`,
`TeracApplicant`, `TeracParticipantId`, `TeracQuote`,
`TeracFeasibilityRequest`, `TeracFeasibilityRequestSummary`,
`TeracWebhookSubscription`, `TeracWebhookDelivery`,
`TeracWebhookEventTypeInfo`, `TeracFilter`, `TeracFilterOption`,
`TeracOrganizationContext`.

Terac exposes no participant resource: a person is reachable only as the
`participant_id` on a submission or applicant, so `TeracApplicant` is the
closest thing to a participant object the API returns.

## Hand-written because the spec does not describe it

Everything else in this SDK is generated. These four areas are not, because
Terac's OpenAPI document does not cover them:

1. **Webhook delivery verification** (`@coloop-ai/terac-sdk/webhooks`). The
   document describes the `/hooks/*` management endpoints but not the
   deliveries: no payload schemas, no signature scheme. Written from the
   [webhooks guide](https://terac.com/docs/developers/guides/webhooks).
2. **The completion callback** (`@coloop-ai/terac-sdk/callback`). Not in the
   document, not in the reference, and outside the `/api/external/v2` base path.
3. **The error body shape.** The document declares a flat
   `{ message, code, issues }`; the live API returns
   `{ error: { code, message, details } }`. Rewritten during vendoring — see
   [Spec normalisations](#spec-normalisations).
4. **The empty JSON body every `POST` requires.** The document declares no
   request body for six `POST` operations, but Terac rejects a body-less `POST`
   with `415`. Declared during vendoring, and sent as `{}` by the facade.

## Webhooks

```bash
pnpm add @coloop-ai/terac-sdk
```

```ts
import {
  isSubmissionStatusChangeEvent,
  isTeracWebhookVerificationError,
  verifyTeracWebhook,
} from '@coloop-ai/terac-sdk/webhooks'
```

### The contract

| Header                      | Meaning                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `X-Terac-Request-Signature` | `base64(HMAC-SHA256(secret, timestamp + rawBody))`                       |
| `X-Terac-Request-Timestamp` | Unix seconds. Part of the signed string, so it changes on each retry.    |
| `X-Event-ID`                | Unique per delivery, **stable across retries**. Deduplicate on this.     |
| `X-Timestamp`               | ISO-8601, when the event happened. Stable across retries. Order by this. |

The signed string is the timestamp header concatenated with the **raw request
body**, with no separator. Parse and re-serialise the JSON first and the bytes
change, so the signature will not match — read the raw body before anything
touches it.

`verifyTeracWebhook` compares in constant time, requires canonical base64
(`Buffer.from(x, 'base64')` silently accepts trailing junk, which would let a
tampered signature through), rejects duplicate signature and timestamp headers,
and rejects a delivery whose signed timestamp is outside a tolerance window —
300 seconds by default, configurable via `toleranceSeconds`.

Three details that decide whether the verification is worth anything:

- **The tolerance fails closed.** `toleranceSeconds` accepts a non-negative
  finite number, or exactly `Infinity` to switch the freshness check off on
  purpose. `NaN`, `-Infinity` and negatives throw. `Number(process.env.X)` on
  an unset variable is `NaN`, and a lenient reading of that would silently
  delete replay protection. `now` must be finite for the same reason.
- **The signed `event_id` wins over `X-Event-ID`.** The HMAC covers the
  timestamp and the body, never the header. When the body carries an
  `event_id`, that is the value you get back, and a header that disagrees fails
  verification — otherwise a captured delivery could be replayed under a fresh
  header id and walk straight past deduplication. The header is used only when
  the body omits it.
- **A `Uint8Array` payload is hashed byte for byte.** The bytes are never
  decoded before the HMAC, so an invalid UTF-8 sequence is not quietly replaced
  with U+FFFD. Decoding happens after verification, for the JSON parse.

### A verification failure is not a replay defence

A valid signature proves the delivery is authentic and recent. It does not
prove it is **new**. Claim the `eventId` atomically before doing any work: a
read-then-write pair lets two concurrent retries both decide the event is new.

```ts
import { createServer } from 'node:http'
import {
  isSubmissionStatusChangeEvent,
  isTeracWebhookVerificationError,
  verifyTeracWebhook,
} from '@coloop-ai/terac-sdk/webhooks'

const secret = process.env.TERAC_WEBHOOK_SECRET
if (!secret) {
  throw new Error('Set TERAC_WEBHOOK_SECRET to the subscription signing secret')
}

/**
 * Records an event id and reports whether it was new.
 *
 * This must be ATOMIC and durable — a unique index and an insert that either
 * succeeds or conflicts. A read-then-write pair lets two concurrent retries
 * both see "not seen" and both do the work. This in-memory version stands in
 * for `INSERT INTO terac_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`.
 */
const seenEventIds = new Set<string>()
const claimEvent = (eventId: string): boolean => {
  if (seenEventIds.has(eventId)) {
    return false
  }
  seenEventIds.add(eventId)
  return true
}

const readRawBody = async (stream: AsyncIterable<Buffer>): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  // The signature covers the raw bytes. Never re-serialise before verifying.
  return Buffer.concat(chunks).toString('utf-8')
}

createServer((request, response) => {
  void (async () => {
    const rawBody = await readRawBody(request)

    try {
      const delivery = verifyTeracWebhook({
        payload: rawBody,
        headers: request.headers,
        secret,
      })

      // Claim the event BEFORE doing any work. A valid signature proves the
      // delivery is authentic, never that it is new.
      if (!claimEvent(delivery.eventId)) {
        response.writeHead(200).end()
        return
      }

      if (isSubmissionStatusChangeEvent(delivery.event)) {
        console.log(
          `submission ${delivery.event.resource_id}: ${delivery.event.from} -> ${delivery.event.to}`,
        )
      }

      // Acknowledge first; deliveries time out after 10 seconds.
      response.writeHead(200).end()
    } catch (error) {
      if (isTeracWebhookVerificationError(error)) {
        console.warn(`rejected delivery: ${error.reason}`)
        // A 4xx is a deliberate rejection: Terac will not retry it.
        response.writeHead(400).end()
        return
      }
      response.writeHead(500).end()
    }
  })()
}).listen(3000)
```

### Lifecycle

1. `terac.webhooks.create({ target_url, event_types })` — `target_url` must be
   `https` and resolve to a public host. One URL per organisation; a second
   `POST` for the same URL returns `409`.
2. `terac.webhooks.confirm(id)` — Terac POSTs one signed `webhook.ping` to the
   target URL. A `2xx` activates the subscription; anything else returns `412`
   and nothing is confirmed. Repeatable, and the cheapest end-to-end test of a
   receiver.
3. `terac.webhooks.update(id, { event_types })` — replaces the list rather than
   adding to it. Changing `target_url` clears the confirmation; changing
   `event_types` does not.
4. `terac.webhooks.retrieveSecret(id)` / `terac.webhooks.rotateSecret(id)` —
   rotation takes effect immediately with **no overlap window**, including for
   deliveries already queued. Deploy the new secret first.
5. `terac.webhooks.listDeliveries({ subscription_id })` — one row per delivery,
   updated in place across retries. Confirmation pings are not logged.

### Event types are an open set

Read `terac.webhooks.listEventTypes()` rather than hardcoding a list: the docs
say new event types ship without a version bump. `TeracWebhookEvent.event_type`
is therefore a plain `string`, not a closed union — a narrower type would reject
events Terac considers valid. Use `isSubmissionStatusChangeEvent` to narrow the
two documented ones.

The same is true of the management endpoints. Terac's document declares the
event-type fields as enums of the two values that exist today, which would make
a newly listed type fail to type-check and fail Zod validation — the exact
thing `listEventTypes()` exists to avoid. Vendoring removes those enums, so
`event_types` is `string[]` in both the generated types and the generated
schemas.

Deliveries are retried 12 times over about two and a half days. Redirects are
never followed, so point `target_url` at the final URL. Deliveries time out
after 10 seconds: acknowledge first, work afterwards.

## The completion callback

Not in the OpenAPI document, not in the developer reference, and outside the v2
base path. It is a **browser redirect**, not a server-to-server call —
unauthenticated, fired by the participant's browser when they finish your task.

Terac appends `teracSubmissionId`, `submissionId` (the same value) and `taskId`
to the `task_url` you configured. To place an id elsewhere in your link, write
`{TERAC_SUBMISSION_ID}` or `{TERAC_TASK_ID}` where the value belongs.

```ts
import {
  buildTeracCompletionCallbackUrl,
  parseTeracTaskUrlParams,
} from '@coloop-ai/terac-sdk/callback'

// 1. A participant arrives on your task page. Terac appended the tracking
//    parameters to the `task_url` you configured on the opportunity.
const { submissionId, taskId } = parseTeracTaskUrlParams(
  'https://research.example.com/session?teracSubmissionId=sub_abc123&taskId=tsk_1',
)
console.log(`submission ${submissionId}, task ${taskId ?? 'none'}`)

// 2. When they finish, send their browser back. Set `result` for every exit
//    path: Terac reads a missing `result` as `completed`, so a screen-out with
//    no redirect looks identical to someone who abandoned the task.
const onCompleted = buildTeracCompletionCallbackUrl({
  submissionId,
  result: 'completed',
})
const onScreenedOut = buildTeracCompletionCallbackUrl({
  submissionId,
  result: 'screened_out',
})
const onQuotaFull = buildTeracCompletionCallbackUrl({
  submissionId,
  result: 'quota_full',
})

console.log({ onCompleted, onScreenedOut, onQuotaFull })
```

`buildTeracCompletionCallbackUrl` **always writes `result`**. Terac reads a
missing `result` as `completed`, so an omitted one records screen-outs and
over-quota participants as finished. Configure a redirect for every exit path:
without one, a submission with no completion signal sits in Work review and is
auto-rejected after 6 hours.

## Undocumented endpoints

Six operations are in Terac's OpenAPI document but have no page under
`https://terac.com/docs/developers/reference`. They are wrapped, because they
are the only way to do the things they do, and each one is marked
**undocumented** in its JSDoc:

| Operation                                       | Facade method                      |
| ----------------------------------------------- | ---------------------------------- |
| `GET /opportunities/{opportunityId}/applicants` | `terac.submissions.listApplicants` |
| `POST /submissions/{submissionId}/invite`       | `terac.submissions.invite`         |
| `POST /submissions/{submissionId}/decline`      | `terac.submissions.decline`        |
| `POST /quotes`                                  | `terac.quotes.create`              |
| `GET /quotes/{quoteId}`                         | `terac.quotes.retrieve`            |
| `POST /quotes/{quoteId}/launch`                 | `terac.quotes.launch`              |

They may change without notice. The three applicant operations are the whole
applicant-review queue, so there is no documented alternative; for pricing,
prefer `terac.feasibility.*`, which is documented.

## Generated Zod schemas

One schema per operation, since Terac names almost no component schemas. Use
them to validate what you received rather than trust it — worth doing while the
API is beta.

```ts
import { TeracSdk } from '@coloop-ai/terac-sdk'
import { zGetSubmissionsBySubmissionIdResponse } from '@coloop-ai/terac-sdk/zod'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

const terac = new TeracSdk({ apiKey })

// The types describe what the vendored document declares. The schema checks
// what actually arrived, which is a different question while the API is beta.
const submission = await terac.submissions.retrieve('sub_abc123')
const checked = zGetSubmissionsBySubmissionIdResponse.safeParse(submission)

if (!checked.success) {
  throw new Error(
    `Terac sent an unexpected submission: ${checked.error.message}`,
  )
}

console.log(`${checked.data.id} is ${checked.data.status}`)
```

## Generated client access

The generated client and its types are re-exported from the root entry point
for the rare case where the facade is in the way. The facade covers every
operation, sets `redirect: 'error'`, enforces the body-inclusive timeout, pins
JSON decoding and classifies errors. The generated client does none of that, so
prefer `TeracSdk`.

```ts
import { GeneratedTeracSdk, generated } from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

// `TeracSdk` is the supported surface. It refuses redirects, applies a deadline
// that covers the response body, pins JSON decoding and classifies errors. The
// generated client does none of that, so anything you still want you have to
// configure yourself.
const client = generated.createClient({
  baseUrl: 'https://terac.com/api/external/v2',
  auth: () => `Bearer ${apiKey}`,
  redirect: 'error',
  parseAs: 'json',
  throwOnError: true,
})

const sdk = new GeneratedTeracSdk({ client })
const { data } = await sdk.getProjects<true>({ query: { limit: 10 } })

console.log(`${String(data.data.length)} projects`)
```

## Spec normalisations

`pnpm run schema:update` fetches Terac's document, normalises it **in memory**,
validates the result, and only then replaces `schemas/openapi.json`. Every
normalisation is logged, so a line disappearing from that output is the signal
to delete the workaround.

| Normalisation                                                                   | Why                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rewrite the five `error.*` schemas to `{ error: { code, message, details } }`   | The document declares a flat `{ message, code, issues }` the API never sends. Verified against a live unauthenticated request.                                         |
| Add `error.CONFLICT` and `error.RATE_LIMITED`                                   | Documented in the errors guide, absent from the document.                                                                                                              |
| Add a `429` response to every operation                                         | The 100 req/min limit is per key, so it applies everywhere.                                                                                                            |
| Add a `409` response to every non-`GET` operation                               | Documented for state conflicts, absent from the document.                                                                                                              |
| Add an empty JSON request body to six body-less `POST` operations               | Terac returns `415` for a body-less `POST`, even where the endpoint takes only a path parameter.                                                                       |
| Drop any `content-type` / `content-length` header parameter                     | Transport headers belong to fetch, not to callers. Currently a no-op; a guard against the provider adding them.                                                        |
| Remove the closed `event_type` / `event_types` enums on the `/hooks` operations | The webhooks guide says new event types appear without a breaking change. A closed enum would make `listEventTypes()` return a value the types and Zod schemas reject. |

## Known quirks in the provider's spec

- The declared error schemas do not match the live API (normalised above).
- `409` and `429` are documented but not declared (normalised above).
- Six `POST` operations declare no request body but reject a body-less request
  with `415` (normalised above).
- `GET /feasibility/requests` returns `{ count, requests }`, while every other
  list endpoint returns `{ data, pagination }`.
- Six operations exist in the document with no reference page: three under
  `/quotes`, and the three applicant-review ones.
- Webhook event types are declared as closed enums even though the webhooks
  guide says new ones ship without a breaking change (normalised above).
- Webhook deliveries and the completion callback are absent entirely.

## Scripts

| Script            | What it does                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`           | Dual ESM/CJS bundles plus types in `dist/` via tsdown.                                                                                                   |
| `check`           | Schema validation, `generate:check`, type-check, lint, format check, build, tests — in that order.                                                       |
| `format`          | Prettier check.                                                                                                                                          |
| `format:write`    | Prettier write.                                                                                                                                          |
| `generate`        | Regenerates `src/generated/**` from the **committed** `schemas/openapi.json`. Never touches the network.                                                 |
| `generate:check`  | Regenerates and fails if the committed output differs. Restores the committed tree on every exit, so a failed run leaves nothing behind.                 |
| `lint`            | ESLint across the repository.                                                                                                                            |
| `openapi-ts`      | The raw generator, for debugging.                                                                                                                        |
| `prepublishOnly`  | Runs `check`.                                                                                                                                            |
| `schema:update`   | Fetches Terac's document, normalises and validates it in memory, then atomically replaces `schemas/openapi.json`. The only script that uses the network. |
| `schema:validate` | Validates the committed document.                                                                                                                        |
| `tc`              | `tsc --noEmit`.                                                                                                                                          |
| `test`            | Vitest.                                                                                                                                                  |

Development needs **Node 22.18 or newer** (`@hey-api/openapi-ts` requires it,
and ESLint and Vitest need Node 20+); see `.node-version`. The published package
targets **Node 18.17+**, which is what `engines.node` and the tsdown target
declare. Those are two different numbers on purpose.

## License

MIT © Genie Technology Limited
