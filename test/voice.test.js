// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getVoiceApiKey,
    getVoiceProvider,
    getVoiceProviderLabel,
    hasUsableVoiceConfig,
    isSupportedVoiceFile,
    isSupportedVoiceModel,
    mimeTypeFromFileName,
    openRouterAudioFormatFromFileName
} from '../src/voice.js';

test('voice file and model support checks are case-insensitive where expected', () => {
    assert.equal(isSupportedVoiceFile('/tmp/input.WAV'), true);
    assert.equal(isSupportedVoiceFile('/tmp/input.txt'), false);
    assert.equal(isSupportedVoiceModel('groq', 'whisper-large-v3'), true);
    assert.equal(isSupportedVoiceModel('openrouter', 'openai/gpt-4o-mini-transcribe'), true);
    assert.equal(isSupportedVoiceModel('unknown', 'whisper-large-v3'), false);
});

test('voice provider helpers prefer explicit provider and infer OpenRouter models', () => {
    assert.equal(getVoiceProvider({ provider: 'groq', model: 'openai/gpt-4o-transcribe' }), 'groq');
    assert.equal(getVoiceProvider({ model: 'openai/gpt-4o-transcribe' }), 'openrouter');
    assert.equal(getVoiceProvider({ model: 'whisper-large-v3' }), 'groq');
    assert.equal(getVoiceProviderLabel('openrouter'), 'OpenRouter');
    assert.equal(getVoiceProviderLabel('groq'), 'Groq');
});

test('hasUsableVoiceConfig validates the right provider-specific API key', () => {
    assert.equal(
        hasUsableVoiceConfig({
            voice: {
                provider: 'groq',
                groqApiKey: 'groq-key',
                model: 'whisper-large-v3'
            }
        }),
        true
    );
    assert.equal(
        hasUsableVoiceConfig({
            voice: {
                provider: 'openrouter',
                groqApiKey: 'wrong-key',
                model: 'openai/gpt-4o-transcribe'
            }
        }),
        false
    );
    assert.equal(
        hasUsableVoiceConfig({
            voice: {
                provider: 'openrouter',
                openrouterApiKey: 'openrouter-key',
                model: 'openai/gpt-4o-transcribe'
            }
        }),
        true
    );
});

test('voice API key and audio format helpers resolve expected values', () => {
    assert.equal(getVoiceApiKey({ provider: 'groq', groqApiKey: 'groq-key' }), 'groq-key');
    assert.equal(getVoiceApiKey({ provider: 'openrouter', openrouterApiKey: 'openrouter-key' }), 'openrouter-key');

    assert.equal(mimeTypeFromFileName('clip.mp3'), 'audio/mpeg');
    assert.equal(mimeTypeFromFileName('clip.unknown'), 'application/octet-stream');

    assert.equal(openRouterAudioFormatFromFileName('clip.wav'), 'wav');
    assert.equal(openRouterAudioFormatFromFileName('clip.bin', 'audio/x-wav; charset=binary'), 'wav');
    assert.equal(openRouterAudioFormatFromFileName('clip.bin', 'application/octet-stream'), null);
});
