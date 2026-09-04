/**
 * Keeps the README honest.
 *
 * Every TypeScript block in the README is quoted verbatim from `examples/**`,
 * which `tsc` compiles against the real published types via the `paths` mapping
 * in `tsconfig.json`. So "the README examples compile" is enforced by `tc`, and
 * "the README shows what compiles" is enforced here.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf-8')

const examplesDir = join(repoRoot, 'examples')
const exampleSources = readdirSync(examplesDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({
    name,
    source: readFileSync(join(examplesDir, name), 'utf-8'),
  }))

const fencedBlocks = (language: string): string[] => {
  const pattern = new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'g')
  return [...readme.matchAll(pattern)].map((match) => match[1] ?? '')
}

/** Blocks short enough to be a one-line illustration rather than an example. */
const isFragment = (block: string): boolean =>
  block.trim().split('\n').length <= 2

describe('README examples', () => {
  test('there are examples to check', () => {
    expect(exampleSources.length).toBeGreaterThan(0)
    expect(fencedBlocks('ts').length).toBeGreaterThan(0)
  })

  test.each(
    fencedBlocks('ts')
      .filter((block) => !isFragment(block))
      .map((block, index) => ({ index, block })),
  )(
    'multi-line ts block $index is quoted verbatim from an example file',
    ({ block }) => {
      const matching = exampleSources.find(({ source }) =>
        source.includes(block.trim()),
      )

      expect(
        matching?.name ??
          `NO EXAMPLE CONTAINS THIS BLOCK:\n${block.slice(0, 400)}`,
      ).toBeTypeOf('string')
      expect(matching).toBeDefined()
    },
  )

  test('every example file is quoted in the README', () => {
    const blocks = fencedBlocks('ts')
    for (const { name, source } of exampleSources) {
      const quoted = blocks.some((block) => block.trim() === source.trim())
      expect(quoted, `${name} is not quoted in README.md`).toBe(true)
    }
  })
})

type PackageJson = { scripts?: Record<string, string> }

describe('README scripts table', () => {
  const packageJson: PackageJson = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  )
  const scriptNames = Object.keys(packageJson.scripts ?? {}).sort()

  // Only the table under `## Scripts`; the README has other tables.
  const scriptsSection = readme.slice(readme.indexOf('\n## Scripts\n'))
  const scriptsTable = scriptsSection.slice(
    0,
    scriptsSection.indexOf('\n## ', 1),
  )

  const documented = [...scriptsTable.matchAll(/^\|\s*`([a-zA-Z:-]+)`\s*\|/gm)]
    .map((match) => match[1] ?? '')
    .sort()

  test('documents exactly the scripts package.json defines', () => {
    expect(documented).toEqual(scriptNames)
  })
})

describe('README claims that the code must keep true', () => {
  test('names the single base URL the spec declares', () => {
    const spec: { servers?: { url?: string }[] } = JSON.parse(
      readFileSync(join(repoRoot, 'schemas', 'openapi.json'), 'utf-8'),
    )
    expect(spec.servers).toHaveLength(1)
    expect(readme).toContain(spec.servers?.[0]?.url)
  })

  test('the operation count in the README matches the generated client', () => {
    const generated = readFileSync(
      join(repoRoot, 'src', 'generated', 'sdk.gen.ts'),
      'utf-8',
    )
    // `public static readonly __registry` is not an operation.
    const operationCount = [
      ...generated.matchAll(/^ {4}public (?!static)[a-z]/gm),
    ].length
    expect(readme).toContain(
      `All ${String(operationCount)} generated operations`,
    )
  })
})
