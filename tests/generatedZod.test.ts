import { describe, expect, test } from 'vitest'
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
