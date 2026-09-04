import { TeracSdk } from '@coloop-ai/terac-sdk'
import { zGetSubmissionsBySubmissionIdResponse } from '@coloop-ai/terac-sdk/zod'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

const terac = new TeracSdk({ apiKey })

// The types describe what the vendored document declares. The schema checks
// what actually arrived, which is a different question while the API is beta.
const submission = await terac.submissions.retrieve('sub_abc123')
const checked = zGetSubmissionsBySubmissionIdResponse.safeParse(submission)

if (!checked.success) {
  throw new Error(
    `Terac sent an unexpected submission: ${checked.error.message}`,
  )
}

console.log(`${checked.data.id} is ${checked.data.status}`)
