#!/usr/bin/env node
// Mock pi agent that outputs an error message_end followed by
// a toolUse message_end (simulating pi retrying and recovering).
// Used by spawnAgent tests to verify that only the LAST
// assistant message_end counts for providerError.
const error = JSON.stringify({
    type: 'message_end',
    message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'model not found: test-model',
    },
})
const success = JSON.stringify({
    type: 'message_end',
    message: {
        role: 'assistant',
        stopReason: 'toolUse',
    },
})
process.stdout.write(error + '\n')
process.stdout.write(success + '\n')
