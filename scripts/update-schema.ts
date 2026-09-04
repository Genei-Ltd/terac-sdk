/**
 * Refreshes the vendored Terac OpenAPI document at `schemas/openapi.json`.
 *
 * This is the ONLY script that touches the network. `pnpm run generate` reads
 * the committed file, so generation from a given commit is reproducible.
 *
 * The order matters: fetch, normalise and fully validate in memory, and only
 * then atomically replace the committed file. A provider document that fails
 * validation therefore leaves the good vendored copy in place.
 *
 * Every normalisation is logged. When Terac fixes the underlying spec bug the
 * corresponding line stops appearing, which is the signal to delete the
 * workaround.
 *
 * @see https://terac.com/api/external/v2/openapi.json
 */
import SwaggerParser from '@apidevtools/swagger-parser'
import { rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPEC_URL = 'https://terac.com/api/external/v2/openapi.json'

// `import.meta.dirname` needs Node 20.11+, and this repo also has to be
// readable by contributors on the Node 18 runtime floor.
const OUTPUT_PATH = fileURLToPath(
  new URL('../schemas/openapi.json', import.meta.url),
)

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const

type HttpMethod = (typeof HTTP_METHODS)[number]

const HTTP_METHOD_NAMES: ReadonlySet<string> = new Set(HTTP_METHODS)

/** Header names that belong to the transport, never to the caller. */
const TRANSPORT_HEADER_PARAMETERS = new Set(['content-type', 'content-length'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isHttpMethod = (value: string): value is HttpMethod =>
  HTTP_METHOD_NAMES.has(value)

type Operation = Record<string, unknown> & {
  operationId?: unknown
  parameters?: unknown
  requestBody?: unknown
  responses?: Record<string, unknown>
}

export type OpenApiDocument = Record<string, unknown> & {
  openapi?: unknown
  paths?: Record<string, unknown>
  components?: { schemas?: Record<string, unknown> }
  servers?: { url?: string }[]
}

type OperationEntry = {
  path: string
  method: HttpMethod
  operationId: string
  operation: Operation
}

const listOperations = (document: OpenApiDocument): OperationEntry[] => {
  const entries: OperationEntry[] = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!isRecord(pathItem)) {
      continue
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isHttpMethod(method) || !isRecord(operation)) {
        continue
      }

      entries.push({
        path,
        method,
        operationId:
          typeof operation.operationId === 'string'
            ? operation.operationId
            : `${method} ${path}`,
        operation,
      })
    }
  }

  return entries
}

/**
 * Terac's declared error schemas are flat (`{ message, code, issues }`), but
 * the live API and the docs both return `{ error: { code, message, details } }`.
 * Verified against an unauthenticated request on 2026-09-04:
 * `{"error":{"code":"UNAUTHORIZED","message":"API key required. ..."}}`.
 *
 * Rewrite each declared error schema to the shape the server actually sends,
 * so the generated types and Zod schemas can be trusted.
 *
 * @see https://terac.com/docs/developers/guides/errors
 */
const buildErrorSchema = (
  code: string,
  title: string,
  message: string,
): Record<string, unknown> => ({
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The machine-readable error code.',
          example: code,
        },
        message: {
          type: 'string',
          description: 'A human-readable description of the failure.',
          example: message,
        },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['message'],
          },
          description:
            'Optional field-level validation errors, when the API can attribute the failure to specific inputs.',
        },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
  title,
  description: 'The error information',
  example: { error: { code, message } },
})

/** Error codes the docs list, with the status they arrive on. */
const DOCUMENTED_ERRORS: {
  status: string
  code: string
  title: string
  message: string
}[] = [
  {
    status: '400',
    code: 'BAD_REQUEST',
    title: 'Invalid input data error (400)',
    message: 'Invalid input data',
  },
  {
    status: '401',
    code: 'UNAUTHORIZED',
    title: 'Authorization not provided error (401)',
    message: 'Invalid or expired API key',
  },
  {
    status: '403',
    code: 'FORBIDDEN',
    title: 'Insufficient access error (403)',
    message: 'Insufficient access',
  },
  {
    status: '404',
    code: 'NOT_FOUND',
    title: 'Not found error (404)',
    message: 'Resource not found or not accessible',
  },
  {
    status: '409',
    code: 'CONFLICT',
    title: 'Conflict error (409)',
    message: 'Action not allowed in current state',
  },
  {
    status: '429',
    code: 'RATE_LIMITED',
    title: 'Rate limited error (429)',
    message: 'Too many requests',
  },
  {
    status: '500',
    code: 'INTERNAL_SERVER_ERROR',
    title: 'Internal server error error (500)',
    message: 'Unexpected server error',
  },
]

