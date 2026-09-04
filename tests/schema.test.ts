/**
 * Asserts the committed, normalised OpenAPI document has the properties the
 * generated client depends on.
 *
 * These test the OUTCOME of `scripts/update-schema.ts`, so a normalisation that
 * silently stops firing — or a hand-edit of the vendored file — fails here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

type Operation = {
  operationId?: string
  parameters?: { in?: string; name?: string }[]
  requestBody?: { content?: Record<string, unknown> }
  responses?: Record<string, unknown>
}

type Spec = {
  openapi: string
  servers: { url: string }[]
  components: { schemas: Record<string, unknown> }
  paths: Record<string, Record<string, Operation>>
}

const spec: Spec = JSON.parse(
  readFileSync(join(repoRoot, 'schemas', 'openapi.json'), 'utf-8'),
)

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
])

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => HTTP_METHODS.has(method))
    .map(([method, operation]) => ({ path, method, operation })),
)

describe('vendored spec', () => {
  test('is the shape the SDK was built against', () => {
    expect(spec.openapi).toBe('3.0.3')
    expect(spec.servers).toEqual([{ url: 'https://terac.com/api/external/v2' }])
    expect(Object.keys(spec.paths)).toHaveLength(28)
    expect(operations).toHaveLength(39)
  })

  test('error schemas use the nested shape the API really returns', () => {
    // The provider declares a flat `{ message, code, issues }`; a live
    // unauthenticated request returns `{ error: { code, message } }`.
    for (const code of [
      'BAD_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
    ]) {
      const schema = spec.components.schemas[`error.${code}`]
      expect(schema, `error.${code} is missing`).toBeDefined()
      expect(JSON.stringify(schema)).toContain('"error"')
      expect(JSON.stringify(schema)).not.toContain('"issues"')
    }
  })

  test('every operation declares the 429 the rate limit produces', () => {
    for (const { path, method, operation } of operations) {
      expect(
        Object.keys(operation.responses ?? {}),
        `${method.toUpperCase()} ${path}`,
      ).toContain('429')
    }
  })

  test('every state-changing operation declares the documented 409', () => {
    for (const { path, method, operation } of operations) {
      if (method === 'get') {
        continue
      }
      expect(
        Object.keys(operation.responses ?? {}),
        `${method.toUpperCase()} ${path}`,
      ).toContain('409')
    }
  })

  test('every POST declares a JSON request body, because a body-less POST is 415', () => {
    for (const { path, method, operation } of operations) {
      if (method !== 'post') {
        continue
      }
      expect(
        operation.requestBody?.content?.['application/json'],
        `POST ${path} has no JSON request body`,
      ).toBeDefined()
    }
  })

  test('no operation exposes a transport header as a caller parameter', () => {
    for (const { path, method, operation } of operations) {
      const headerParams = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'header')
        .map((parameter) => parameter.name?.toLowerCase())

      expect(headerParams, `${method.toUpperCase()} ${path}`).not.toContain(
        'content-type',
      )
      expect(headerParams, `${method.toUpperCase()} ${path}`).not.toContain(
        'content-length',
      )
    }
  })

  test('the key is modelled as a raw Authorization header, so the facade adds Bearer', () => {
    const schemes: Record<
      string,
      { type?: string; in?: string; name?: string }
    > = JSON.parse(
      readFileSync(join(repoRoot, 'schemas', 'openapi.json'), 'utf-8'),
    ).components.securitySchemes
    expect(schemes.apiKey).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
    })
    // No `scheme: 'bearer'`, so the generated client would send the value raw.
    expect(schemes.apiKey).not.toHaveProperty('scheme')
  })
})
