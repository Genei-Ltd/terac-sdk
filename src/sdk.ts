import { type Client, createClient } from './generated/client'
import {
  deleteHooksSubscriptionsBySubscriptionId,
  deleteOpportunitiesByOpportunityId,
  getFeasibilityRequests,
  getFeasibilityRequestsByRequestId,
  getFilters,
  getFiltersByFilterSlugOptions,
  getHooksEventTypes,
  getHooksEvents,
  getHooksSubscriptions,
  getHooksSubscriptionsBySubscriptionId,
  getHooksSubscriptionsBySubscriptionIdSecret,
  getOpportunities,
  getOpportunitiesByOpportunityId,
  getOpportunitiesByOpportunityIdApplicants,
  getOpportunitiesByOpportunityIdSubmissions,
  getOrganizationsCurrentContext,
  getProjects,
  getProjectsByProjectId,
  getQuotesByQuoteId,
  getSubmissionsBySubmissionId,
  patchHooksSubscriptionsBySubscriptionId,
  patchOpportunitiesByOpportunityId,
  patchProjectsByProjectId,
  postFeasibilityRequests,
  postHooksSubscriptions,
  postHooksSubscriptionsBySubscriptionId,
  postHooksSubscriptionsBySubscriptionIdSecret,
  postOpportunities,
  postOpportunitiesByOpportunityIdLaunch,
  postOpportunitiesByOpportunityIdPause,
  postOpportunitiesByOpportunityIdResume,
  postOpportunitiesByOpportunityIdStop,
  postProjects,
  postQuotes,
  postQuotesByQuoteIdLaunch,
  postSubmissionsBySubmissionIdApprove,
  postSubmissionsBySubmissionIdDecline,
  postSubmissionsBySubmissionIdInvite,
  postSubmissionsBySubmissionIdReject,
} from './generated/sdk.gen'
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
  redactApiKey,
  redactPayload,
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
 * The largest delay `setTimeout` honours. A delay above this wraps to 1ms in
 * Node and in browsers, so a caller asking for a very long deadline would get
 * a request aborted almost at once. Rejected at construction instead.
 */
const MAX_TIMEOUT_MS = 2_147_483_647

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
 * Bound to a configured client. Every operation takes an optional trailing
 * {@link TeracRequestOptions}.
 *
 * Each module holds that client in an ECMAScript `#private` field rather than a
 * TypeScript `private` one, so it is not an enumerable property: logging or
 * `JSON.stringify`-ing an SDK instance cannot reach the credential the client
 * holds. The generated operations are plain functions taking the client as an
 * argument, so nothing else keeps a reference to it either.
 */
const toOptions = (options: TeracRequestOptions | undefined) =>
  options?.signal ? { signal: options.signal } : {}

/**
 * Projects group opportunities. Create one, then create opportunities under it.
 *
 * @see https://terac.com/docs/developers/reference/listProjects
 */
