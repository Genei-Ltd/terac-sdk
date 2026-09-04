/**
 * Zod schemas generated from Terac's OpenAPI document.
 *
 * Terac names only five component schemas, all errors, so most schemas here are
 * per-operation: `zGetSubmissionsBySubmissionIdResponse`,
 * `zPostOpportunitiesData`, and so on. Compose them into your own schemas when
 * you want to validate what you received rather than trust it.
 *
 * The generated file imports from `zod/v4`, which resolves on both `zod@3.25+`
 * and `zod@4`.
 */
export * from './generated/zod.gen'
