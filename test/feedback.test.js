// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';

import { submitFeedback } from '../src/feedback.js';

test('submitFeedback posts CLI feedback payload', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl;
    let capturedPayload;

    globalThis.fetch = async (url, options) => {
        capturedUrl = url;
        capturedPayload = JSON.parse(options.body);
        return new Response(JSON.stringify({ ok: true, id: 'feedback-1' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    try {
        const result = await submitFeedback('  useful feedback  ', {
            provider: 'openai',
            model: 'gpt-5.4-mini',
            authType: 'oauth'
        }, {
            url: 'https://example.test/api/feedback'
        });

        assert.deepEqual(result, { ok: true, id: 'feedback-1' });
        assert.equal(capturedUrl, 'https://example.test/api/feedback');
        assert.equal(capturedPayload.message, 'useful feedback');
        assert.equal(capturedPayload.source, 'banana-code-cli');
        assert.equal(capturedPayload.metadata.provider, 'openai');
        assert.equal(capturedPayload.metadata.model, 'gpt-5.4-mini');
        assert.equal(capturedPayload.metadata.authType, 'oauth');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('submitFeedback rejects empty feedback', async () => {
    await assert.rejects(
        () => submitFeedback('   '),
        /Feedback cannot be empty/
    );
});

test('submitFeedback times out stalled requests', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (_url, options) => {
        return await new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
        });
    };

    try {
        await assert.rejects(
            () => submitFeedback('stalled request', {}, {
                url: 'https://example.test/api/feedback',
                timeoutMs: 5
            }),
            /timed out after 5ms/
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
