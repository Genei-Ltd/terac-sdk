import { generated, getProjects } from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

// `TeracSdk` is the supported surface. It refuses redirects, applies a deadline
// that covers the response body, pins JSON decoding and classifies errors. The
// generated operations do none of that, so anything you still want you have to
// configure yourself.
const client = generated.createClient({
  baseUrl: 'https://terac.com/api/external/v2',
  auth: () => `Bearer ${apiKey}`,
  redirect: 'error',
  parseAs: 'json',
  throwOnError: true,
})

// Every generated operation is a plain function that takes its client. Nothing
// holds a reference to `client` except the code that passes it.
const { data } = await getProjects<true>({ client, query: { limit: 10 } })

console.log(`${String(data.data.length)} projects`)
