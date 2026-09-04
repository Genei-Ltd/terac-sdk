/**
 * Package smoke tests: the built artefacts load in both module systems, and
 * every declared export path resolves.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const run = (script: string, mode: 'esm' | 'cjs'): string =>
  execFileSync(
    process.execPath,
    ['--input-type', mode === 'esm' ? 'module' : 'commonjs', '-e', script],
    { cwd: repoRoot, encoding: 'utf-8' },
  ).trim()

beforeAll(() => {
  if (!existsSync(join(repoRoot, 'dist', 'index.mjs'))) {
    // `pnpm run check` builds before testing; this covers a bare `vitest run`.
    execFileSync('pnpm', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' })
  }
}, 180_000)

type PackageJson = {
  exports: Record<string, unknown>
  main: string
  module: string
  types: string
}

const packageJson: PackageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
)

describe('package exports', () => {
  test('every file named by the export map exists', () => {
    const files: string[] = []
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        if (value.startsWith('./')) {
          files.push(value)
        }
        return
      }
      if (typeof value === 'object' && value !== null) {
        for (const entry of Object.values(value)) {
          collect(entry)
        }
      }
    }
    collect(packageJson.exports)
    collect(packageJson.main)
    collect(packageJson.module)
    collect(packageJson.types)

    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      expect(existsSync(join(repoRoot, file)), `${file} is missing`).toBe(true)
    }
  })

  test('the root entry loads under ESM', () => {
    const output = run(
      `import { TeracSdk, TeracApiError, TERAC_BASE_URL } from './dist/index.mjs'
       const sdk = new TeracSdk({ apiKey: 'tk_smoke' })
       console.log([
         typeof TeracSdk,
         typeof TeracApiError,
         TERAC_BASE_URL,
         Object.keys(sdk).join('|'),
       ].join(' '))`,
      'esm',
    )
    expect(output).toBe(
      'function function https://terac.com/api/external/v2 projects|filters|opportunities|submissions|quotes|feasibility|organizations|webhooks',
    )
  })

  test('the root entry loads under CJS', () => {
    const output = run(
      `const { TeracSdk, TERAC_BASE_URL } = require('./dist/index.cjs')
       const sdk = new TeracSdk({ apiKey: 'tk_smoke' })
       console.log([typeof TeracSdk, TERAC_BASE_URL, JSON.stringify(sdk.projects)].join(' '))`,
      'cjs',
    )
    expect(output).toBe('function https://terac.com/api/external/v2 {}')
  })

  test('the webhooks subpath loads under ESM and CJS', () => {
    const script = (importer: string) => `${importer}
       console.log([
         typeof verifyTeracWebhook,
         TERAC_SIGNATURE_HEADER,
         String(DEFAULT_WEBHOOK_TOLERANCE_SECONDS),
       ].join(' '))`

    expect(
      run(
        script(
          `import { verifyTeracWebhook, TERAC_SIGNATURE_HEADER, DEFAULT_WEBHOOK_TOLERANCE_SECONDS } from './dist/webhooks.mjs'`,
        ),
        'esm',
      ),
    ).toBe('function x-terac-request-signature 300')

    expect(
      run(
        script(
          `const { verifyTeracWebhook, TERAC_SIGNATURE_HEADER, DEFAULT_WEBHOOK_TOLERANCE_SECONDS } = require('./dist/webhooks.cjs')`,
        ),
        'cjs',
      ),
    ).toBe('function x-terac-request-signature 300')
  })

  test('the callback subpath loads under ESM and CJS', () => {
    const script = (importer: string) => `${importer}
       console.log(buildTeracCompletionCallbackUrl({ submissionId: 's1', result: 'screened_out' }))`

    const expected =
      'https://terac.com/api/external/callback?teracSubmissionId=s1&result=screened_out'

    expect(
      run(
        script(
          `import { buildTeracCompletionCallbackUrl } from './dist/callback.mjs'`,
        ),
        'esm',
      ),
    ).toBe(expected)

    expect(
      run(
        script(
          `const { buildTeracCompletionCallbackUrl } = require('./dist/callback.cjs')`,
        ),
        'cjs',
      ),
    ).toBe(expected)
  })

  test('the zod subpath loads under ESM and CJS', () => {
    expect(
      run(
        `import * as schemas from './dist/zod.mjs'
         console.log(typeof schemas.zGetProjectsByProjectIdResponse.parse)`,
        'esm',
      ),
    ).toBe('function')

    expect(
      run(
        `const schemas = require('./dist/zod.cjs')
         console.log(typeof schemas.zGetProjectsByProjectIdResponse.parse)`,
        'cjs',
      ),
    ).toBe('function')
  })

  test('the vendored spec is published and loadable', () => {
    expect(existsSync(join(repoRoot, 'schemas', 'openapi.json'))).toBe(true)
    const spec: { openapi?: string; paths?: Record<string, unknown> } =
      JSON.parse(
        readFileSync(join(repoRoot, 'schemas', 'openapi.json'), 'utf-8'),
      )
    expect(spec.openapi).toBe('3.0.3')
    expect(Object.keys(spec.paths ?? {})).toHaveLength(28)
  })
})
