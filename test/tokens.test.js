// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    estimateConversationTokens,
    estimateTokens,
    getContextBreakdown
} from '../src/utils/tokens.js';

test('estimateTokens handles non-strings and rounds up character counts', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens({ text: 'hello' }), 0);
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
});

test('estimateConversationTokens handles arrays and circular message fallback', () => {
    const messages = [
        { role: 'user', content: 'hello world' },
        { role: 'assistant', content: [{ type: 'text', text: 'response' }] }
    ];
    assert.equal(estimateConversationTokens(messages), estimateTokens(JSON.stringify(messages)));
    assert.equal(estimateConversationTokens('not messages'), 0);

    const circular = { role: 'user', content: 'hello' };
    circular.self = circular;
    assert.equal(estimateConversationTokens([circular]), estimateTokens('hello'));
});

test('getContextBreakdown categorizes messages and reports percentages', () => {
    const messages = [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
        { role: 'assistant', content: 'assistant response' },
        { role: 'tool', content: 'tool output' },
        { role: 'metadata', content: 'other' }
    ];

    const breakdown = getContextBreakdown(messages);

    assert.equal(
        breakdown.total,
        breakdown.system + breakdown.chat + breakdown.tools + breakdown.other
    );
    assert.ok(breakdown.system > 0);
    assert.ok(breakdown.chat > 0);
    assert.ok(breakdown.tools > 0);
    assert.ok(breakdown.other > 0);
    assert.equal(
        breakdown.percentages.system
        + breakdown.percentages.chat
        + breakdown.percentages.tools
        + breakdown.percentages.other >= 99,
        true
    );
});
