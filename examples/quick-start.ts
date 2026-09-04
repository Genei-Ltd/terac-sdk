import { TeracSdk } from '@coloop-ai/terac-sdk'

const apiKey = process.env.TERAC_API_KEY
if (!apiKey) {
  throw new Error('Set TERAC_API_KEY to an organisation API key (tk_…)')
}

const terac = new TeracSdk({ apiKey, timeoutMs: 30_000 })

// A project groups opportunities.
const project = await terac.projects.create({ name: 'Q3 developer research' })

// An opportunity is the unit of recruitment. It starts as a draft.
const opportunity = await terac.opportunities.create({
  project_id: project.id,
  title: 'How you debug production',
  description: 'A 30 minute conversation about your debugging workflow.',
  business_type: 'b2b',
  num_participants: 10,
  // The work happens at `task_url`; screening only decides who gets there.
  tasks: [
    {
      sequence: 1,
      task_type: 'interview',
      review_type: 'manual_review',
      task_url: 'https://research.example.com/session',
      duration_minutes: 30,
    },
  ],
  screening_questions: [
    {
      text: 'How often do you debug production incidents?',
      pick: 'one',
      answers: [
        { text: 'Weekly or more often', qualify_logic: 'must' },
        { text: 'A few times a year', qualify_logic: 'reject' },
        { text: 'Never', qualify_logic: 'reject' },
      ],
    },
  ],
})

// Launching spends funds and starts recruiting.
const live = await terac.opportunities.launch(opportunity.id)
console.log(`${live.id} is ${live.status}`)

// Read what came back, and pay the people whose work you accept.
const submissions = await terac.submissions.list(live.id, {
  status: 'awaiting_review',
})

for (const submission of submissions.data) {
  await terac.submissions.approve(submission.id)
}
