import { GeneratedTeracSdk, generated } from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

// `TeracSdk` is the supported surface. It refuses redirects, applies a deadline
// that covers the response body, pins JSON decoding and classifies errors. The
// generated client does none of that, so anything you still want you have to
// configure yourself.
const client = generated.createClient({
  baseUrl: 'https://terac.com/api/external/v2',
  auth: () => `Bearer ${apiKey}`,
  redirect: 'error',
  parseAs: 'json',
  throwOnError: true,
})

const sdk = new GeneratedTeracSdk({ client })
const { data } = await sdk.getProjects<true>({ query: { limit: 10 } })

console.log(`${String(data.data.length)} projects`)
