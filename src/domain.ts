/**
 * Domain aliases for Terac's main objects.
 *
 * Terac's OpenAPI document declares only five named component schemas, all of
 * them errors. Every request and response body is inline, so the generated
 * types are named after operations (`GetSubmissionsBySubmissionIdResponse`)
 * rather than after things (`Submission`). These aliases give the objects the
 * names the docs use, without hand-maintaining a second copy of the shapes:
 * change the spec, regenerate, and these follow.
 */
import type {
  GetFeasibilityRequestsByRequestIdResponse,
  GetFeasibilityRequestsResponse,
  GetFiltersByFilterSlugOptionsResponse,
  GetFiltersResponse,
  GetHooksEventsResponse,
  GetHooksEventTypesResponse,
  GetHooksSubscriptionsBySubscriptionIdResponse,
  GetOpportunitiesByOpportunityIdApplicantsResponse,
  GetOpportunitiesByOpportunityIdResponse,
  GetOpportunitiesByOpportunityIdSubmissionsResponse,
  GetOpportunitiesResponse,
  GetOrganizationsCurrentContextResponse,
  GetProjectsByProjectIdResponse,
  GetProjectsResponse,
  GetQuotesByQuoteIdResponse,
  GetSubmissionsBySubmissionIdResponse,
} from './generated/types.gen'

/** A project, as returned by `GET /projects/{projectId}`. */
export type TeracProject = GetProjectsByProjectIdResponse

/** The shorter project shape returned inside `GET /projects`. */
export type TeracProjectSummary = GetProjectsResponse['data'][number]

/** An opportunity, as returned by `GET /opportunities/{opportunityId}`. */
export type TeracOpportunity = GetOpportunitiesByOpportunityIdResponse

/** The shorter opportunity shape returned inside `GET /opportunities`. */
export type TeracOpportunitySummary = GetOpportunitiesResponse['data'][number]

/** A submission, as returned by `GET /submissions/{submissionId}`. */
export type TeracSubmission = GetSubmissionsBySubmissionIdResponse

/** The shorter submission shape returned inside the submissions list. */
export type TeracSubmissionSummary =
  GetOpportunitiesByOpportunityIdSubmissionsResponse['data'][number]

/**
 * An applicant awaiting an invite/decline decision.
 *
 * Terac exposes no participant resource: a person is reachable only as the
 * `participant_id` on a submission or an applicant, so this is the closest
 * thing to a participant object the API returns.
 */
export type TeracApplicant =
  GetOpportunitiesByOpportunityIdApplicantsResponse['data'][number]

/** A participant's identifier, as it appears on submissions and applicants. */
export type TeracParticipantId = TeracSubmission['participant_id']

/** A quote, as returned by the undocumented `GET /quotes/{quoteId}`. */
export type TeracQuote = GetQuotesByQuoteIdResponse

/** A feasibility request, as returned by `GET /feasibility/requests/{id}`. */
export type TeracFeasibilityRequest = GetFeasibilityRequestsByRequestIdResponse

/**
 * The shorter feasibility shape returned inside the list.
 *
 * Note the key: the list endpoint returns `{ count, requests }`, not the
 * `{ data, pagination }` every other list endpoint uses.
 */
export type TeracFeasibilityRequestSummary =
  GetFeasibilityRequestsResponse['requests'][number]

/** A webhook subscription ("hook"), as returned by the `/hooks` endpoints. */
export type TeracWebhookSubscription =
  GetHooksSubscriptionsBySubscriptionIdResponse

/** One row of the webhook delivery log (`GET /hooks/events`). */
export type TeracWebhookDelivery = GetHooksEventsResponse['data'][number]

/** One entry of `GET /hooks/event-types`. */
export type TeracWebhookEventTypeInfo =
  GetHooksEventTypesResponse['data'][number]

/** One targeting filter from the filter catalogue. */
export type TeracFilter = GetFiltersResponse['data'][number]

/** One selectable option of a filter. */
export type TeracFilterOption =
  GetFiltersByFilterSlugOptionsResponse['data'][number]

/** The organisation an API key belongs to. */
export type TeracOrganizationContext = GetOrganizationsCurrentContextResponse
