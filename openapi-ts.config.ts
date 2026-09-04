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
        // Flat functions, not an instance class. The class form keeps a public
        // static registry of every instance it constructs, and each instance
        // holds the configured client, so `Sdk.__registry.get().client` hands
        // any caller the API key. Flat functions take the client as an
        // argument, so the configured one stays in a `#private` field.
        nesting: 'id',
        strategy: 'flat',
      },
    },
    {
      name: 'zod',
      compatibilityVersion: 4,
    },
  ],
})
