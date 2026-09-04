/**
 * Every facade operation, exercised against a recording server: the HTTP
 * method, the path (including path-parameter substitution), the query string
 * and the request body.
 *
 * Both tables below are written out by hand rather than derived, so a wrong
 * path or a swapped parameter is caught by reading the file, not only by
 * running it. {@link GENERATED_ROUTES} names every operation the generator
 * produces and where it goes; `cases` names how the facade reaches it. The
 * coverage tests compare the two by NAME, not by counting: two operations
 * added and one dropped is not a pass.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { GeneratedTeracSdk } from '../src/generated/sdk.gen'
import { TeracSdk } from '../src/index'
import type { TeracRequestOptions } from '../src/index'
import { json, startServer } from './helpers/server'

const API_KEY = 'tk_operations'

/**
 * Every operation `@hey-api/openapi-ts` generates, and the route it issues.
 *
 * When the provider adds an endpoint, generation adds a method, the first test
 * below names it as missing, and the suite stays red until it is wrapped and
 * listed here.
 */
const GENERATED_ROUTES = {
  getProjects: 'GET /projects',
  postProjects: 'POST /projects',
  getProjectsByProjectId: 'GET /projects/{projectId}',
  patchProjectsByProjectId: 'PATCH /projects/{projectId}',
  getFilters: 'GET /filters',
  getFiltersByFilterSlugOptions: 'GET /filters/{filter_slug}/options',
  getOpportunities: 'GET /opportunities',
  postOpportunities: 'POST /opportunities',
  getOpportunitiesByOpportunityId: 'GET /opportunities/{opportunityId}',
  patchOpportunitiesByOpportunityId: 'PATCH /opportunities/{opportunityId}',
  deleteOpportunitiesByOpportunityId: 'DELETE /opportunities/{opportunityId}',
  postOpportunitiesByOpportunityIdLaunch:
    'POST /opportunities/{opportunityId}/launch',
  postOpportunitiesByOpportunityIdPause:
    'POST /opportunities/{opportunityId}/pause',
  postOpportunitiesByOpportunityIdResume:
    'POST /opportunities/{opportunityId}/resume',
  postOpportunitiesByOpportunityIdStop:
    'POST /opportunities/{opportunityId}/stop',
  getOpportunitiesByOpportunityIdSubmissions:
    'GET /opportunities/{opportunityId}/submissions',
  getOpportunitiesByOpportunityIdApplicants:
    'GET /opportunities/{opportunityId}/applicants',
  postSubmissionsBySubmissionIdInvite:
    'POST /submissions/{submissionId}/invite',
  postSubmissionsBySubmissionIdDecline:
    'POST /submissions/{submissionId}/decline',
  getSubmissionsBySubmissionId: 'GET /submissions/{submissionId}',
  postSubmissionsBySubmissionIdApprove:
    'POST /submissions/{submissionId}/approve',
  postSubmissionsBySubmissionIdReject:
    'POST /submissions/{submissionId}/reject',
  postQuotes: 'POST /quotes',
  getQuotesByQuoteId: 'GET /quotes/{quoteId}',
  postQuotesByQuoteIdLaunch: 'POST /quotes/{quoteId}/launch',
  postFeasibilityRequests: 'POST /feasibility/requests',
  getFeasibilityRequests: 'GET /feasibility/requests',
  getFeasibilityRequestsByRequestId: 'GET /feasibility/requests/{requestId}',
  getOrganizationsCurrentContext: 'GET /organizations/current/context',
  getHooksEventTypes: 'GET /hooks/event-types',
  getHooksSubscriptions: 'GET /hooks/subscriptions',
  postHooksSubscriptions: 'POST /hooks/subscriptions',
  getHooksSubscriptionsBySubscriptionId:
    'GET /hooks/subscriptions/{subscriptionId}',
  patchHooksSubscriptionsBySubscriptionId:
    'PATCH /hooks/subscriptions/{subscriptionId}',
  postHooksSubscriptionsBySubscriptionId:
    'POST /hooks/subscriptions/{subscriptionId}',
  deleteHooksSubscriptionsBySubscriptionId:
    'DELETE /hooks/subscriptions/{subscriptionId}',
  getHooksSubscriptionsBySubscriptionIdSecret:
    'GET /hooks/subscriptions/{subscriptionId}/secret',
  postHooksSubscriptionsBySubscriptionIdSecret:
    'POST /hooks/subscriptions/{subscriptionId}/secret',
  getHooksEvents: 'GET /hooks/events',
} as const

