/**
 * Every facade operation, exercised against a recording server: the HTTP
 * method, the path (including path-parameter substitution), the query string
 * and the request body.
 *
 * The table is written out by hand rather than generated, so a wrong path or a
 * swapped parameter is caught by reading the file, not only by running it.
 */
import { describe, expect, test } from 'vitest'
import { GeneratedTeracSdk } from '../src/generated/sdk.gen'
import { TeracSdk } from '../src/index'
import type { TeracRequestOptions } from '../src/index'
import { json, startServer } from './helpers/server'

const API_KEY = 'tk_operations'

type OperationCase = {
  name: string
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
    method: 'GET',
    path: '/projects',
    query: { limit: '10', cursor: 'abc' },
    call: (sdk, options) =>
      sdk.projects.list({ limit: 10, cursor: 'abc' }, options),
  },
  {
    name: 'projects.create',
    method: 'POST',
    path: '/projects',
    body: { name: 'Q3 discovery' },
    call: (sdk, options) =>
      sdk.projects.create({ name: 'Q3 discovery' }, options),
  },
  {
    name: 'projects.retrieve',
    method: 'GET',
    path: '/projects/prj_1',
    call: (sdk, options) => sdk.projects.retrieve('prj_1', options),
  },
  {
    name: 'projects.update',
    method: 'PATCH',
    path: '/projects/prj_1',
    body: { name: 'Renamed' },
    call: (sdk, options) =>
      sdk.projects.update('prj_1', { name: 'Renamed' }, options),
  },

  // Filters
  {
    name: 'filters.list',
    method: 'GET',
    path: '/filters',
    call: (sdk, options) => sdk.filters.list(options),
  },
  {
    name: 'filters.listOptions',
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
    method: 'GET',
    path: '/opportunities',
    query: { projectId: 'prj_1' },
    call: (sdk, options) =>
      sdk.opportunities.list({ projectId: 'prj_1' }, options),
  },
  {
    name: 'opportunities.create',
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
    method: 'GET',
    path: '/opportunities/opp_1',
    call: (sdk, options) => sdk.opportunities.retrieve('opp_1', options),
  },
  {
    name: 'opportunities.update',
    method: 'PATCH',
    path: '/opportunities/opp_1',
    body: { title: 'New title' },
    call: (sdk, options) =>
      sdk.opportunities.update('opp_1', { title: 'New title' }, options),
  },
  {
    name: 'opportunities.delete',
    method: 'DELETE',
    path: '/opportunities/opp_1',
    call: (sdk, options) => sdk.opportunities.delete('opp_1', options),
  },
  {
    name: 'opportunities.launch',
    method: 'POST',
    path: '/opportunities/opp_1/launch',
    body: {},
    call: (sdk, options) => sdk.opportunities.launch('opp_1', options),
  },
  {
    name: 'opportunities.pause',
    method: 'POST',
    path: '/opportunities/opp_1/pause',
    body: {},
    call: (sdk, options) => sdk.opportunities.pause('opp_1', options),
  },
  {
    name: 'opportunities.resume',
    method: 'POST',
    path: '/opportunities/opp_1/resume',
    body: {},
    call: (sdk, options) => sdk.opportunities.resume('opp_1', options),
  },
  {
    name: 'opportunities.stop',
    method: 'POST',
    path: '/opportunities/opp_1/stop',
    body: { reason: 'enough data' },
    call: (sdk, options) =>
      sdk.opportunities.stop('opp_1', { reason: 'enough data' }, options),
  },
  {
    name: 'opportunities.stop (default body)',
    method: 'POST',
    path: '/opportunities/opp_1/stop',
    body: {},
    call: (sdk, options) => sdk.opportunities.stop('opp_1', undefined, options),
  },

  // Submissions
  {
    name: 'submissions.list',
    method: 'GET',
    path: '/opportunities/opp_1/submissions',
    query: { status: 'approved' },
    call: (sdk, options) =>
      sdk.submissions.list('opp_1', { status: 'approved' }, options),
  },
  {
    name: 'submissions.listApplicants',
    method: 'GET',
    path: '/opportunities/opp_1/applicants',
    call: (sdk, options) =>
      sdk.submissions.listApplicants('opp_1', undefined, options),
  },
  {
    name: 'submissions.invite',
    method: 'POST',
    path: '/submissions/sub_1/invite',
    body: { reason: 'great fit' },
    call: (sdk, options) =>
      sdk.submissions.invite('sub_1', { reason: 'great fit' }, options),
  },
  {
    name: 'submissions.decline',
    method: 'POST',
    path: '/submissions/sub_1/decline',
    body: {},
    call: (sdk, options) =>
      sdk.submissions.decline('sub_1', undefined, options),
  },
  {
    name: 'submissions.retrieve',
    method: 'GET',
    path: '/submissions/sub_1',
    call: (sdk, options) => sdk.submissions.retrieve('sub_1', options),
  },
  {
    name: 'submissions.approve',
    method: 'POST',
    path: '/submissions/sub_1/approve',
    body: {},
    call: (sdk, options) => sdk.submissions.approve('sub_1', options),
  },
  {
    name: 'submissions.reject',
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
    method: 'GET',
    path: '/quotes/qte_1',
    call: (sdk, options) => sdk.quotes.retrieve('qte_1', options),
  },
  {
    name: 'quotes.launch',
    method: 'POST',
    path: '/quotes/qte_1/launch',
    body: { name: 'From quote' },
    call: (sdk, options) =>
      sdk.quotes.launch('qte_1', { name: 'From quote' }, options),
  },

  // Feasibility
  {
    name: 'feasibility.create',
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
    method: 'GET',
    path: '/feasibility/requests',
    call: (sdk, options) => sdk.feasibility.list(undefined, options),
  },
  {
    name: 'feasibility.retrieve',
    method: 'GET',
    path: '/feasibility/requests/fsb_1',
    call: (sdk, options) => sdk.feasibility.retrieve('fsb_1', options),
  },

  // Organizations
  {
    name: 'organizations.retrieveContext',
    method: 'GET',
    path: '/organizations/current/context',
    call: (sdk, options) => sdk.organizations.retrieveContext(options),
  },

  // Webhooks
  {
    name: 'webhooks.listEventTypes',
    method: 'GET',
    path: '/hooks/event-types',
    call: (sdk, options) => sdk.webhooks.listEventTypes(options),
  },
  {
    name: 'webhooks.list',
    method: 'GET',
    path: '/hooks/subscriptions',
    call: (sdk, options) => sdk.webhooks.list(options),
  },
  {
    name: 'webhooks.create',
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
    method: 'GET',
    path: '/hooks/subscriptions/whs_1',
    call: (sdk, options) => sdk.webhooks.retrieve('whs_1', options),
  },
  {
    name: 'webhooks.update',
    method: 'PATCH',
    path: '/hooks/subscriptions/whs_1',
    body: { is_enabled: true },
    call: (sdk, options) =>
      sdk.webhooks.update('whs_1', { is_enabled: true }, options),
  },
  {
    name: 'webhooks.confirm',
    method: 'POST',
    path: '/hooks/subscriptions/whs_1',
    body: {},
    call: (sdk, options) => sdk.webhooks.confirm('whs_1', options),
  },
  {
    name: 'webhooks.delete',
    method: 'DELETE',
    path: '/hooks/subscriptions/whs_1',
    call: (sdk, options) => sdk.webhooks.delete('whs_1', options),
  },
  {
    name: 'webhooks.retrieveSecret',
    method: 'GET',
    path: '/hooks/subscriptions/whs_1/secret',
    call: (sdk, options) => sdk.webhooks.retrieveSecret('whs_1', options),
  },
  {
    name: 'webhooks.rotateSecret',
    method: 'POST',
    path: '/hooks/subscriptions/whs_1/secret',
    body: {},
    call: (sdk, options) => sdk.webhooks.rotateSecret('whs_1', options),
  },
  {
    name: 'webhooks.listDeliveries',
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

describe('facade operations', () => {
  test('every generated operation is wrapped exactly once', () => {
    // 39 operations across 28 paths in Terac's document. When the provider adds
    // an endpoint, generation adds a method and this fails until it is wrapped.
    expect(generatedOperationNames).toHaveLength(39)

    const distinctRoutes = new Set(
      cases.map((entry) => `${entry.method} ${entry.path}`),
    )
    // The two `opportunities.stop` cases share a route, so the table covers
    // one route per generated operation.
    expect(distinctRoutes.size).toBe(generatedOperationNames.length)
  })

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
