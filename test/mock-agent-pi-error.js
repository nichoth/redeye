#!/usr/bin/env node
// Mock pi agent that outputs one assistant message_end with
// stopReason 'error' and an errorMessage, then exits 0.
// Used by spawnAgent tests to verify providerError tracking.
const line = JSON.stringify({
    type: 'message_end',
    message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'model not found: test-model',
    },
})
process.stdout.write(line + '\n')
