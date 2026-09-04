import { describe, expect, test } from 'vitest'
import type { TeracWebhookEventTypeInfo } from '../src/domain'
import type { PostHooksSubscriptionsData } from '../src/generated/types.gen'
import * as zodSchemas from '../src/zod'

describe('generated Zod schemas', () => {
  test('exports a schema per operation', () => {
    const names = Object.keys(zodSchemas)
    expect(names.length).toBeGreaterThan(30)
    expect(names.every((name) => name.startsWith('z'))).toBe(true)
  })

  test('validates a project response and rejects a bad one', () => {
    const schema = zodSchemas.zGetProjectsByProjectIdResponse
    const valid = {
      id: 'prj_1',
      name: 'Q3 discovery',
      slug: 'q3-discovery',
      created_at: '2026-08-11T21:00:00.000Z',
      dashboard_url: null,
      opportunity_count: 2,
    }
    expect(schema.parse(valid)).toEqual(valid)
    expect(
      schema.safeParse({ ...valid, opportunity_count: 'two' }).success,
    ).toBe(false)
  })

  test('webhook event types are open, in the types and in the schemas', () => {
    // Terac ships new event types without a version bump, so a caller must be
    // able to read one back from `listEventTypes()` and then subscribe to it.
    const future = 'opportunity.something.new'

    expect(
      zodSchemas.zGetHooksEventTypesResponse.safeParse({
        data: [{ event_type: future, description: 'Something new' }],
      }).success,
    ).toBe(true)

    expect(
      zodSchemas.zPostHooksSubscriptionsBody.safeParse({
        target_url: 'https://example.com/hooks/terac',
        event_types: [future],
      }).success,
    ).toBe(true)

    expect(
      zodSchemas.zPatchHooksSubscriptionsBySubscriptionIdBody.safeParse({
        event_types: [future],
      }).success,
    ).toBe(true)

    expect(
      zodSchemas.zGetHooksSubscriptionsBySubscriptionIdResponse.safeParse({
        id: 'whs_1',
        target_url: 'https://example.com/hooks/terac',
        event_types: [future],
        is_enabled: true,
        confirmed_at: null,
        disabled_at: null,
        disabled_reason: null,
        created_at: '2026-08-11T21:00:00.000Z',
        updated_at: '2026-08-11T21:00:00.000Z',
      }).success,
    ).toBe(true)

    // The generated TYPES have to accept it too. These two annotations do not
    // compile against a closed union, so `tc` is half of this test.
    const body: PostHooksSubscriptionsData['body'] = {
      target_url: 'https://example.com/hooks/terac',
      event_types: [future],
    }
    expect(body.event_types).toEqual([future])

    const entry: TeracWebhookEventTypeInfo = {
      event_type: future,
      description: 'Something new',
    }
    expect(entry.event_type).toBe(future)
  })

  test('the error schema matches the shape the API really returns', () => {
    // The published spec declares a flat `{message, code, issues}` body;
    // `scripts/update-schema.ts` rewrites it to the nested shape during
    // vendoring, so the generated schema must accept the nested one.
    const schema = zodSchemas.zErrorNotFound
    expect(
      schema.safeParse({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      }).success,
    ).toBe(true)
    expect(
      schema.safeParse({ code: 'NOT_FOUND', message: 'Resource not found' })
        .success,
    ).toBe(false)
  })
})
