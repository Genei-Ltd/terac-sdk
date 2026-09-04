import { createClient } from './generated/client'
import { GeneratedTeracSdk } from './generated/sdk.gen'
import type {
  DeleteHooksSubscriptionsBySubscriptionIdResponse,
  DeleteOpportunitiesByOpportunityIdResponse,
  GetFeasibilityRequestsByRequestIdResponse,
  GetFeasibilityRequestsData,
  GetFeasibilityRequestsResponse,
  GetFiltersByFilterSlugOptionsData,
  GetFiltersByFilterSlugOptionsResponse,
  GetFiltersResponse,
  GetHooksEventsData,
  GetHooksEventsResponse,
  GetHooksEventTypesResponse,
  GetHooksSubscriptionsBySubscriptionIdResponse,
  GetHooksSubscriptionsBySubscriptionIdSecretResponse,
  GetHooksSubscriptionsResponse,
  GetOpportunitiesByOpportunityIdApplicantsData,
  GetOpportunitiesByOpportunityIdApplicantsResponse,
  GetOpportunitiesByOpportunityIdResponse,
  GetOpportunitiesByOpportunityIdSubmissionsData,
  GetOpportunitiesByOpportunityIdSubmissionsResponse,
  GetOpportunitiesData,
  GetOpportunitiesResponse,
  GetOrganizationsCurrentContextResponse,
  GetProjectsByProjectIdResponse,
  GetProjectsData,
  GetProjectsResponse,
  GetQuotesByQuoteIdResponse,
  GetSubmissionsBySubmissionIdResponse,
  PatchHooksSubscriptionsBySubscriptionIdData,
  PatchHooksSubscriptionsBySubscriptionIdResponse,
  PatchOpportunitiesByOpportunityIdData,
  PatchOpportunitiesByOpportunityIdResponse,
  PatchProjectsByProjectIdData,
  PatchProjectsByProjectIdResponse,
  PostFeasibilityRequestsData,
  PostFeasibilityRequestsResponse,
  PostHooksSubscriptionsBySubscriptionIdResponse,
  PostHooksSubscriptionsBySubscriptionIdSecretResponse,
  PostHooksSubscriptionsData,
  PostHooksSubscriptionsResponse,
  PostOpportunitiesByOpportunityIdLaunchResponse,
  PostOpportunitiesByOpportunityIdPauseResponse,
  PostOpportunitiesByOpportunityIdResumeResponse,
  PostOpportunitiesByOpportunityIdStopData,
  PostOpportunitiesByOpportunityIdStopResponse,
  PostOpportunitiesData,
  PostOpportunitiesResponse,
  PostProjectsData,
  PostProjectsResponse,
  PostQuotesByQuoteIdLaunchData,
  PostQuotesByQuoteIdLaunchResponse,
  PostQuotesData,
  PostQuotesResponse,
  PostSubmissionsBySubmissionIdApproveResponse,
  PostSubmissionsBySubmissionIdDeclineData,
  PostSubmissionsBySubmissionIdDeclineResponse,
  PostSubmissionsBySubmissionIdInviteData,
  PostSubmissionsBySubmissionIdInviteResponse,
  PostSubmissionsBySubmissionIdRejectData,
  PostSubmissionsBySubmissionIdRejectResponse,
} from './generated/types.gen'
import {
  TeracApiError,
  TeracRateLimitError,
  TeracResponseError,
  TeracTransportError,
  isTeracError,
  summarizeRequest,
  summarizeResponseHeaders,
} from './errors'
import { createTeracFetch } from './http'

/**
 * The only Terac server. There is no sandbox or staging environment: the
 * OpenAPI document declares this one URL and the docs name no other.
 *
 * @see https://terac.com/docs/developers/guides
 */
export const TERAC_BASE_URL = 'https://terac.com/api/external/v2'

/** An empty JSON body, which Terac requires on every `POST`. */
const EMPTY_BODY: Record<string, never> = {}

