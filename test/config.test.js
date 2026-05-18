// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    applyProjectLocalSettings,
    copyBananaSplitProviderConfig,
    getBananaSplitLocalConfig,
    getBananaSplitReviewerConfig,
    getProjectLocalSettingsPath,
    hasProjectLocalSettings,
    normalizeImageGenBaseUrl,
    normalizeLlamaCppBaseUrl
} from '../src/config.js';

test('normalizes image generation and llama.cpp base URLs', () => {
    assert.equal(normalizeImageGenBaseUrl(' http://127.0.0.1:8000/// '), 'http://127.0.0.1:8000');
    assert.equal(normalizeImageGenBaseUrl(''), 'http://127.0.0.1:8000');
    assert.equal(normalizeLlamaCppBaseUrl(' http://127.0.0.1:8080/// '), 'http://127.0.0.1:8080/v1');
    assert.equal(normalizeLlamaCppBaseUrl('http://127.0.0.1:8080/v1///'), 'http://127.0.0.1:8080/v1');
});

test('copies only provider-specific Banana Split settings', () => {
    assert.deepEqual(
        copyBananaSplitProviderConfig('openai', {
            model: 'gpt-5.4',
            apiKey: 'sk-test',
            authType: 'oauth',
            openaiCodexEffort: 'high',
            claudeEffort: 'max'
        }),
        {
            provider: 'openai',
            model: 'gpt-5.4',
            apiKey: 'sk-test',
            authType: 'oauth',
            openaiCodexEffort: 'high'
        }
    );

    assert.deepEqual(
        copyBananaSplitProviderConfig('claude', {
            model: 'claude-sonnet-4-6',
            useExtendedCache: true,
            claudeEffort: 'medium',
            llamaCppBaseUrl: 'http://localhost:8080/v1'
        }),
        {
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            useExtendedCache: true,
            claudeEffort: 'medium'
        }
    );
});

test('builds Banana Split local and reviewer configs without mutating the source config', () => {
    const config = {
        provider: 'openai',
        model: 'gpt-5.4',
        debug: true,
        bananaSplit: {
            enabled: true,
            local: {
                provider: 'qwen',
                model: 'qwen3.6-flash',
                qwenBaseUrl: 'https://dashscope.example/v1'
            },
            reviewer: {
                provider: 'claude',
                model: 'claude-sonnet-4-6',
                claudeEffort: 'high'
            }
        }
    };

    const local = getBananaSplitLocalConfig(config);
    assert.equal(local.provider, 'qwen');
    assert.equal(local.model, 'qwen3.6-flash');
    assert.equal(local.qwenBaseUrl, 'https://dashscope.example/v1');
    assert.equal(config.provider, 'openai');

    const reviewer = getBananaSplitReviewerConfig(config);
    assert.equal(reviewer.provider, 'claude');
    assert.equal(reviewer.model, 'claude-sonnet-4-6');
    assert.equal(reviewer.bananaSplit.enabled, false);
    assert.equal(reviewer.bananaSplitReviewerMode, true);
    assert.equal(reviewer.isApiMode, true);
    assert.equal(reviewer.debug, false);
});

test('applies project-local settings with a deep merge from a workspace file', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-code-config-'));
    await fs.mkdir(path.join(cwd, '.banana'));
    await fs.writeFile(
        getProjectLocalSettingsPath(cwd),
        JSON.stringify({
            provider: 'claude',
            nested: {
                beta: false,
                gamma: true
            },
            bananaSplit: {
                enabled: true
            }
        }),
        'utf8'
    );

    const baseConfig = {
        provider: 'openai',
        model: 'gpt-5.4',
        nested: {
            alpha: true,
            beta: true
        },
        bananaSplit: {
            local: {
                provider: 'qwen'
            }
        }
    };

    try {
        assert.equal(await hasProjectLocalSettings(cwd), true);
        const merged = await applyProjectLocalSettings(baseConfig, cwd);

        assert.equal(merged.provider, 'claude');
        assert.equal(merged.model, 'gpt-5.4');
        assert.deepEqual(merged.nested, { alpha: true, beta: false, gamma: true });
        assert.deepEqual(merged.bananaSplit, {
            local: {
                provider: 'qwen'
            },
            enabled: true
        });
        assert.equal(baseConfig.provider, 'openai');
        assert.deepEqual(baseConfig.nested, { alpha: true, beta: true });
    } finally {
        await fs.rm(cwd, { recursive: true, force: true });
    }
});

test('applyProjectLocalSettings returns the same config when no project settings exist', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-code-config-empty-'));
    const config = { provider: 'openai' };

    try {
        assert.equal(await hasProjectLocalSettings(cwd), false);
        assert.equal(await applyProjectLocalSettings(config, cwd), config);
    } finally {
        await fs.rm(cwd, { recursive: true, force: true });
    }
});
