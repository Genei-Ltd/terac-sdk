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
