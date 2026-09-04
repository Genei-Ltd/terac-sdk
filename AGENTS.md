# Project Guidelines

What to do after the Terac SDK client is regenerated — when the provider's
OpenAPI document changes, or new endpoints appear. Follow the checklist to keep
the repository consistent.

---

## Package management with pnpm

This project uses **pnpm**. Always use pnpm instead of npm, Bun or Yarn.

- **Install dependencies**: `pnpm install` / `pnpm add` / `pnpm remove`
- **Run scripts**: `pnpm run <script>`

New dependency versions must be at least seven days old before pnpm will
install them (`minimumReleaseAge` in `pnpm-workspace.yaml`). If a just-released
version fails to resolve, this is why. Do not work around it.

### Node versions

Two different numbers, on purpose:

- **Development**: Node 22.18 or newer. `@hey-api/openapi-ts` requires it, and
  ESLint and Vitest need Node 20+. `.node-version` pins it.
- **Runtime**: Node 18.17 or newer, which is what `engines.node` and the tsdown
  `target` declare.

Scripts must run on the development version but must not assume anything newer
than the runtime floor in shipped code. Do not use `import.meta.dirname` in
`scripts/**`; use `fileURLToPath(new URL('…', import.meta.url))`.

### Key scripts

- `pnpm run schema:update` — the **only** script that uses the network. Fetches
  Terac's OpenAPI document, normalises and validates it in memory, then
  atomically replaces `schemas/openapi.json`.
- `pnpm run generate` — regenerates `src/generated/**` from the **committed**
  schema, then formats it. Offline and reproducible.
- `pnpm run generate:check` — regenerates and fails if the committed output
  differs. The generator writes into `src/generated` (the output path is in
  `openapi-ts.config.ts`), so the script copies the committed tree aside first
  and an EXIT trap restores it however the run ends. A failure never leaves a
  half-regenerated worktree.
- `pnpm run tc` — type-check without emitting.
- `pnpm run lint` — ESLint across the repository.
- `pnpm run test` — Vitest.
- `pnpm run format` / `pnpm run format:write` — Prettier check / fix.
- `pnpm run build` — dual ESM/CJS bundles in `dist/` via tsdown.
- `pnpm run check` — schema validation, `generate:check`, type-check, lint,
  format check, build and tests, in that order. `build` runs before `test`
  because the package smoke tests load `dist/`.

---

## Refreshing the vendored spec

1. Run `pnpm run schema:update`.
2. **Read the normalisation log.** Each line names a bug in the provider's
   document that this repository works around. A line that stops appearing
   means Terac fixed it, and the corresponding branch in
   `scripts/update-schema.ts` should be deleted along with its README row.
3. Review the diff on `schemas/openapi.json`. The API is beta, so shapes change.
4. Run `pnpm run generate` and review `src/generated/**`.

---

## After regenerating the client

- **Update the `TeracSdk` facade**
  - Every generated operation must be wrapped. `tests/operations.test.ts` holds
    an explicit generated-operation-to-route table and compares it to the
    facade table by NAME, so a new endpoint fails the suite until it is listed
    and wrapped. Do not replace that with a count.
  - Add the new method to the right module (`projects`, `filters`,
    `opportunities`, `submissions`, `quotes`, `feasibility`, `organizations`,
    `webhooks`), with an optional trailing `options?: TeracRequestOptions`
    forwarded as `...toOptions(options)`.
  - A `POST` with no meaningful body must still send `body: EMPTY_BODY`; Terac
    returns `415` for a body-less `POST`.
  - Add a row to the table in `tests/operations.test.ts` with the method, path,
    query and body.
  - Copy the endpoint docstring from `src/generated/sdk.gen.ts` into the facade
    JSDoc — the summary AND the description, verbatim, before any note of your
    own. The generated descriptions carry things the signature cannot say, such
    as how an opportunity is priced or that an applicant is invisible to the
    submissions listing. `tests/docs.test.ts` compares the two with whitespace
    normalised, so a summary that drops the description fails.
  - Mark anything absent from `https://terac.com/docs/developers/reference` as
    **undocumented** in JSDoc and in the README table of undocumented
    endpoints. Both lists must name the same operations.

- **Update the domain aliases**
  - `src/domain.ts` aliases generated types, never redeclares them. If a new
    resource appears, add an alias rather than hand-writing a shape.

- **Update the hand-written modules**
  - `src/webhooks.ts` and `src/callback.ts` are hand-written because Terac's
    document does not describe deliveries or the completion callback. If the
    provider ever documents them in the spec, replace the hand-written code
    with generated types rather than keeping both.
  - Never turn `event_type` into a closed union. Terac adds event types without
    a version bump and tells you to read `GET /hooks/event-types`. The
    provider's document does declare them as enums, and
    `normalizeOpenWebhookEventTypes` in `scripts/update-schema.ts` strips them
    during vendoring; `tests/schema.test.ts` fails if one comes back.

- **Refresh documentation**
  - EVERY README TypeScript block is quoted **verbatim** from `examples/**`,
    one-liners included, and `tc` compiles those against the real types. Edit
    the example, then re-copy the block. `tests/docs.test.ts` fails if they
    drift, and every example file must appear in the README in full.
  - The Scripts table in the README must match `package.json`; the same test
    checks it.

---

## Code conventions

- Use `type`, not `interface`.
- Use `import type` for type-only imports.
- No TypeScript enums; prefer union literal types.
- **No `as` type assertions.** ESLint rejects them. Narrow with a guard, or
  reach a typed parameter through `JSON.parse` with a scoped eslint-disable and
  a comment explaining why.
- Credentials belong in ECMAScript `#private` fields, never in a TypeScript
  `private` or `protected` one — the latter is enumerable at runtime.
- Errors expose a redacted request summary, never a `Request` or a `Response`.
- Prefix unused parameters with `_`.
- Prettier formatting: no semicolons, single quotes, trailing commas.
- Never hand-edit `src/generated/**`; change the generator config or the
  normalisation in `scripts/update-schema.ts` instead.

Keep this file up to date whenever the workflow changes.