type OperationCase = {
  name: string
  /** The generated method this facade method wraps. */
  operation: keyof typeof GENERATED_ROUTES
  method: string
  path: string
  /** Expected decoded request body, or `undefined` for a body-less request. */
  body?: unknown
  /** Expected query string entries. */
  query?: Record<string, string>
  call: (sdk: TeracSdk, options: TeracRequestOptions) => Promise<unknown>
}

const cases: OperationCase[] = [
  // Projects
  {
    name: 'projects.list',
    operation: 'getProjects',
    method: 'GET',
    path: '/projects',
    query: { limit: '10', cursor: 'abc' },
    call: (sdk, options) =>
      sdk.projects.list({ limit: 10, cursor: 'abc' }, options),
  },
  {
    name: 'projects.create',
    operation: 'postProjects',
    method: 'POST',
    path: '/projects',
    body: { name: 'Q3 discovery' },
    call: (sdk, options) =>
      sdk.projects.create({ name: 'Q3 discovery' }, options),
  },
  {
    name: 'projects.retrieve',
    operation: 'getProjectsByProjectId',
    method: 'GET',
    path: '/projects/prj_1',
    call: (sdk, options) => sdk.projects.retrieve('prj_1', options),
  },
  {
    name: 'projects.update',
    operation: 'patchProjectsByProjectId',
    method: 'PATCH',
    path: '/projects/prj_1',
    body: { name: 'Renamed' },
    call: (sdk, options) =>
      sdk.projects.update('prj_1', { name: 'Renamed' }, options),
  },

  // Filters
  {
    name: 'filters.list',
    operation: 'getFilters',
    method: 'GET',
    path: '/filters',
    call: (sdk, options) => sdk.filters.list(options),
  },
  {
    name: 'filters.listOptions',
    operation: 'getFiltersByFilterSlugOptions',
    method: 'GET',
    path: '/filters/city/options',
    query: { country_id: '1', search: 'lon' },
    call: (sdk, options) =>
      sdk.filters.listOptions(
        'city',
        { country_id: '1', search: 'lon' },
        options,
      ),
  },

  // Opportunities
  {
    name: 'opportunities.list',
    operation: 'getOpportunities',
    method: 'GET',
    path: '/opportunities',
    query: { projectId: 'prj_1' },
    call: (sdk, options) =>
      sdk.opportunities.list({ projectId: 'prj_1' }, options),
  },
  {
    name: 'opportunities.create',
    operation: 'postOpportunities',
    method: 'POST',
    path: '/opportunities',
    body: {
      title: 'Study',
      project_id: 'prj_1',
      num_participants: 5,
      business_type: 'b2b',
      tasks: [
        { sequence: 1, task_type: 'activity', review_type: 'self_report' },
      ],
    },
    call: (sdk, options) =>
      sdk.opportunities.create(
        {
          title: 'Study',
          project_id: 'prj_1',
          num_participants: 5,
          business_type: 'b2b',
          tasks: [
            { sequence: 1, task_type: 'activity', review_type: 'self_report' },
          ],
        },
        options,
      ),
  },
  {
    name: 'opportunities.retrieve',
    operation: 'getOpportunitiesByOpportunityId',
    method: 'GET',
    path: '/opportunities/opp_1',
    call: (sdk, options) => sdk.opportunities.retrieve('opp_1', options),
  },
  {
    name: 'opportunities.update',
    operation: 'patchOpportunitiesByOpportunityId',
    method: 'PATCH',
    path: '/opportunities/opp_1',
    body: { title: 'New title' },
    call: (sdk, options) =>
      sdk.opportunities.update('opp_1', { title: 'New title' }, options),
  },
  {
    name: 'opportunities.delete',
    operation: 'deleteOpportunitiesByOpportunityId',
    method: 'DELETE',
    path: '/opportunities/opp_1',
    call: (sdk, options) => sdk.opportunities.delete('opp_1', options),
  },
  {
    name: 'opportunities.launch',
    operation: 'postOpportunitiesByOpportunityIdLaunch',
    method: 'POST',
    path: '/opportunities/opp_1/launch',
    body: {},
    call: (sdk, options) => sdk.opportunities.launch('opp_1', options),
  },
  {
    name: 'opportunities.pause',
    operation: 'postOpportunitiesByOpportunityIdPause',
    method: 'POST',
    path: '/opportunities/opp_1/pause',
    body: {},
    call: (sdk, options) => sdk.opportunities.pause('opp_1', options),
  },
  {
    name: 'opportunities.resume',
    operation: 'postOpportunitiesByOpportunityIdResume',
    method: 'POST',
    path: '/opportunities/opp_1/resume',
    body: {},
    call: (sdk, options) => sdk.opportunities.resume('opp_1', options),
  },
  {
    name: 'opportunities.stop',
    operation: 'postOpportunitiesByOpportunityIdStop',
    method: 'POST',
    path: '/opportunities/opp_1/stop',
    body: { reason: 'enough data' },
    call: (sdk, options) =>
      sdk.opportunities.stop('opp_1', { reason: 'enough data' }, options),
  },
  {
    name: 'opportunities.stop (default body)',
    operation: 'postOpportunitiesByOpportunityIdStop',
    method: 'POST',
    path: '/opportunities/opp_1/stop',
    body: {},
    call: (sdk, options) => sdk.opportunities.stop('opp_1', undefined, options),
  },

  // Submissions
  {
    name: 'submissions.list',
    operation: 'getOpportunitiesByOpportunityIdSubmissions',
    method: 'GET',
    path: '/opportunities/opp_1/submissions',
    query: { status: 'approved' },
    call: (sdk, options) =>
      sdk.submissions.list('opp_1', { status: 'approved' }, options),
  },
  {
    name: 'submissions.listApplicants',
    operation: 'getOpportunitiesByOpportunityIdApplicants',
    method: 'GET',
    path: '/opportunities/opp_1/applicants',
    call: (sdk, options) =>
      sdk.submissions.listApplicants('opp_1', undefined, options),
  },
  {
    name: 'submissions.invite',
    operation: 'postSubmissionsBySubmissionIdInvite',
    method: 'POST',
    path: '/submissions/sub_1/invite',
    body: { reason: 'great fit' },
    call: (sdk, options) =>
      sdk.submissions.invite('sub_1', { reason: 'great fit' }, options),
  },
  {
    name: 'submissions.decline',
    operation: 'postSubmissionsBySubmissionIdDecline',
    method: 'POST',
    path: '/submissions/sub_1/decline',
    body: {},
    call: (sdk, options) =>
      sdk.submissions.decline('sub_1', undefined, options),
  },
  {
    name: 'submissions.retrieve',
    operation: 'getSubmissionsBySubmissionId',
    method: 'GET',
    path: '/submissions/sub_1',
    call: (sdk, options) => sdk.submissions.retrieve('sub_1', options),
  },
  {
    name: 'submissions.approve',
    operation: 'postSubmissionsBySubmissionIdApprove',
    method: 'POST',
    path: '/submissions/sub_1/approve',
    body: {},
    call: (sdk, options) => sdk.submissions.approve('sub_1', options),
  },
  {
    name: 'submissions.reject',
    operation: 'postSubmissionsBySubmissionIdReject',
    method: 'POST',
    path: '/submissions/sub_1/reject',
    body: { rejection_category: 'low_quality' },
    call: (sdk, options) =>
      sdk.submissions.reject(
        'sub_1',
        { rejection_category: 'low_quality' },
        options,
      ),
  },

  // Quotes (undocumented)
  {
    name: 'quotes.create',
    operation: 'postQuotes',
    method: 'POST',
    path: '/quotes',
    body: {
      taskDescription: 't',
      panelDescription: 'p',
      timelineHours: 48,
      submissionCount: 20,
    },
    call: (sdk, options) =>
      sdk.quotes.create(
        {
          taskDescription: 't',
          panelDescription: 'p',
          timelineHours: 48,
          submissionCount: 20,
        },
        options,
      ),
  },
  {
    name: 'quotes.retrieve',
    operation: 'getQuotesByQuoteId',
    method: 'GET',
    path: '/quotes/qte_1',
    call: (sdk, options) => sdk.quotes.retrieve('qte_1', options),
  },
  {
    name: 'quotes.launch',
    operation: 'postQuotesByQuoteIdLaunch',
    method: 'POST',
    path: '/quotes/qte_1/launch',
    body: { name: 'From quote' },
    call: (sdk, options) =>
      sdk.quotes.launch('qte_1', { name: 'From quote' }, options),
  },

  // Feasibility
  {
    name: 'feasibility.create',
    operation: 'postFeasibilityRequests',
    method: 'POST',
    path: '/feasibility/requests',
    body: { taskDescription: 't', panelDescription: 'p' },
    call: (sdk, options) =>
      sdk.feasibility.create(
        { taskDescription: 't', panelDescription: 'p' },
        options,
      ),
  },
  {
    name: 'feasibility.list',
    operation: 'getFeasibilityRequests',
    method: 'GET',
    path: '/feasibility/requests',
    call: (sdk, options) => sdk.feasibility.list(undefined, options),
  },
  {
    name: 'feasibility.retrieve',
    operation: 'getFeasibilityRequestsByRequestId',
    method: 'GET',
    path: '/feasibility/requests/fsb_1',
    call: (sdk, options) => sdk.feasibility.retrieve('fsb_1', options),
  },

  // Organizations
  {
    name: 'organizations.retrieveContext',
    operation: 'getOrganizationsCurrentContext',
    method: 'GET',
    path: '/organizations/current/context',
    call: (sdk, options) => sdk.organizations.retrieveContext(options),
  },

  // Webhooks
  {
    name: 'webhooks.listEventTypes',
    operation: 'getHooksEventTypes',
    method: 'GET',
    path: '/hooks/event-types',
    call: (sdk, options) => sdk.webhooks.listEventTypes(options),
  },
  {
    name: 'webhooks.list',
    operation: 'getHooksSubscriptions',
    method: 'GET',
    path: '/hooks/subscriptions',
    call: (sdk, options) => sdk.webhooks.list(options),
  },
  {
    name: 'webhooks.create',
    operation: 'postHooksSubscriptions',
    method: 'POST',
    path: '/hooks/subscriptions',
    body: {
      target_url: 'https://example.com/hooks/terac',
      event_types: ['submission.approved'],
    },
    call: (sdk, options) =>
      sdk.webhooks.create(
        {
          target_url: 'https://example.com/hooks/terac',
          event_types: ['submission.approved'],
        },
        options,
      ),
  },
  {
    name: 'webhooks.retrieve',
    operation: 'getHooksSubscriptionsBySubscriptionId',
    method: 'GET',
    path: '/hooks/subscriptions/whs_1',
    call: (sdk, options) => sdk.webhooks.retrieve('whs_1', options),
  },
  {
    name: 'webhooks.update',
    operation: 'patchHooksSubscriptionsBySubscriptionId',
    method: 'PATCH',
    path: '/hooks/subscriptions/whs_1',
    body: { is_enabled: true },
    call: (sdk, options) =>
      sdk.webhooks.update('whs_1', { is_enabled: true }, options),
  },
  {
    name: 'webhooks.confirm',
    operation: 'postHooksSubscriptionsBySubscriptionId',
    method: 'POST',
    path: '/hooks/subscriptions/whs_1',
    body: {},
    call: (sdk, options) => sdk.webhooks.confirm('whs_1', options),
  },
  {
    name: 'webhooks.delete',
    operation: 'deleteHooksSubscriptionsBySubscriptionId',
    method: 'DELETE',
    path: '/hooks/subscriptions/whs_1',
    call: (sdk, options) => sdk.webhooks.delete('whs_1', options),
  },
  {
    name: 'webhooks.retrieveSecret',
    operation: 'getHooksSubscriptionsBySubscriptionIdSecret',
    method: 'GET',
    path: '/hooks/subscriptions/whs_1/secret',
    call: (sdk, options) => sdk.webhooks.retrieveSecret('whs_1', options),
  },
  {
    name: 'webhooks.rotateSecret',
    operation: 'postHooksSubscriptionsBySubscriptionIdSecret',
    method: 'POST',
    path: '/hooks/subscriptions/whs_1/secret',
    body: {},
    call: (sdk, options) => sdk.webhooks.rotateSecret('whs_1', options),
  },
  {
    name: 'webhooks.listDeliveries',
    operation: 'getHooksEvents',
    method: 'GET',
    path: '/hooks/events',
    query: { subscription_id: 'whs_1' },
    call: (sdk, options) =>
      sdk.webhooks.listDeliveries({ subscription_id: 'whs_1' }, options),
  },
]

