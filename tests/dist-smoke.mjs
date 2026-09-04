/**
 * Smoke tests for the built bundles, on the oldest runtime the package claims
 * to support.
 *
 * `engines.node` promises Node 18, but the development toolchain — Vite,
 * Vitest, ESLint, tsdown — needs Node 20 or newer, so nothing here may depend
 * on it. Plain `node:test` and `node:assert`, against `dist/`, with `zod` as
 * the only installed dependency. Build first: `pnpm run build`.
 *
 * This is the whole of the packaging coverage: what loads, what the export map
 * promises, and the transport behaviour the bundles have to keep. The Vitest
 * suites next to it run against `src/`.
 */
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const distPath = (file) => `${projectRoot}dist/${file}`
const require = createRequire(import.meta.url)

if (!existsSync(distPath('index.mjs'))) {
  throw new Error('dist/ is missing — run `pnpm run build` first')
}

const API_KEY = 'tk_smoke_84f2'

const servers = []

const startServer = async (handler) => {
  const server = createServer(handler)
  servers.push(server)
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return `http://127.0.0.1:${server.address().port}`
}

after(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections()
          server.close(resolve)
        }),
    ),
  )
})

const esm = await import(pathToFileURL(distPath('index.mjs')).href)
const cjs = require(distPath('index.cjs'))

test('every export map target exists', () => {
  const packageJson = JSON.parse(
    readFileSync(`${projectRoot}package.json`, 'utf-8'),
  )

  const targets = []
  const collect = (node) => {
    if (typeof node === 'string') {
      targets.push(node)
      return
    }
    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(collect)
    }
  }
  collect(packageJson.exports)

  assert.ok(targets.length > 0)
  for (const target of targets) {
    assert.ok(
      existsSync(`${projectRoot}${target.replace(/^\.\//, '')}`),
      `missing export target ${target}`,
    )
  }
})

test('the root entry loads as ESM and as CJS', () => {
  for (const loaded of [esm, cjs]) {
    assert.equal(typeof loaded.TeracSdk, 'function')
    assert.equal(typeof loaded.TeracApiError, 'function')
    assert.equal(loaded.TERAC_BASE_URL, 'https://terac.com/api/external/v2')
  }
})

test('the ./webhooks subpath loads and verifies a signature', async () => {
  const loaded = [
    await import(pathToFileURL(distPath('webhooks.mjs')).href),
    require(distPath('webhooks.cjs')),
  ]

  const secret = 'whsec_smoke_53bdc0f49fde'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const payload = JSON.stringify({
    event_type: 'submission.status_changed',
    event_id: 'evt_smoke_1',
    data: { submission_id: 'sub_1', status: 'completed' },
  })
  const signature = createHmac('sha256', secret)
    .update(timestamp, 'utf-8')
    .update(payload, 'utf-8')
    .digest('base64')

  for (const webhooks of loaded) {
    const delivery = webhooks.verifyTeracWebhook({
      payload,
      headers: {
        [webhooks.TERAC_SIGNATURE_HEADER]: signature,
        [webhooks.TERAC_TIMESTAMP_HEADER]: timestamp,
      },
      secret,
    })
    assert.equal(delivery.eventId, 'evt_smoke_1')

    assert.throws(
      () =>
        webhooks.verifyTeracWebhook({
          payload,
          headers: {
            [webhooks.TERAC_SIGNATURE_HEADER]: signature,
            [webhooks.TERAC_TIMESTAMP_HEADER]: timestamp,
          },
          secret: 'wrong-secret',
        }),
      (error) => webhooks.isTeracWebhookVerificationError(error),
    )
  }
})

test('the ./callback subpath loads and parses a task URL', async () => {
  const loaded = [
    await import(pathToFileURL(distPath('callback.mjs')).href),
    require(distPath('callback.cjs')),
  ]

  for (const callback of loaded) {
    const params = callback.parseTeracTaskUrlParams(
      '/session?teracSubmissionId=sub_1&taskId=task_1',
    )
    assert.equal(params.submissionId, 'sub_1')
    assert.equal(params.taskId, 'task_1')
  }
})

test('the ./zod subpath loads as ESM and as CJS', async () => {
  const zodEsm = await import(pathToFileURL(distPath('zod.mjs')).href)
  const zodCjs = require(distPath('zod.cjs'))

  for (const loaded of [zodEsm, zodCjs]) {
    assert.ok(loaded.zErrorBadRequest)
  }
})

test('the built bundle sends a request with the bearer key', async () => {
  const received = []
  const baseUrl = await startServer((request, response) => {
    received.push(request)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('[]')
  })

  const sdk = new esm.TeracSdk({ apiKey: API_KEY, baseUrl })
  await sdk.projects.list()

  assert.equal(received.length, 1)
  assert.equal(received[0].url, '/projects')
  assert.equal(received[0].headers.authorization, `Bearer ${API_KEY}`)
})

test('a redirect is refused rather than followed with the key', async () => {
  const receivedByTarget = []
  const targetUrl = await startServer((request, response) => {
    receivedByTarget.push(request.headers)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('[]')
  })
  const redirectingUrl = await startServer((_request, response) => {
    response.writeHead(302, { Location: `${targetUrl}/projects` })
    response.end()
  })

  const sdk = new esm.TeracSdk({ apiKey: API_KEY, baseUrl: redirectingUrl })

  const error = await sdk.projects.list().catch((caught) => caught)

  assert.equal(error.name, 'TeracTransportError')
  assert.equal(receivedByTarget.length, 0)
})

test('a stalled response trips the configured timeout', async () => {
  const baseUrl = await startServer(() => {
    // Never answer.
  })

  const sdk = new esm.TeracSdk({ apiKey: API_KEY, baseUrl, timeoutMs: 250 })

  const error = await sdk.projects.list().catch((caught) => caught)

  assert.equal(error.name, 'TeracTimeoutError')
  assert.equal(error.timeoutMs, 250)
})
