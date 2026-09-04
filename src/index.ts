export * from './generated/index'
export * as generated from './generated/client'

export { TeracSdk, TERAC_BASE_URL } from './sdk'
export type { TeracSdkOptions, TeracRequestOptions } from './sdk'

export * from './domain'

export {
  REDACTED,
  TeracApiError,
  TeracError,
  TeracRateLimitError,
  TeracResponseError,
  TeracTimeoutError,
  TeracTransportError,
  isTeracApiError,
  isTeracError,
  isTeracRateLimitError,
  isTeracResponseError,
  isTeracTimeoutError,
  isTeracTransportError,
  parseTeracErrorBody,
  summarizeRequest,
} from './errors'
export type {
  TeracApiErrorOptions,
  TeracErrorDetail,
  TeracErrorOptions,
  TeracRequestSummary,
  TeracResponseErrorOptions,
  TeracTimeoutErrorOptions,
} from './errors'