const generatedOperationNames = Object.getOwnPropertyNames(
  GeneratedTeracSdk.prototype,
).filter((name) => name !== 'constructor')

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** `GET /projects/{projectId}` → a matcher for `GET /projects/prj_1`. */
const routeMatcher = (route: string): RegExp =>
  new RegExp(
    `^${route
      .split('/')
      .map((segment) =>
        segment.startsWith('{') && segment.endsWith('}')
          ? '[^/]+'
          : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('/')}$`,
  )

describe('generated operation coverage', () => {
  test('the generated client exposes exactly the operations named here', () => {
    // Names, not counts: one operation renamed and another added would keep a
    // count test green while leaving the renamed one unwrapped.
    expect([...generatedOperationNames].sort()).toEqual(
      Object.keys(GENERATED_ROUTES).sort(),
    )
  })

  test('each named route is the one the generated method issues', () => {
    const source = readFileSync(
      join(repoRoot, 'src', 'generated', 'sdk.gen.ts'),
      'utf-8',
    )

    const issued = new Map<string, string>()
    const pattern =
      /public (\w+)<ThrowOnError[\s\S]*?\.(get|post|patch|put|delete)<[\s\S]*?url: '([^']+)'/g
    for (const match of source.matchAll(pattern)) {
      const [, name, method, url] = match
      if (name !== undefined && method !== undefined && url !== undefined) {
        issued.set(name, `${method.toUpperCase()} ${url}`)
      }
    }

    expect(Object.fromEntries(issued)).toEqual({ ...GENERATED_ROUTES })
  })

  test('every generated operation is wrapped by at least one facade case', () => {
    const wrapped = new Set<string>(cases.map((entry) => entry.operation))
    const unwrapped = Object.keys(GENERATED_ROUTES).filter(
      (name) => !wrapped.has(name),
    )
    expect(unwrapped).toEqual([])
  })

  test('each facade case issues its generated operation route', () => {
    for (const entry of cases) {
      const route = GENERATED_ROUTES[entry.operation]
      const [expectedMethod, expectedPath] = route.split(' ')
      expect(entry.method, entry.name).toBe(expectedMethod)
      expect(expectedPath).toBeDefined()
      expect(
        routeMatcher(expectedPath ?? '').test(entry.path),
        `${entry.name}: ${entry.method} ${entry.path} does not match ${route}`,
      ).toBe(true)
    }
  })
})

