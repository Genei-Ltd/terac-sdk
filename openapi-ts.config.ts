import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  // Always the committed, normalised document. `pnpm run schema:update`
  // is the only thing that talks to the network.
  input: './schemas/openapi.json',
  output: './src/generated',
  plugins: [
    '@hey-api/typescript',
    {
      name: '@hey-api/client-fetch',
      // Terac declares exactly one server and has no sandbox, so the
      // generated default matches the vendored document.
      baseUrl: 'https://terac.com/api/external/v2',
    },
    {
      client: '@hey-api/client-fetch',
      name: '@hey-api/sdk',
      operations: {
        containerName: 'GeneratedTeracSdk',
        methods: 'instance',
        nesting: 'id',
        strategy: 'single',
      },
    },
    {
      name: 'zod',
      compatibilityVersion: 4,
    },
  ],
})
