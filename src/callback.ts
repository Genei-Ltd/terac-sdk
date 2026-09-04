/**
 * The participant completion callback.
 *
 * Hand-written: this endpoint is in neither the OpenAPI document nor the
 * developer reference, and it sits outside the v2 base path. It is a browser
 * redirect, not a server-to-server call — unauthenticated, and fired by the
 * participant's browser when they finish your task.
 *
 * Verified live on 2026-09-04: the endpoint answers `307` to
 * `https://terac.com/opportunity/complete?result=…`, with `reason=not_found`
 * for an unknown submission and `reason=invalid_params` for a missing id or an
 * unrecognised `result`.
 *
 * @see https://terac.com/docs/experts (participant-facing flow)
 */

/** Where a finished participant is sent. Outside the `/api/external/v2` base. */
export const TERAC_COMPLETION_CALLBACK_URL =
  'https://terac.com/api/external/callback'

/** Query parameter Terac appends to your `task_url`, and prefers on the way back. */
export const TERAC_SUBMISSION_ID_PARAM = 'teracSubmissionId'

/** The same value under a second name, for tools that read this key instead. */
export const TERAC_SUBMISSION_ID_ALIAS_PARAM = 'submissionId'

/** The task within the opportunity, also appended to your `task_url`. */
export const TERAC_TASK_ID_PARAM = 'taskId'

/**
 * Macros you can place anywhere in a `task_url` when the tracking parameters
 * must land in a parameter of your own, or in a path segment.
 */
export const TERAC_SUBMISSION_ID_MACRO = '{TERAC_SUBMISSION_ID}'
export const TERAC_TASK_ID_MACRO = '{TERAC_TASK_ID}'

/**
 * How the participant finished.
 *
 * - `completed` — finished the task. Auto-approved.
 * - `screened_out` — failed your in-survey screener.
 * - `quota_full` — the relevant quota was already full when they arrived.
 * - `rejected` — disqualified for quality or fraud reasons.
 */
export type TeracCallbackResult =
  'completed' | 'screened_out' | 'quota_full' | 'rejected'

export const TERAC_CALLBACK_RESULTS: readonly TeracCallbackResult[] = [
  'completed',
  'screened_out',
  'quota_full',
  'rejected',
]

const TERAC_CALLBACK_RESULT_NAMES: ReadonlySet<string> = new Set(
  TERAC_CALLBACK_RESULTS,
)

export const isTeracCallbackResult = (
  value: unknown,
): value is TeracCallbackResult =>
  typeof value === 'string' && TERAC_CALLBACK_RESULT_NAMES.has(value)

export type BuildTeracCompletionCallbackUrlOptions = {
  /** The `teracSubmissionId` you captured from the inbound task URL. */
  submissionId: string
  /**
   * How the participant finished. Required by this builder even though the API
   * defaults it: an omitted `result` silently becomes `completed`, which
   * quietly marks screened-out and over-quota participants as finished.
   */
  result: TeracCallbackResult
  /** Override the callback base, for a test double. */
  baseUrl?: string
}

/**
 * Builds the URL to send the participant's browser to when they finish.
 *
 * `result` is always written to the query string. Terac treats a missing
 * `result` as `completed`, so leaving it out is how screen-outs get recorded as
 * completions.
 *
 * ```ts
 * const url = buildTeracCompletionCallbackUrl({
 *   submissionId,
 *   result: 'screened_out',
 * })
 * ```
 */
export const buildTeracCompletionCallbackUrl = ({
  submissionId,
  result,
  baseUrl = TERAC_COMPLETION_CALLBACK_URL,
}: BuildTeracCompletionCallbackUrlOptions): string => {
  if (typeof submissionId !== 'string' || submissionId.trim().length === 0) {
    throw new TypeError('submissionId must be a non-empty string')
  }

  if (!isTeracCallbackResult(result)) {
    throw new TypeError(
      `result must be one of ${TERAC_CALLBACK_RESULTS.join(', ')}`,
    )
  }

  const url = new URL(baseUrl)
  url.searchParams.set(TERAC_SUBMISSION_ID_PARAM, submissionId.trim())
  url.searchParams.set('result', result)
  return url.toString()
}

/** Anything a caller might hand the inbound parser. */
export type TeracQuerySource =
  string | URL | URLSearchParams | Record<string, string | string[] | undefined>

