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

describe('README examples', () => {
  test('there are examples to check', () => {
    expect(exampleSources.length).toBeGreaterThan(0)
    expect(fencedBlocks('ts').length).toBeGreaterThan(0)
  })

  // EVERY block, one-liners included. A snippet short enough to look harmless
  // is still a snippet that can stop compiling: the import paths and exported
  // names in it are exactly the kind of thing a refactor moves.
  test.each(fencedBlocks('ts').map((block, index) => ({ index, block })))(
    'ts block $index is quoted verbatim from an example file',
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

/**
 * AGENTS.md: "Copy the endpoint docstring from `src/generated/sdk.gen.ts` into
 * the facade JSDoc." The generated descriptions carry things a caller cannot
 * infer from the signature — how an opportunity is priced, that an applicant
 * is invisible to the submissions listing, that feasibility answers arrive out
 * of band. Summarising them away is how a facade quietly becomes worse
 * documentation than the endpoint it wraps.
 */
describe('facade JSDoc', () => {
  const generatedSource = readFileSync(
    join(repoRoot, 'src', 'generated', 'sdk.gen.ts'),
    'utf-8',
  )
  const facadeSource = readFileSync(join(repoRoot, 'src', 'sdk.ts'), 'utf-8')

  /**
   * Comment text with the `*` gutter and every line break taken out, so the
   * comparison is about the words rather than where they were wrapped.
   */
  const asProse = (comment: string): string =>
    comment
      .replace(/\/\*\*/g, '')
      .replace(/\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

  const generatedDocs = [
    ...generatedSource.matchAll(
      /\/\*\*\n((?:[ \t]*\*.*\n)*?)[ \t]*\*\/\s*\n\s*export const (\w+) = </g,
    ),
  ].map((match) => ({
    operation: match[2] ?? '',
    prose: asProse(match[1] ?? ''),
  }))

  test('there are generated docstrings to compare against', () => {
    expect(generatedDocs.length).toBeGreaterThan(30)
    expect(generatedDocs.every(({ prose }) => prose.length > 0)).toBe(true)
  })

  test.each(generatedDocs)(
    '$operation keeps its generated summary and description',
    ({ operation, prose }) => {
      const call = `await ${operation}<true>(`
      const callIndex = facadeSource.indexOf(call)
      expect(
        callIndex,
        `${operation} is not wrapped by the facade`,
      ).toBeGreaterThan(-1)

      const methodStart = facadeSource.lastIndexOf('\n  async ', callIndex)
      const docStart = facadeSource.lastIndexOf('\n  /**', methodStart)
      expect(docStart, `${operation} has no JSDoc block`).toBeGreaterThan(-1)

      const facadeProse = asProse(facadeSource.slice(docStart, methodStart))
      expect(facadeProse).toContain(prose)
    },
  )
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
    const operationCount = [...generated.matchAll(/^export const [a-z]/gm)]
      .length
    expect(readme).toContain(
      `All ${String(operationCount)} generated operations`,
    )
  })
})
