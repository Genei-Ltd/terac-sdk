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

type OpenApiDocument = Record<string, unknown> & {
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

  const changes = [
    ...normalizeErrorSchemas(document),
    ...normalizeMissingResponses(document),
    ...normalizeBodylessPosts(document),
    ...normalizeTransportHeaderParameters(document),
  ]

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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