class ProjectsModule {
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * List projects
   *
   * Newest first.
   */
  async list(
    query?: GetProjectsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetProjectsResponse> {
    const result = await getProjects<true>({
      client: this.#client,
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Create a project
   */
  async create(
    body: PostProjectsData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostProjectsResponse> {
    const result = await postProjects<true>({
      client: this.#client,
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Get project details
   *
   * Includes the project's opportunity count.
   */
  async retrieve(
    projectId: string,
    options?: TeracRequestOptions,
  ): Promise<GetProjectsByProjectIdResponse> {
    const result = await getProjectsByProjectId<true>({
      client: this.#client,
      path: { projectId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Update a project
   *
   * The name is the only field that can change.
   */
  async update(
    projectId: string,
    body: PatchProjectsByProjectIdData['body'],
    options?: TeracRequestOptions,
  ): Promise<PatchProjectsByProjectIdResponse> {
    const result = await patchProjectsByProjectId<true>({
      client: this.#client,
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
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * List available filters
   *
   * Every filter slug, with its type, operators and bounds.
   */
  async list(options?: TeracRequestOptions): Promise<GetFiltersResponse> {
    const result = await getFilters<true>({
      client: this.#client,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * List options for a filter
   *
   * Geography filters narrow with `country_id` / `state_id`.
   */
  async listOptions(
    filterSlug: string,
    query?: GetFiltersByFilterSlugOptionsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetFiltersByFilterSlugOptionsResponse> {
    const result = await getFiltersByFilterSlugOptions<true>({
      client: this.#client,
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
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * List opportunities
   *
   * Optionally filtered by project or status.
   */
  async list(
    query?: GetOpportunitiesData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesResponse> {
    const result = await getOpportunities<true>({
      client: this.#client,
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Create a draft opportunity
   *
   * Creates the opportunity as a DRAFT. Nothing is charged and no recruitment starts until you call
   * `POST /opportunities/{opportunityId}/launch`.
   *
   * **The incentive is derived, not sent.** There is no field for participant pay, and the amount is
   * fixed when the draft is created. Two paths decide which number you get:
   *
   * - **Omit `feasibility_request_id`** and the incentive is an automatic estimate made during this
   * call. It is priced from the whole brief, not just its size: the participant count, the task
   * duration, the audience your `filters` and `screening_questions` describe, and the recruitment
   * window from `expected_days_to_complete`. Changing any of those changes the price, so read the
   * result back from `pricing` on the response; do not quote a price to anyone before you have.
   * - **Pass a `feasibility_request_id`** and that request's confirmed CPI is honored exactly, with no
   * re-estimate. Submit the brief to `POST /feasibility/requests` first and poll
   * `GET /feasibility/requests/{requestId}` until it reads `RESPONDED`, which is when a price exists.
   * This is the way to control what participants are paid.
   *
   * The platform fee follows the same split. Priced by feasibility, the confirmed recruitment fee
   * becomes this opportunity's fee, as a flat per-participant amount, so the all-in CPI you agreed is
   * the one you are charged. Priced automatically, it comes from the organization's configuration
   * instead. Either way it is not a per-opportunity input, and neither is the currency (always USD) or
   * the pay cadence (always `one_time`). `pricing` on the response carries the all-in cost per
   * participant and the total, and `funding` says whether the balance covers a launch.
   *
   * Editing after this call is draft-only: `PATCH /opportunities/{opportunityId}` returns 409 once the
   * opportunity is launched, and a new recruitment window moves the deadline without re-pricing.
   */
  async create(
    body: PostOpportunitiesData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesResponse> {
    const result = await postOpportunities<true>({
      client: this.#client,
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Get opportunity details
   *
   * Includes quota and screening progress.
   */
  async retrieve(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesByOpportunityIdResponse> {
    const result = await getOpportunitiesByOpportunityId<true>({
      client: this.#client,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Update opportunity
   *
   * Draft only: Terac returns `409` once the opportunity is launched.
   */
  async update(
    opportunityId: string,
    body: PatchOpportunitiesByOpportunityIdData['body'],
    options?: TeracRequestOptions,
  ): Promise<PatchOpportunitiesByOpportunityIdResponse> {
    const result = await patchOpportunitiesByOpportunityId<true>({
      client: this.#client,
      body,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Delete a draft opportunity
   */
  async delete(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<DeleteOpportunitiesByOpportunityIdResponse> {
    const result = await deleteOpportunitiesByOpportunityId<true>({
      client: this.#client,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Launch opportunity
   *
   * Starts recruiting, and spends funds.
   */
  async launch(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdLaunchResponse> {
    const result = await postOpportunitiesByOpportunityIdLaunch<true>({
      client: this.#client,
      body: EMPTY_BODY,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Pause opportunity
   *
   * No new participants enter while it is paused.
   */
  async pause(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdPauseResponse> {
    const result = await postOpportunitiesByOpportunityIdPause<true>({
      client: this.#client,
      body: EMPTY_BODY,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Resume opportunity
   */
  async resume(
    opportunityId: string,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdResumeResponse> {
    const result = await postOpportunitiesByOpportunityIdResume<true>({
      client: this.#client,
      body: EMPTY_BODY,
      path: { opportunityId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Stop opportunity
   *
   * This cannot be undone.
   */
  async stop(
    opportunityId: string,
    body: PostOpportunitiesByOpportunityIdStopData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostOpportunitiesByOpportunityIdStopResponse> {
    const result = await postOpportunitiesByOpportunityIdStop<true>({
      client: this.#client,
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
 * Three of these are **undocumented**: {@link SubmissionsModule.listApplicants},
 * {@link SubmissionsModule.invite} and {@link SubmissionsModule.decline} are in
 * Terac's OpenAPI document but have no page under
 * `https://terac.com/docs/developers/reference`, so they may change without
 * notice. They are the only way to work an applicant-review queue, so they are
 * wrapped rather than withheld.
 *
 * @see https://terac.com/docs/developers/reference/getSubmission
 */
class SubmissionsModule {
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * List submissions for an opportunity
   */
  async list(
    opportunityId: string,
    query?: GetOpportunitiesByOpportunityIdSubmissionsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesByOpportunityIdSubmissionsResponse> {
    const result = await getOpportunitiesByOpportunityIdSubmissions<true>({
      client: this.#client,
      path: { opportunityId },
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * List applicants awaiting your invite decision
   *
   * Applicants who passed screening and are waiting on your decision to invite them.
   *
   * They are deliberately absent from `GET /opportunities/{opportunityId}/submissions`: an applicant
   * here has not been invited yet, so they hold no submission status, and `GET /submissions/{id}`
   * returns 404 for them. This collection is where they exist until you decide.
   *
   * Act on one with `POST /submissions/{submissionId}/invite` or `/decline`. Inviting makes them
   * `screen_passed` and starts their tasks; declining makes them `screened_out`. Either way they
   * leave this collection and appear in the submissions listing from then on.
   *
   * An opportunity on `manual_review` routes every qualified applicant here. One on `auto_invite`
   * still routes an individual applicant here when a screening answer you marked `review` flags
   * them, so poll this even when you did not opt into reviewing everyone.
   *
   * **Undocumented endpoint** (`GET /opportunities/{opportunityId}/applicants`).
   * It is in Terac's OpenAPI document but has no page under
   * `https://terac.com/docs/developers/reference`, so it may change without
   * notice.
   */
  async listApplicants(
    opportunityId: string,
    query?: GetOpportunitiesByOpportunityIdApplicantsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetOpportunitiesByOpportunityIdApplicantsResponse> {
    const result = await getOpportunitiesByOpportunityIdApplicants<true>({
      client: this.#client,
      path: { opportunityId },
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Invite an applicant awaiting your decision
   *
   * Invites an applicant sitting in your applicant-review queue, which materializes their tasks and notifies them. The submission becomes `screen_passed`. Returns 409 if the applicant is not awaiting your decision, which includes one you have already decided on.
   *
   * **Undocumented endpoint** (`POST /submissions/{submissionId}/invite`).
   * It is in Terac's OpenAPI document but has no page under
   * `https://terac.com/docs/developers/reference`, so it may change without
   * notice.
   */
  async invite(
    submissionId: string,
    body: PostSubmissionsBySubmissionIdInviteData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdInviteResponse> {
    const result = await postSubmissionsBySubmissionIdInvite<true>({
      client: this.#client,
      body,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Decline an applicant awaiting your decision
   *
   * Declines an applicant sitting in your applicant-review queue. The submission becomes `screened_out` and they are not invited. Returns 409 if the applicant is not awaiting your decision, which includes one you have already decided on.
   *
   * **Undocumented endpoint** (`POST /submissions/{submissionId}/decline`).
   * It is in Terac's OpenAPI document but has no page under
   * `https://terac.com/docs/developers/reference`, so it may change without
   * notice.
   */
  async decline(
    submissionId: string,
    body: PostSubmissionsBySubmissionIdDeclineData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdDeclineResponse> {
    const result = await postSubmissionsBySubmissionIdDecline<true>({
      client: this.#client,
      body,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Get submission details
   *
   * Includes the screening answers and the task output.
   */
  async retrieve(
    submissionId: string,
    options?: TeracRequestOptions,
  ): Promise<GetSubmissionsBySubmissionIdResponse> {
    const result = await getSubmissionsBySubmissionId<true>({
      client: this.#client,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Approve a submission
   *
   * Approving is what pays the participant.
   */
  async approve(
    submissionId: string,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdApproveResponse> {
    const result = await postSubmissionsBySubmissionIdApprove<true>({
      client: this.#client,
      body: EMPTY_BODY,
      path: { submissionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Reject a submission
   *
   * Rejecting withholds payment.
   */
  async reject(
    submissionId: string,
    body: PostSubmissionsBySubmissionIdRejectData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostSubmissionsBySubmissionIdRejectResponse> {
    const result = await postSubmissionsBySubmissionIdReject<true>({
      client: this.#client,
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
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * Get a price estimate for a research task
   *
   * Returns a price estimate for recruiting participants for a research task.
   * Provide the task description, target panel, timeline in hours, and number of participants needed.
   *
   * **Self-serve limits** (industry standard for panel/research platforms):
   * - `timelineHours`: 72–720 (min 3 days, max 1 month).
   * - `submissionCount`: 1–999 participants.
   * Requests outside these ranges return a validation error.
   *
   * **Larger studies:** For more than 999 participants or timelines beyond 1 month, contact sales or use enterprise options.
   *
   * **Undocumented endpoint** (`POST /quotes`).
   * It is in Terac's OpenAPI document but has no page under
   * `https://terac.com/docs/developers/reference`, so it may change without
   * notice.
   */
  async create(
    body: PostQuotesData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostQuotesResponse> {
    const result = await postQuotes<true>({
      client: this.#client,
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Get quote details
   *
   * Returns the details of a specific feasibility quote, including pricing, timeline, and analysis.
   *
   * **Undocumented endpoint** (`GET /quotes/{quoteId}`).
   * It is in Terac's OpenAPI document but has no page under
   * `https://terac.com/docs/developers/reference`, so it may change without
   * notice.
   */
  async retrieve(
    quoteId: string,
    options?: TeracRequestOptions,
  ): Promise<GetQuotesByQuoteIdResponse> {
    const result = await getQuotesByQuoteId<true>({
      client: this.#client,
      path: { quoteId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Launch an opportunity from a quote
   *
   * Creates and launches a research opportunity from a previously created quote. AI generation, billing, and activation happen asynchronously after this returns. Optionally provide projectId to place the opportunity in a specific project.
   *
   * **Undocumented endpoint** (`POST /quotes/{quoteId}/launch`).
   * It is in Terac's OpenAPI document but has no page under
   * `https://terac.com/docs/developers/reference`, so it may change without
   * notice.
   *
   * The spec tags it `Opportunities`; it lives on `quotes` here because its
   * path and its input are the quote.
   */
  async launch(
    quoteId: string,
    body: PostQuotesByQuoteIdLaunchData['body'] = EMPTY_BODY,
    options?: TeracRequestOptions,
  ): Promise<PostQuotesByQuoteIdLaunchResponse> {
    const result = await postQuotesByQuoteIdLaunch<true>({
      client: this.#client,
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
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * Submit a feasibility request
   *
   * Submit a feasibility request: can Terac source a panel for this task, and at what CPI (cost per participant).
   *
   * This is an async request-reply. The response comes back immediately with status RECEIVED and no CPI
   * (costPerParticipant is null). Terac prices it out of band, either automatically within seconds or by
   * routing it to a person, so poll GET /feasibility/requests/{requestId} rather than assuming a turnaround.
   *
   * Only what you send here is priced: taskDescription, panelDescription, and the count and timeline. The
   * filters, screening questions and tasks on the opportunity you build later are not part of the brief that
   * was priced, so a confirmed CPI applies to the scope described here and not to a materially different one.
   *
   * Once RESPONDED, create the opportunity with POST /opportunities and pass feasibility_request_id to price
   * it from that confirmed CPI (Terac skips the autonomous estimate), then launch it. The request stays
   * RESPONDED until that study launches, and is closed as won at launch rather than at create.
   */
  async create(
    body: PostFeasibilityRequestsData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostFeasibilityRequestsResponse> {
    const result = await postFeasibilityRequests<true>({
      client: this.#client,
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * List feasibility requests
   *
   * List your organization's feasibility requests, newest first. Optionally filter by status
   * (RECEIVED / RESPONDED / WON / LOST / NOT_PURSUED) and page through results with limit and offset. Each
   * request includes its costPerParticipant (the CPI), which is null until the request has been priced
   * (status RESPONDED).
   */
  async list(
    query?: GetFeasibilityRequestsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetFeasibilityRequestsResponse> {
    const result = await getFeasibilityRequests<true>({
      client: this.#client,
      ...(query ? { query } : {}),
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Get a feasibility request
   *
   * Retrieve one of your feasibility requests by id. Use this to poll for the CPI after submitting.
   *
   * Status decides whether there is a price to read:
   * - RECEIVED: not priced yet, costPerParticipant is null.
   * - RESPONDED: priced. costPerParticipant is the confirmed all-in CPI per participant.
   * - WON: already used by a study that launched.
   * - LOST or NOT_PURSUED: closed without a usable price. Both are terminal, so stop polling. No reason is
   * returned on this endpoint.
   *
   * Once RESPONDED, create the opportunity with POST /opportunities passing feasibility_request_id to price
   * it from that confirmed CPI, then launch it.
   */
  async retrieve(
    requestId: string,
    options?: TeracRequestOptions,
  ): Promise<GetFeasibilityRequestsByRequestIdResponse> {
    const result = await getFeasibilityRequestsByRequestId<true>({
      client: this.#client,
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
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * Get organization context
   *
   * Returns a markdown summary of the authenticated organization including identity, balance, projects, opportunity counts, and any organization-specific MCP instructions.
   *
   * The organisation's name, balance and dashboard links.
   */
  async retrieveContext(
    options?: TeracRequestOptions,
  ): Promise<GetOrganizationsCurrentContextResponse> {
    const result = await getOrganizationsCurrentContext<true>({
      client: this.#client,
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
  readonly #client: Client

  constructor(client: Client) {
    this.#client = client
  }

  /**
   * List subscribable webhook event types
   *
   * Read this rather than hardcoding a list: new event types are added without a breaking change, and appear here first.
   */
  async listEventTypes(
    options?: TeracRequestOptions,
  ): Promise<GetHooksEventTypesResponse> {
    const result = await getHooksEventTypes<true>({
      client: this.#client,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * List webhook subscriptions
   */
  async list(
    options?: TeracRequestOptions,
  ): Promise<GetHooksSubscriptionsResponse> {
    const result = await getHooksSubscriptions<true>({
      client: this.#client,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Create a webhook subscription
   *
   * Returns the signing secret alongside the subscription. Created unconfirmed, so it receives nothing until you call the confirm endpoint and Terac's ping to target_url returns 2xx.
   *
   * {@link WebhooksModule.retrieveSecret} reads the secret back later.
   */
  async create(
    body: PostHooksSubscriptionsData['body'],
    options?: TeracRequestOptions,
  ): Promise<PostHooksSubscriptionsResponse> {
    const result = await postHooksSubscriptions<true>({
      client: this.#client,
      body,
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Get a webhook subscription
   */
  async retrieve(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<GetHooksSubscriptionsBySubscriptionIdResponse> {
    const result = await getHooksSubscriptionsBySubscriptionId<true>({
      client: this.#client,
      path: { subscriptionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Update a webhook subscription
   *
   * event_types replaces the current list rather than adding to it. Changing target_url clears the confirmation, since the new host has not accepted a ping yet. Set is_enabled true to recover a subscription Terac disabled after sustained failure.
   */
  async update(
    subscriptionId: string,
    body: PatchHooksSubscriptionsBySubscriptionIdData['body'],
    options?: TeracRequestOptions,
  ): Promise<PatchHooksSubscriptionsBySubscriptionIdResponse> {
    const result = await patchHooksSubscriptionsBySubscriptionId<true>({
      client: this.#client,
      body,
      path: { subscriptionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Confirm a webhook subscription
   *
   * Terac POSTs one signed webhook.ping to target_url. Answer 2xx and the subscription starts receiving events. This is also the way to test a receiver end to end, since it exercises the real signature headers.
   *
   * Anything but a `2xx` from your receiver returns `412`, and nothing is
   * confirmed. Safe to repeat.
   */
  async confirm(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<PostHooksSubscriptionsBySubscriptionIdResponse> {
    const result = await postHooksSubscriptionsBySubscriptionId<true>({
      client: this.#client,
      body: EMPTY_BODY,
      path: { subscriptionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Delete a webhook subscription
   */
  async delete(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<DeleteHooksSubscriptionsBySubscriptionIdResponse> {
    const result = await deleteHooksSubscriptionsBySubscriptionId<true>({
      client: this.#client,
      path: { subscriptionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Read a subscription's signing secret
   *
   * For recovering a secret you no longer have. Rotate instead if you believe it leaked, since reading it does not invalidate anything.
   */
  async retrieveSecret(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<GetHooksSubscriptionsBySubscriptionIdSecretResponse> {
    const result = await getHooksSubscriptionsBySubscriptionIdSecret<true>({
      client: this.#client,
      path: { subscriptionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * Rotate a subscription's signing secret
   *
   * Takes effect immediately and with no overlap window: the next attempt of every delivery, including one already queued, is signed with the new secret. Deploy it to your receiver first.
   *
   * Deploy the new secret to your receiver first.
   */
  async rotateSecret(
    subscriptionId: string,
    options?: TeracRequestOptions,
  ): Promise<PostHooksSubscriptionsBySubscriptionIdSecretResponse> {
    const result = await postHooksSubscriptionsBySubscriptionIdSecret<true>({
      client: this.#client,
      body: EMPTY_BODY,
      path: { subscriptionId },
      ...toOptions(options),
    })
    return result.data
  }

  /**
   * List webhook deliveries
   *
   * One row per delivery, updated in place across retries, so id is the X-Event-ID your endpoint saw and attempt_count is how many tries it took. Confirmation pings are not logged here.
   *
   * Newest first.
   */
  async listDeliveries(
    query?: GetHooksEventsData['query'],
    options?: TeracRequestOptions,
  ): Promise<GetHooksEventsResponse> {
    const result = await getHooksEvents<true>({
      client: this.#client,
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

    if (timeoutMs !== undefined && timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(
        `TeracSdk timeoutMs must be at most ${String(MAX_TIMEOUT_MS)}ms (about 24.8 days); setTimeout clamps a longer delay to 1ms, which would abort every request immediately`,
      )
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
      // Every response this API declares is JSON. Left on `auto`, the client
      // picks a decoder from the `Content-Type`: JSON labelled `text/plain`
      // would come back as a string and a response with no content type as a
      // `ReadableStream`, both of them lies about the declared return type.
      // Pinning it to `json` means a body that is not JSON raises a
      // `TeracResponseError` instead.
      parseAs: 'json',
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
      //
      // THROWN, not returned: the generated client coalesces a returned error
      // with `finalError || {}`, which would turn `abort('')`, `abort(0)` and
      // `abort(false)` into an empty object. Throwing from the interceptor
      // leaves the caller's reason exactly as it was.
      if (request?.signal.aborted && Object.is(request.signal.reason, error)) {
        throw error
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

      // Everything below this line is written by the server, so all of it is
      // scrubbed of the key. `message`, `code` and `details` are read back out
      // of the payload by `TeracApiError`, so scrubbing the payload covers
      // them too.
      const apiErrorOptions = {
        status: response.status,
        statusText: redactApiKey(response.statusText, apiKey),
        payload: redactPayload(error, apiKey),
        responseHeaders: summarizeResponseHeaders(response, apiKey),
        ...(summary ? { request: summary } : {}),
      }

      return response.status === 429
        ? new TeracRateLimitError(apiErrorOptions)
        : new TeracApiError(apiErrorOptions)
    })

    this.projects = new ProjectsModule(client)
    this.filters = new FiltersModule(client)
    this.opportunities = new OpportunitiesModule(client)
    this.submissions = new SubmissionsModule(client)
    this.quotes = new QuotesModule(client)
    this.feasibility = new FeasibilityModule(client)
    this.organizations = new OrganizationsModule(client)
    this.webhooks = new WebhooksModule(client)
  }
}
