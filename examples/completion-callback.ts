import {
  buildTeracCompletionCallbackUrl,
  parseTeracTaskUrlParams,
} from '@coloop-ai/terac-sdk/callback'

// 1. A participant arrives on your task page. Terac appended the tracking
//    parameters to the `task_url` you configured on the opportunity.
const { submissionId, taskId } = parseTeracTaskUrlParams(
  'https://research.example.com/session?teracSubmissionId=sub_abc123&taskId=tsk_1',
)
console.log(`submission ${submissionId}, task ${taskId ?? 'none'}`)

// 2. When they finish, send their browser back. Set `result` for every exit
//    path: Terac reads a missing `result` as `completed`, so a screen-out with
//    no redirect looks identical to someone who abandoned the task.
const onCompleted = buildTeracCompletionCallbackUrl({
  submissionId,
  result: 'completed',
})
const onScreenedOut = buildTeracCompletionCallbackUrl({
  submissionId,
  result: 'screened_out',
})
const onQuotaFull = buildTeracCompletionCallbackUrl({
  submissionId,
  result: 'quota_full',
})

console.log({ onCompleted, onScreenedOut, onQuotaFull })