/**
 * True for a C0 or C1 control character, or DEL.
 *
 * A header value holding one of these makes `Headers.set` throw, and the error
 * it throws quotes the offending value — which is the whole `Bearer <key>`
 * string. Rejecting the key up front is the only way to keep that out of a
 * `TeracTransportError.cause`. Written as a scan rather than a regular
 * expression because a control-character class is what `no-control-regex`
 * exists to catch.
 */
const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

/**
 * Rejects a key that cannot be put in a header, without ever quoting it.
 *
 * A copy-pasted key with a trailing newline is the common case, and it is the
 * one that turns into a credential leak: the error is thrown deep inside the
 * fetch client, retained as `cause`, and printed by any logger that walks it.
 * The messages here name the FAULT, never the value.
 */
const assertUsableApiKey = (apiKey: string): void => {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('TeracSdk apiKey must be a non-empty string')
  }

  if (apiKey.trim() !== apiKey) {
    throw new Error(
      'TeracSdk apiKey must not have leading or trailing whitespace; trim the value before passing it',
    )
  }

  if (hasControlCharacter(apiKey)) {
    throw new Error(
      'TeracSdk apiKey must not contain control characters; it cannot be sent as a header value',
    )
  }
}

/**
 * Per-call request controls, accepted as the last argument of every operation.
 */
export type TeracRequestOptions = {
  /**
   * Cancels the call. The signal's `reason` is preserved, so
   * `AbortSignal.timeout(n)` and `controller.abort(myReason)` both surface the
   * reason the caller chose.
   */
  signal?: AbortSignal
}

export type TeracSdkOptions = {
  /**
   * Terac API key, in the form `tk_…`. Sent as `Authorization: Bearer <key>`;
   * the SDK adds the `Bearer ` prefix. Keys are scoped per organisation.
   *
   * @see https://terac.com/docs/developers/guides/authentication
   */
  apiKey: string
  /** Base URL for the API. Defaults to {@link TERAC_BASE_URL}. */
  baseUrl?: string
  /**
   * Abort a request that takes longer than this, in milliseconds. The deadline
   * covers reading the response body, not just the response headers.
   */
  timeoutMs?: number
}

/**
 * Bound to a configured generated client. Every operation takes an optional
 * trailing {@link TeracRequestOptions}.
 *
 * The generated client is held in an ECMAScript `#private` field rather than a
 * TypeScript `private` one, so it is not an enumerable property: logging or
 * `JSON.stringify`-ing an SDK instance cannot reach the credential the client
 * holds.
 */
const toOptions = (options: TeracRequestOptions | undefined) =>
  options?.signal ? { signal: options.signal } : {}

/**
 * Projects group opportunities. Create one, then create opportunities under it.
 *
 * @see https://terac.com/docs/developers/reference/listProjects
 */
class ProjectsModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /** Lists the organisation's projects, newest first. */
  async list(
    query?: GetProjectsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetProjectsResponse> {
    const result = await this.#sdk.getProjects<true>({
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /** Creates a project. */
  async create(
    body: PostProjectsData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostProjectsResponse> {
    const result = await this.#sdk.postProjects<true>({
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /** Retrieves one project, including its opportunity count. */
  async retrieve(
    projectId: string,
    options?: TeracRequestOptions,
  ): Promise<GetProjectsByProjectIdResponse> {
    const result = await this.#sdk.getProjectsByProjectId<true>({
      path: { projectId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Updates a project's name. */
  async update(
    projectId: string,
    body: PatchProjectsByProjectIdData['body'],
    options?: TeracRequestOptions,
  ): Promise<PatchProjectsByProjectIdResponse> {
    const result = await this.#sdk.patchProjectsByProjectId<true>({
      body,
      path: { projectId },
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * The filter catalogue. Filters target participants by demographics,
 * geography, profession and participation history.
 *
 * @see https://terac.com/docs/developers/guides/filters
 */
class FiltersModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /** Lists every filter slug, with its type, operators and bounds. */
  async list(options?: TeracRequestOptions): Promise<GetFiltersResponse> {
    const result = await this.#sdk.getFilters<true>({ ...toOptions(options) })
    return result.data
  }

  /**
   * Lists the selectable options for one filter slug. Geography filters narrow
   * with `country_id` / `state_id`.
   */
  async listOptions(
    filterSlug: string,
    query?: GetFiltersByFilterSlugOptionsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetFiltersByFilterSlugOptionsResponse> {
    const result = await this.#sdk.getFiltersByFilterSlugOptions<true>({
      path: { filter_slug: filterSlug },
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * Opportunities are the unit of recruitment: filters, screening questions,
 * quotas and tasks. Create a draft, then launch it.
 *
 * @see https://terac.com/docs/developers/reference/createOpportunity
 */
class OpportunitiesModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /** Lists opportunities, optionally filtered by project or status. */
  async list(
    query?: GetOpportunitiesData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesResponse> {
    const result = await this.#sdk.getOpportunities<true>({
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /** Creates a draft opportunity. It does not recruit until you launch it. */
  async create(
    body: PostOpportunitiesData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesResponse> {
    const result = await this.#sdk.postOpportunities<true>({
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /** Retrieves one opportunity, with quota and screening progress. */
  async retrieve(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesByOpportunityIdResponse> {
    const result = await this.#sdk.getOpportunitiesByOpportunityId<true>({
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Updates a draft opportunity. */
  async update(
    opportunityId: string,
    body: PatchOpportunitiesByOpportunityIdData['body'],
    options?: TeracRequestOptions,
  ): Promise<PatchOpportunitiesByOpportunityIdResponse> {
    const result = await this.#sdk.patchOpportunitiesByOpportunityId<true>({
      body,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Deletes a draft opportunity. */
  async delete(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<DeleteOpportunitiesByOpportunityIdResponse> {
    const result = await this.#sdk.deleteOpportunitiesByOpportunityId<true>({
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Launches a draft opportunity, which starts recruiting and spends funds. */
  async launch(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdLaunchResponse> {
    const result = await this.#sdk.postOpportunitiesByOpportunityIdLaunch<true>(
      {
        body: EMPTY_BODY,
        path: { opportunityId },
        ...toOptions(options),
      },
    )
    return result.data
  }

  /** Pauses a live opportunity. No new participants enter. */
  async pause(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdPauseResponse> {
    const result = await this.#sdk.postOpportunitiesByOpportunityIdPause<true>({
      body: EMPTY_BODY,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Resumes a paused opportunity. */
  async resume(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdResumeResponse> {
    const result = await this.#sdk.postOpportunitiesByOpportunityIdResume<true>(
      {
        body: EMPTY_BODY,
        path: { opportunityId },
        ...toOptions(options),
      },
    )
    return result.data
  }

  /** Stops an opportunity for good. This cannot be undone. */
  async stop(
    opportunityId: string,
    body: PostOpportunitiesByOpportunityIdStopData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdStopResponse> {
    const result = await this.#sdk.postOpportunitiesByOpportunityIdStop<true>({
      body,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * Submissions are one participant's run through one opportunity: screening,
 * the work, and the review that pays them.
 *
 * @see https://terac.com/docs/developers/reference/getSubmission
 */
class SubmissionsModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /** Lists submissions for an opportunity. */
  async list(
    opportunityId: string,
    query?: GetOpportunitiesByOpportunityIdSubmissionsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesByOpportunityIdSubmissionsResponse> {
    const result =
      await this.#sdk.getOpportunitiesByOpportunityIdSubmissions<true>({
        path: { opportunityId },
        ...(query ? { query } : {}),
        ...toOptions(options),
      })
    return result.data
  }

  /**
   * Lists applicants awaiting your invite/decline decision. Only populated
   * when the opportunity uses customer screening review.
   */
  async listApplicants(
    opportunityId: string,
    query?: GetOpportunitiesByOpportunityIdApplicantsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesByOpportunityIdApplicantsResponse> {
    const result =
      await this.#sdk.getOpportunitiesByOpportunityIdApplicants<true>({
        path: { opportunityId },
        ...(query ? { query } : {}),
        ...toOptions(options),
      })
    return result.data
  }

  /** Invites an applicant, moving them to `screen_passed` so they can start. */
  async invite(
    submissionId: string,
    body: PostSubmissionsBySubmissionIdInviteData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdInviteResponse> {
    const result = await this.#sdk.postSubmissionsBySubmissionIdInvite<true>({
      body,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Declines an applicant, marking them `screened_out`. */
  async decline(
    submissionId: string,
    body: PostSubmissionsBySubmissionIdDeclineData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdDeclineResponse> {
    const result = await this.#sdk.postSubmissionsBySubmissionIdDecline<true>({
      body,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Retrieves one submission, with its screening answers and task output. */
  async retrieve(
    submissionId: string,
    options?: TeracRequestOptions,
  ): Promise<GetSubmissionsBySubmissionIdResponse> {
    const result = await this.#sdk.getSubmissionsBySubmissionId<true>({
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Approves a submission awaiting review, which pays the participant. */
  async approve(
    submissionId: string,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdApproveResponse> {
    const result = await this.#sdk.postSubmissionsBySubmissionIdApprove<true>({
      body: EMPTY_BODY,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /** Rejects a submission awaiting review, which withholds payment. */
  async reject(
    submissionId: string,
    body: PostSubmissionsBySubmissionIdRejectData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdRejectResponse> {
    const result = await this.#sdk.postSubmissionsBySubmissionIdReject<true>({
      body,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * Synchronous pricing: describe the task and the panel, get a price, launch
 * from it.
 *
 * **Undocumented.** These three endpoints exist in Terac's OpenAPI document but
 * have no page under `https://terac.com/docs/developers/reference`. They may
 * change without notice. Prefer {@link FeasibilityModule} for the documented
 * path.
 */
class QuotesModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /**
   * Prices a task and panel synchronously.
   *
   * **Undocumented endpoint** (`POST /quotes`).
   */
  async create(
    body: PostQuotesData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostQuotesResponse> {
    const result = await this.#sdk.postQuotes<true>({
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Retrieves a quote, with its reasoning and expiry.
   *
   * **Undocumented endpoint** (`GET /quotes/{quoteId}`).
   */
  async retrieve(
    quoteId: string,
    options?: TeracRequestOptions,
  ): Promise<GetQuotesByQuoteIdResponse> {
    const result = await this.#sdk.getQuotesByQuoteId<true>({
      path: { quoteId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Creates and launches an opportunity from an accepted quote.
   *
   * **Undocumented endpoint** (`POST /quotes/{quoteId}/launch`). The spec tags
   * it `Opportunities`; it lives here because its path and its input are the
   * quote.
   */
  async launch(
    quoteId: string,
    body: PostQuotesByQuoteIdLaunchData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostQuotesByQuoteIdLaunchResponse> {
    const result = await this.#sdk.postQuotesByQuoteIdLaunch<true>({
      body,
      path: { quoteId },
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * Feasibility requests ask Terac's team whether an audience is reachable, and
 * at what price. The answer arrives asynchronously.
 *
 * @see https://terac.com/docs/developers/reference/requestFeasibility
 */
class FeasibilityModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /** Submits a feasibility request. */
  async create(
    body: PostFeasibilityRequestsData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostFeasibilityRequestsResponse> {
    const result = await this.#sdk.postFeasibilityRequests<true>({
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /** Lists feasibility requests. */
  async list(
    query?: GetFeasibilityRequestsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetFeasibilityRequestsResponse> {
    const result = await this.#sdk.getFeasibilityRequests<true>({
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /** Retrieves one feasibility request and its response, once answered. */
  async retrieve(
    requestId: string,
    options?: TeracRequestOptions,
  ): Promise<GetFeasibilityRequestsByRequestIdResponse> {
    const result = await this.#sdk.getFeasibilityRequestsByRequestId<true>({
      path: { requestId },
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * The organisation the API key belongs to.
 *
 * @see https://terac.com/docs/developers/reference/getOrganizationContext
 */
class OrganizationsModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /** Retrieves the current organisation's name, balance and dashboard links. */
  async retrieveContext(
    options?: TeracRequestOptions,
  ): Promise<GetOrganizationsCurrentContextResponse> {
    const result = await this.#sdk.getOrganizationsCurrentContext<true>({
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * Webhook subscription management. Verifying an inbound delivery is a separate
 * concern: import `verifyTeracWebhook` from `@coloop-ai/terac-sdk/webhooks`.
 *
 * @see https://terac.com/docs/developers/guides/webhooks
 */
class WebhooksModule {
  readonly #sdk: GeneratedTeracSdk

  constructor(sdk: GeneratedTeracSdk) {
    this.#sdk = sdk
  }

  /**
   * Lists the event types a subscription can take. Read this instead of
   * hardcoding a list: Terac adds event types without a version bump.
   */
  async listEventTypes(
    options?: TeracRequestOptions,
  ): Promise<GetHooksEventTypesResponse> {
    const result = await this.#sdk.getHooksEventTypes<true>({
      ...toOptions(options),
    })
    return result.data
  }

  /** Lists the organisation's webhook subscriptions. */
  async list(
    options?: TeracRequestOptions,
  ): Promise<GetHooksSubscriptionsResponse> {
    const result = await this.#sdk.getHooksSubscriptions<true>({
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Creates a subscription. It is unconfirmed and receives nothing until
   * {@link confirm} succeeds. The response is the only place a `create`
   * returns the signing secret, but {@link retrieveSecret} reads it back.
   */
  async create(
    body: PostHooksSubscriptionsData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostHooksSubscriptionsResponse> {
    const result = await this.#sdk.postHooksSubscriptions<true>({
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /** Retrieves one subscription. */
  async retrieve(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<GetHooksSubscriptionsBySubscriptionIdResponse> {
    const result = await this.#sdk.getHooksSubscriptionsBySubscriptionId<true>({
      path: { subscriptionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Updates a subscription. `event_types` replaces the list rather than adding
   * to it. Changing `target_url` clears the confirmation, so confirm again.
   */
  async update(
    subscriptionId: string,
    body: PatchHooksSubscriptionsBySubscriptionIdData['body'],
    options?: TeracRequestOptions,
  ): Promise<PatchHooksSubscriptionsBySubscriptionIdResponse> {
    const result =
      await this.#sdk.patchHooksSubscriptionsBySubscriptionId<true>({
        body,
        path: { subscriptionId },
        ...toOptions(options),
      })
    return result.data
  }

  /**
   * Confirms a subscription. Terac POSTs one signed `webhook.ping` to the
   * target URL; a `2xx` activates it, anything else returns `412`. Safe to
   * repeat, and the cheapest end-to-end test of a receiver.
   */
  async confirm(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<PostHooksSubscriptionsBySubscriptionIdResponse> {
    const result = await this.#sdk.postHooksSubscriptionsBySubscriptionId<true>(
      {
        body: EMPTY_BODY,
        path: { subscriptionId },
        ...toOptions(options),
      },
    )
    return result.data
  }

  /** Deletes a subscription. */
  async delete(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<DeleteHooksSubscriptionsBySubscriptionIdResponse> {
    const result =
      await this.#sdk.deleteHooksSubscriptionsBySubscriptionId<true>({
        path: { subscriptionId },
        ...toOptions(options),
      })
    return result.data
  }

  /** Reads a subscription's signing secret back in full. */
  async retrieveSecret(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<GetHooksSubscriptionsBySubscriptionIdSecretResponse> {
    const result =
      await this.#sdk.getHooksSubscriptionsBySubscriptionIdSecret<true>({
        path: { subscriptionId },
        ...toOptions(options),
      })
    return result.data
  }

  /**
   * Rotates the signing secret. There is **no overlap window**: the next
   * attempt of every delivery, including one already queued, is signed with
   * the new secret. Deploy it to the receiver first.
   */
  async rotateSecret(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<PostHooksSubscriptionsBySubscriptionIdSecretResponse> {
    const result =
      await this.#sdk.postHooksSubscriptionsBySubscriptionIdSecret<true>({
        body: EMPTY_BODY,
        path: { subscriptionId },
        ...toOptions(options),
      })
    return result.data
  }

  /**
   * Lists deliveries, newest first. One row per delivery, updated in place
   * across retries, so `id` is the `X-Event-ID` the receiver saw. Confirmation
   * pings are not logged.
   */
  async listDeliveries(
    query?: GetHooksEventsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetHooksEventsResponse> {
    const result = await this.#sdk.getHooksEvents<true>({
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }
}

/**
 * A typed client for the Terac External API v2.
 *
 * ```ts
 * const terac = new TeracSdk({ apiKey: process.env.TERAC_API_KEY! })
 * const projects = await terac.projects.list({ limit: 10 })
 * ```
 *
 * The API key lives in one `#private` field and is read only when a request is
 * signed, so it is not an enumerable property of the SDK or of any module.
 */
export class TeracSdk {
  readonly #apiKey: string

  public readonly projects: ProjectsModule
  public readonly filters: FiltersModule
  public readonly opportunities: OpportunitiesModule
  public readonly submissions: SubmissionsModule
  public readonly quotes: QuotesModule
  public readonly feasibility: FeasibilityModule
  public readonly organizations: OrganizationsModule
  public readonly webhooks: WebhooksModule

  constructor({ apiKey, baseUrl, timeoutMs }: TeracSdkOptions) {
    assertUsableApiKey(apiKey)

    if (
      timeoutMs !== undefined &&
      (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    ) {
      throw new Error('TeracSdk timeoutMs must be a positive number')
    }

    this.#apiKey = apiKey

    const client = createClient({
      baseUrl: baseUrl ?? TERAC_BASE_URL,
      // Terac's spec models the key as a raw `Authorization` header value, so
      // the `Bearer ` prefix is ours to add. Supplying it through `auth`
      // rather than `headers` keeps the key out of the client's enumerable
      // config: the closure is not walkable by a logger.
      auth: () => `Bearer ${this.#apiKey}`,
      // Belt and braces: `createTeracFetch` re-issues every request with
      // `redirect: 'error'` too, but a caller that swaps in its own `fetch`
      // still gets the safe default.
      redirect: 'error',
      fetch: createTeracFetch(timeoutMs === undefined ? {} : { timeoutMs }),
      responseStyle: 'fields',
      throwOnError: true,
    })

    client.interceptors.error.use((error, response, request) => {
      if (isTeracError(error)) {
        return error
      }

      // A caller abort is the caller's own value. `Request` clones the signal
      // it is given but carries the same `reason` object across, so this is an
      // identity check on the reason the caller chose — never a guess.
      if (request?.signal.aborted && Object.is(request.signal.reason, error)) {
        return error
      }

      const summary = request ? summarizeRequest(request) : undefined

      if (!response) {
        // `createTeracFetch` classifies everything that reaches the network, so
        // reaching here means the request could not even be built.
        return new TeracTransportError({
          message: 'Terac request could not be sent',
          ...(summary ? { request: summary } : {}),
          cause: error,
        })
      }

      if (response.ok) {
        // A success status whose body could not be decoded. The generated
        // client throws the original `SyntaxError` here.
        return new TeracResponseError({
          status: response.status,
          ...(summary ? { request: summary } : {}),
          cause: error,
        })
      }

      const apiErrorOptions = {
        status: response.status,
        statusText: response.statusText,
        payload: error,
        responseHeaders: summarizeResponseHeaders(response),
        ...(summary ? { request: summary } : {}),
      }

      return response.status === 429
        ? new TeracRateLimitError(apiErrorOptions)
        : new TeracApiError(apiErrorOptions)
    })

    const generated = new GeneratedTeracSdk({ client })

    this.projects = new ProjectsModule(generated)
    this.filters = new FiltersModule(generated)
    this.opportunities = new OpportunitiesModule(generated)
    this.submissions = new SubmissionsModule(generated)
    this.quotes = new QuotesModule(generated)
    this.feasibility = new FeasibilityModule(generated)
    this.organizations = new OrganizationsModule(generated)
    this.webhooks = new WebhooksModule(generated)
  }
}