/** What Terac appends to your `task_url` when it forwards a participant. */
export type TeracTaskUrlParams = {
  /** The submission the arriving participant belongs to. */
  submissionId: string
  /** The task within the opportunity, when Terac sends one. */
  taskId?: string
}

/** `new URL` for a string that is an absolute URL, `undefined` for anything else. */
const asAbsoluteUrl = (source: string): URL | undefined => {
  try {
    return new URL(source)
  } catch {
    return undefined
  }
}

/**
 * A host that cannot exist, for resolving a relative URL. `.invalid` is
 * reserved for exactly this. Nothing is ever requested from it.
 */
const RELATIVE_URL_BASE = 'https://placeholder.invalid'

/**
 * `new URL` for a relative request URL.
 *
 * `/session?teracSubmissionId=sub_1#done` is the normal shape of Node's
 * `IncomingMessage.url`, and `new URL` rejects it without a base. Resolving it
 * against a placeholder origin parses the query and the fragment the same way
 * an absolute URL does.
 *
 * A bare `key=value` string is deliberately excluded: it is a query string, not
 * a relative URL, and resolving it would make it a PATH and lose every
 * parameter.
 */
const asRelativeUrl = (source: string): URL | undefined => {
  if (!source.startsWith('/') && !source.startsWith('?')) {
    return undefined
  }
  try {
    return new URL(source, RELATIVE_URL_BASE)
  } catch {
    return undefined
  }
}

/**
 * The query of a bare query string, with a leading `?` and any fragment
 * removed. `#` cannot legally appear unescaped inside a query, so everything
 * from the first one is a fragment rather than part of a parameter value.
 */
const asBareQuery = (source: string): string => {
  const withoutFragment = source.split('#')[0] ?? ''
  return withoutFragment.startsWith('?')
    ? withoutFragment.slice(1)
    : withoutFragment
}

const readParam = (
  source: TeracQuerySource,
  name: string,
): string | undefined => {
  let params: URLSearchParams

  if (source instanceof URLSearchParams) {
    params = source
  } else if (source instanceof URL) {
    params = source.searchParams
  } else if (typeof source === 'string') {
    // A URL, absolute or relative, is parsed as a URL, so its fragment stays
    // out of the query. Slicing at the first `?` instead would read
    // `…?teracSubmissionId=sub_1#done` as the id `sub_1#done`. Only a bare
    // query string, which is not a URL at all, is read as one.
    const url = asAbsoluteUrl(source) ?? asRelativeUrl(source)
    params = url ? url.searchParams : new URLSearchParams(asBareQuery(source))
  } else {
    const value = source[name]
    if (Array.isArray(value)) {
      if (value.length > 1) {
        throw new TypeError(`Received more than one ${name} query parameter`)
      }
      return value[0]
    }
    return value
  }

  const all = params.getAll(name)
  if (all.length > 1) {
    throw new TypeError(`Received more than one ${name} query parameter`)
  }
  return all[0]
}

/**
 * Reads the tracking parameters off the URL a participant arrives on.
 *
 * Terac appends `teracSubmissionId`, `submissionId` (the same value) and
 * `taskId` to your `task_url`. Both id parameters are accepted; when both are
 * present and disagree, that is a rewritten link, so this throws rather than
 * guessing which one is real.
 *
 * ```ts
 * const { submissionId } = parseTeracTaskUrlParams(request.url)
 * ```
 */
export const parseTeracTaskUrlParams = (
  source: TeracQuerySource,
): TeracTaskUrlParams => {
  const preferred = readParam(source, TERAC_SUBMISSION_ID_PARAM)
  const alias = readParam(source, TERAC_SUBMISSION_ID_ALIAS_PARAM)

  if (preferred !== undefined && alias !== undefined && preferred !== alias) {
    throw new TypeError(
      `${TERAC_SUBMISSION_ID_PARAM} and ${TERAC_SUBMISSION_ID_ALIAS_PARAM} disagree; they always carry the same value`,
    )
  }

  const submissionId = preferred ?? alias
  if (submissionId === undefined || submissionId.length === 0) {
    throw new TypeError(
      `Missing ${TERAC_SUBMISSION_ID_PARAM}; the participant did not arrive through Terac, or your tool dropped the parameter`,
    )
  }

  const taskId = readParam(source, TERAC_TASK_ID_PARAM)

  return taskId === undefined || taskId.length === 0
    ? { submissionId }
    : { submissionId, taskId }
}
