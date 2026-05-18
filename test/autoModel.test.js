// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRoutingPrompt,
    claudeMessagesToAutoRouterHistory,
    geminiMessagesToAutoRouterHistory,
    openAIMessagesToAutoRouterHistory,
    parseRoutingResponse
} from '../src/utils/autoModel.js';

test('OpenAI router history skips the leading system message and records tool calls', () => {
    const history = openAIMessagesToAutoRouterHistory([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'Find config files' },
        {
            role: 'assistant',
            content: 'I will inspect them.',
            tool_calls: [
                { function: { name: 'search_files' } },
                { function: { name: 'read_file' } }
            ]
        },
        { role: 'tool', content: { matches: ['package.json'] } }
    ]);

    assert.equal(history.includes('system prompt'), false);
    assert.match(history, /\[user\] Find config files/);
    assert.match(history, /\[assistant\] I will inspect them\. \[tools: search_files, read_file\]/);
    assert.match(history, /\[tool\] \{"matches":\["package\.json"\]\}/);
});

test('Claude and Gemini router histories normalize tool blocks', () => {
    const claudeHistory = claudeMessagesToAutoRouterHistory([
        {
            role: 'assistant',
            content: [
                { type: 'text', text: 'Checking files' },
                { type: 'tool_use', name: 'read_file' },
                { type: 'tool_result' }
            ]
        }
    ]);
    const geminiHistory = geminiMessagesToAutoRouterHistory([
        {
            role: 'model',
            parts: [
                { text: 'Checking files' },
                { functionCall: { name: 'read_file' } },
                { functionResponse: { name: 'read_file' } }
            ]
        }
    ]);

    assert.equal(claudeHistory, '[assistant] Checking files [tool read_file] [tool result]');
    assert.equal(geminiHistory, '[assistant] Checking files [tool read_file] [tool result]');
});

test('buildRoutingPrompt includes model choices, current message, and Claude effort guidance', () => {
    const prompt = buildRoutingPrompt(
        [{ id: 'claude-sonnet-4-6', description: 'Balanced coding model' }],
        'Fix the failing tests',
        '[user] The test suite is broken',
        'claude'
    );

    assert.match(prompt, /claude-sonnet-4-6: Balanced coding model/);
    assert.match(prompt, /Fix the failing tests/);
    assert.match(prompt, /Conversation history/);
    assert.match(prompt, /reasoning "effort" level/);
});

test('parseRoutingResponse extracts valid router JSON and rejects invalid output', () => {
    assert.deepEqual(
        parseRoutingResponse('Here is the route: {"model":"gpt-5.4-mini","reason":"simple task"}'),
        {
            model: 'gpt-5.4-mini',
            effort: 'high',
            reason: 'simple task'
        }
    );

    assert.deepEqual(
        parseRoutingResponse('{"model":"claude-sonnet-4-6","effort":"medium","reason":"coding"}'),
        {
            model: 'claude-sonnet-4-6',
            effort: 'medium',
            reason: 'coding'
        }
    );

    assert.equal(parseRoutingResponse('not json'), null);
    assert.equal(parseRoutingResponse('{"model":123,"reason":"bad"}'), null);
});
