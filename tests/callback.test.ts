import { describe, expect, test } from 'vitest'
import {
  TERAC_CALLBACK_RESULTS,
  TERAC_COMPLETION_CALLBACK_URL,
  buildTeracCompletionCallbackUrl,
  isTeracCallbackResult,
  parseTeracTaskUrlParams,
} from '../src/callback'

describe('buildTeracCompletionCallbackUrl', () => {
  test('always writes an explicit result', () => {
    // Terac assumes `completed` when `result` is missing, so a screened-out
    // participant would silently be recorded as finished.
    for (const result of TERAC_CALLBACK_RESULTS) {
      const url = new URL(
        buildTeracCompletionCallbackUrl({ submissionId: 'sub_1', result }),
      )
      expect(url.searchParams.get('result')).toBe(result)
      expect(url.searchParams.get('teracSubmissionId')).toBe('sub_1')
    }
  })

  test('targets the documented endpoint, outside the v2 base path', () => {
    const url = buildTeracCompletionCallbackUrl({
      submissionId: 'sub_1',
      result: 'completed',
    })
    expect(url.startsWith(TERAC_COMPLETION_CALLBACK_URL)).toBe(true)
    expect(TERAC_COMPLETION_CALLBACK_URL).toBe(
      'https://terac.com/api/external/callback',
    )
    expect(url).not.toContain('/api/external/v2')
  })

  test('percent-encodes an id that needs it', () => {
    const url = new URL(
      buildTeracCompletionCallbackUrl({
        submissionId: 'sub 1&result=completed',
        result: 'rejected',
      }),
    )
    expect(url.searchParams.get('teracSubmissionId')).toBe(
      'sub 1&result=completed',
    )
    expect(url.searchParams.get('result')).toBe('rejected')
  })

  test('rejects an empty submission id', () => {
    expect(() =>
      buildTeracCompletionCallbackUrl({
        submissionId: '  ',
        result: 'completed',
      }),
    ).toThrow(TypeError)
  })

  test('honours a base URL override for tests', () => {
    const url = buildTeracCompletionCallbackUrl({
      submissionId: 'sub_1',
      result: 'quota_full',
      baseUrl: 'http://127.0.0.1:9/callback',
    })
    expect(url.startsWith('http://127.0.0.1:9/callback?')).toBe(true)
  })
})

describe('isTeracCallbackResult', () => {
  test('accepts the four documented values only', () => {
    expect(isTeracCallbackResult('completed')).toBe(true)
    expect(isTeracCallbackResult('screened_out')).toBe(true)
    expect(isTeracCallbackResult('quota_full')).toBe(true)
    expect(isTeracCallbackResult('rejected')).toBe(true)
    expect(isTeracCallbackResult('complete')).toBe(false)
    expect(isTeracCallbackResult(undefined)).toBe(false)
  })
})

describe('parseTeracTaskUrlParams', () => {
  test('reads the parameters Terac appends to a task URL', () => {
    expect(
      parseTeracTaskUrlParams(
        'https://survey.example.com/s/abc?teracSubmissionId=sub_1&submissionId=sub_1&taskId=tsk_2',
      ),
    ).toEqual({ submissionId: 'sub_1', taskId: 'tsk_2' })
  })

  test('accepts the alias alone', () => {
    expect(parseTeracTaskUrlParams('?submissionId=sub_9')).toEqual({
      submissionId: 'sub_9',
    })
  })

  test('accepts a URL, URLSearchParams, a bare query string and an object', () => {
    const expected = { submissionId: 'sub_1' }
    expect(
      parseTeracTaskUrlParams(
        new URL('https://x.test/?teracSubmissionId=sub_1'),
      ),
    ).toEqual(expected)
    expect(
      parseTeracTaskUrlParams(
        new URLSearchParams({ teracSubmissionId: 'sub_1' }),
      ),
    ).toEqual(expected)
    expect(parseTeracTaskUrlParams('teracSubmissionId=sub_1')).toEqual(expected)
    expect(parseTeracTaskUrlParams({ teracSubmissionId: 'sub_1' })).toEqual(
      expected,
    )
  })

  test('throws when the two id parameters disagree', () => {
    expect(() =>
      parseTeracTaskUrlParams('?teracSubmissionId=sub_1&submissionId=sub_2'),
    ).toThrow(/disagree/)
  })

  test('throws when one parameter appears twice', () => {
    expect(() =>
      parseTeracTaskUrlParams(
        '?teracSubmissionId=sub_1&teracSubmissionId=sub_2',
      ),
    ).toThrow(/more than one/)
  })

  test('throws when the id is missing, rather than guessing', () => {
    expect(() => parseTeracTaskUrlParams('?taskId=tsk_2')).toThrow(
      /Missing teracSubmissionId/,
    )
  })
})
