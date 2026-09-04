import { TeracSdk } from '@coloop-ai/terac-sdk'
import type { TeracFilter, TeracOpportunity } from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

const terac = new TeracSdk({ apiKey })

// Cancel any call by passing a signal as the last argument.
const controller = new AbortController()
setTimeout(() => {
  controller.abort(new Error('took too long'))
}, 5_000)

const organization = await terac.organizations.retrieveContext({
  signal: controller.signal,
})
console.log(
  `${organization.organizationName}: $${String(organization.balanceDollars)}`,
)

// Read the event types rather than hardcoding them; Terac adds new ones
// without a version bump.
const eventTypes = await terac.webhooks.listEventTypes()
console.log(eventTypes.data.map((entry) => entry.event_type))

const filters: TeracFilter[] = (await terac.filters.list()).data
console.log(`${String(filters.length)} filters available`)

const opportunity: TeracOpportunity =
  await terac.opportunities.retrieve('opp_abc123')
console.log(opportunity.submission_stats)