const errorResponse = (code: string, description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/error.${code}` },
    },
  },
})

function normalizeErrorSchemas(document: OpenApiDocument): string[] {
  const changes: string[] = []
  const components = (document.components ??= {})
  const schemas = (components.schemas ??= {})

  for (const { code, title, message } of DOCUMENTED_ERRORS) {
    const name = `error.${code}`
    const existing = schemas[name]
    const replacement = buildErrorSchema(code, title, message)

    if (existing === undefined) {
      schemas[name] = replacement
      changes.push(
        `Added missing error schema components.schemas["${name}"] (documented but absent from the provider spec)`,
      )
      continue
    }

    if (
      isRecord(existing) &&
      isRecord(existing.properties) &&
      'error' in existing.properties
    ) {
      continue
    }

    schemas[name] = replacement
    changes.push(
      `Rewrote components.schemas["${name}"] from the declared flat {message, code, issues} shape to the {error: {code, message, details}} shape the API actually returns`,
    )
  }

  return changes
}

/**
 * The provider documents `409 CONFLICT` and `429 RATE_LIMITED` but declares
 * neither. 429 applies to every operation (the 100 req/min limit is per key);
 * 409 applies to the state-changing ones (for example launching an already
 * active opportunity, or declining an applicant who is not awaiting a decision).
 *
 * @see https://terac.com/docs/developers/guides/errors
 * @see https://terac.com/docs/developers/guides/authentication
 */
function normalizeMissingResponses(document: OpenApiDocument): string[] {
  const changes: string[] = []

  for (const { path, method, operationId, operation } of listOperations(
    document,
  )) {
    const responses = (operation.responses ??= {})

    if (!('429' in responses)) {
      responses['429'] = errorResponse(
        'RATE_LIMITED',
        'Rate limit exceeded (100 requests per minute per API key)',
      )
      changes.push(
        `Added the undeclared 429 RATE_LIMITED response to ${operationId} (${method.toUpperCase()} ${path})`,
      )
    }

    if (method !== 'get' && !('409' in responses)) {
      responses['409'] = errorResponse(
        'CONFLICT',
        'Action not allowed in the resource’s current state',
      )
      changes.push(
        `Added the undeclared 409 CONFLICT response to ${operationId} (${method.toUpperCase()} ${path})`,
      )
    }
  }

  return changes
}

/**
 * Terac rejects a body-less `POST` with `415`, even where the endpoint takes
 * only a path parameter, but the spec declares no request body for those
 * operations. Declare the empty JSON object the API requires, so the generated
 * client sends `{}` with a `Content-Type` instead of nothing.
 *
 * @see https://terac.com/docs/developers/guides/webhooks
 */
function normalizeBodylessPosts(document: OpenApiDocument): string[] {
  const changes: string[] = []

  for (const { path, method, operationId, operation } of listOperations(
    document,
  )) {
    if (method !== 'post' || operation.requestBody !== undefined) {
      continue
    }

    operation.requestBody = {
      required: true,
      description:
        'Terac rejects a body-less POST with 415. Send an empty JSON object when the operation takes no other input.',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: 'No fields. Send `{}`.',
          },
        },
      },
    }

    changes.push(
      `Added the required (but undeclared) empty JSON request body to ${operationId} (${method.toUpperCase()} ${path}); a body-less POST returns 415`,
    )
  }

  return changes
}

/**
 * Content-Type and Content-Length belong to the transport. A spec that models
 * them as caller-supplied header parameters produces an SDK whose callers can
 * break the request framing, so drop them if they ever appear.
 */
function normalizeTransportHeaderParameters(
  document: OpenApiDocument,
): string[] {
  const changes: string[] = []

  for (const { path, method, operationId, operation } of listOperations(
    document,
  )) {
    if (!Array.isArray(operation.parameters)) {
      continue
    }

    const kept = operation.parameters.filter((parameter) => {
      if (
        !isRecord(parameter) ||
        parameter.in !== 'header' ||
        typeof parameter.name !== 'string' ||
        !TRANSPORT_HEADER_PARAMETERS.has(parameter.name.toLowerCase())
      ) {
        return true
      }

      changes.push(
        `Removed the transport header parameter "${parameter.name}" from ${operationId} (${method.toUpperCase()} ${path}); fetch owns that header`,
      )
      return false
    })

    operation.parameters = kept
  }

  return changes
}

/** Property names that hold a webhook event type, in either spelling. */
const EVENT_TYPE_PROPERTY_NAMES = ['event_type', 'event_types'] as const

/**
 * Terac documents webhook event types as an OPEN set: new ones appear without
 * a breaking change, and `GET /hooks/event-types` is the source of truth. The
 * document nevertheless pins every event-type field to the two values that
 * exist today — the listing, the subscription responses, and the create and
 * update bodies.
 *
 * That closes the exact door `listEventTypes()` exists to open: a newly
 * returned type would not type-check, and the generated Zod schema would
 * reject it. Drop the enum wherever a schema describes an event type, leaving
 * a plain string.
 *
 * @see https://terac.com/docs/developers/guides/webhooks
 */
function normalizeOpenWebhookEventTypes(document: OpenApiDocument): string[] {
  const changes: string[] = []

  const dropEnum = (schema: unknown, where: string): void => {
    if (isRecord(schema) && Array.isArray(schema.enum)) {
      delete schema.enum
      changes.push(
        `Removed the closed event-type enum from ${where}; Terac adds event types without a version bump, so the set is open`,
      )
    }
  }

  const visit = (node: unknown, where: string): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry, where)
      }
      return
    }

    if (!isRecord(node)) {
      return
    }

    const properties = node.properties
    if (isRecord(properties)) {
      for (const name of EVENT_TYPE_PROPERTY_NAMES) {
        const property = properties[name]
        if (!isRecord(property)) {
          continue
        }
        dropEnum(property, `${where} at ${name}`)
        dropEnum(property.items, `${where} at ${name}[]`)
      }
    }

    for (const value of Object.values(node)) {
      visit(value, where)
    }
  }

  for (const { path, method, operationId, operation } of listOperations(
    document,
  )) {
    visit(operation, `${operationId} (${method.toUpperCase()} ${path})`)
  }

  return changes
}

/**
 * Every workaround this repository keeps against the provider's document, in
 * the order they are applied.
 *
 * Exported so the same code — not a second copy of it — can be replayed over
 * the committed document when a normalisation is added. `tests/schema.test.ts`
 * asserts the outcome on `schemas/openapi.json`.
 */
export function normalizeDocument(document: OpenApiDocument): string[] {
  return [
    ...normalizeErrorSchemas(document),
    ...normalizeMissingResponses(document),
    ...normalizeBodylessPosts(document),
    ...normalizeTransportHeaderParameters(document),
    ...normalizeOpenWebhookEventTypes(document),
  ]
}

function assertUsable(document: OpenApiDocument): void {
  if (typeof document.openapi !== 'string') {
    throw new Error('Fetched document is missing a top-level `openapi` version')
  }

  const paths = Object.keys(document.paths ?? {})
  if (paths.length === 0) {
    throw new Error('Fetched document contains no paths')
  }

  const servers = document.servers ?? []
  if (
    servers.length !== 1 ||
    servers[0]?.url !== 'https://terac.com/api/external/v2'
  ) {
    throw new Error(
      `Unexpected servers block: ${JSON.stringify(servers)}. Terac declares exactly one server; review before vendoring.`,
    )
  }
}

async function main(): Promise<void> {
  console.log(`Fetching ${SPEC_URL} ...`)
  const response = await fetch(SPEC_URL, { redirect: 'error' })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenAPI document: ${String(response.status)} ${response.statusText}`,
    )
  }

  const fetched: unknown = await response.json()
  if (!isRecord(fetched)) {
    throw new Error('Fetched document is not a JSON object')
  }

  const document: OpenApiDocument = fetched
  assertUsable(document)

  const changes = normalizeDocument(document)

  console.log(`\nApplied ${String(changes.length)} normalisation(s):`)
  for (const change of changes) {
    console.warn(`  - ${change}`)
  }
  if (changes.length === 0) {
    console.log(
      '  (none — the provider spec now matches the documented behaviour; the workarounds in this script can be deleted)',
    )
  }

  // Validate the NORMALISED document in memory, before anything is written.
  // `validate` dereferences its argument in place, so hand it a deep clone and
  // keep the serialisable original. `JSON.parse` returns `any`, which is how
  // this reaches SwaggerParser's typed parameter without a type assertion.
  console.log('\nValidating the normalised document...')
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  await SwaggerParser.validate(JSON.parse(JSON.stringify(document)))
  console.log('Valid OpenAPI schema.')

  // Only now replace the committed file, and do it atomically so an
  // interrupted run cannot leave a truncated spec behind.
  const temporaryPath = `${OUTPUT_PATH}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(document, null, 2)}\n`,
    'utf-8',
  )
  await rename(temporaryPath, OUTPUT_PATH)

  const pathCount = Object.keys(document.paths ?? {}).length
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length
  console.log(
    `\nWrote ${OUTPUT_PATH} (openapi ${String(document.openapi)}, ${String(pathCount)} paths, ${String(schemaCount)} schemas)`,
  )
  console.log("Run 'pnpm run generate' to regenerate the client.")
}

// Only fetch when this file is the process entry point. Importing it — to
// replay `normalizeDocument` over the committed copy, for instance — must not
// reach the network.
const isEntryPoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
