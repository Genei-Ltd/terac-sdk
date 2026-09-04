# Maintainer Guide

## Refreshing against the provider

Terac's v2 API is **beta**, so the vendored spec is expected to move.

1. `pnpm run schema:update` — fetches, normalises and validates in memory, then
   atomically replaces `schemas/openapi.json`. Read the normalisation log: each
   line is a provider bug this repository works around, and a line that stops
   appearing means the workaround can be deleted.
2. `pnpm run generate` — regenerates `src/generated/**` from the committed
   schema. Offline, so the same commit always generates the same output.
3. Follow the checklist in `AGENTS.md` to update the facade, the docs and the
   tests.
4. Verify:
   ```zsh
   pnpm run check
   ```
   That runs schema validation, `generate:check`, type-check, lint, format
   check, build and tests.

## Publishing

Not yet published. When it is:

- Update the version (`pnpm version <patch|minor|major>`).
- Push the version commit and tag (`git push && git push --tags`).
- `pnpm publish` — `prepublishOnly` runs `check` first.

### Version guidelines

- **patch**: bug fixes, documentation updates.
- **minor**: new endpoints, non-breaking facade changes.
- **major**: breaking changes to the facade surface.

Because the provider's API is beta, a provider-side breaking change is a
**major** bump here even though nothing in this repository was designed to
break.

## Node versions

- **Development**: Node 22.18+ (`.node-version`). Required by
  `@hey-api/openapi-ts`; ESLint and Vitest need Node 20+.
- **Runtime**: Node 18.17+ (`engines.node`, tsdown `target: 'node18'`).

Keep them separate. Shipped code must not use APIs newer than the runtime
floor; scripts may assume the development floor.

## Supply-chain policy

`pnpm-workspace.yaml` sets `minimumReleaseAge`, so pnpm refuses dependency
versions published in the last seven days. If a fresh release fails to resolve,
that is why. Do not work around it.

## Things that must not regress

These are the properties the test suite exists to defend. Do not relax one
without a replacement:

- `redirect: 'error'` on every request. Node forwards `Authorization` across
  redirects.
- The API key in a single `#private` field, absent from every enumerable path
  and from every thrown error.
- `timeoutMs` covering the response body, not only the response headers.
- Distinct error classes, with an HTTP error constructed only when a
  non-success response exists.
- The API key validated in the constructor, so a value that cannot be a header
  never reaches `Headers.set` and never lands on an error's `cause`.
- Response header VALUES on an allow-list, not a block-list.
- Webhook verification: constant-time compare, strict base64, duplicate headers
  rejected, a timestamp tolerance window that fails closed, the signed
  `event_id` preferred over the unsigned header, and an HMAC over the exact
  bytes supplied.
- A caller's abort reason preserved by identity, including falsy values.
- `pnpm run generate` never touching the network.