describe('facade operations', () => {
  test.each(cases)(
    '$name issues $method $path',
    async ({ method, path, body, query, call }) => {
      const server = await startServer((_request, response) => {
        json(response, 200, { ok: true, data: [], pagination: {} })
      })
      const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

      await call(terac, {})

      expect(server.requests).toHaveLength(1)
      const recorded = server.requests[0]
      if (!recorded) {
        throw new Error('no request was recorded')
      }

      expect(recorded.method).toBe(method)
      expect(recorded.path).toBe(path)
      expect(recorded.headers.authorization).toBe(`Bearer ${API_KEY}`)

      if (query) {
        expect(Object.fromEntries(recorded.query.entries())).toEqual(query)
      } else {
        expect([...recorded.query.keys()]).toEqual([])
      }

      if (body === undefined) {
        expect(recorded.body).toBe('')
      } else {
        // Terac rejects a body-less POST with 415, so every POST must carry a
        // JSON body and its Content-Type, even when it has no fields.
        expect(recorded.headers['content-type']).toContain('application/json')
        expect(JSON.parse(recorded.body)).toEqual(body)
      }

      await server.close()
    },
  )

  test.each(cases)('$name forwards a caller signal', async ({ call }) => {
    const server = await startServer((_request, response) => {
      json(response, 200, { ok: true, data: [], pagination: {} })
    })
    const terac = new TeracSdk({ apiKey: API_KEY, baseUrl: server.origin })

    const reason = new Error('cancelled before dispatch')
    const controller = new AbortController()
    controller.abort(reason)

    // If the trailing options argument were dropped, the request would go
    // out and this would resolve instead.
    await expect(call(terac, { signal: controller.signal })).rejects.toBe(
      reason,
    )
    expect(server.requests).toHaveLength(0)

    await server.close()
  })
})
