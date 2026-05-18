// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import os from 'os';

export const DEFAULT_FEEDBACK_URL = process.env.FEEDBACK_API_URL || 'https://bananacode.sh/api/feedback';
export const DEFAULT_FEEDBACK_TIMEOUT_MS = 15000;

function getPackageVersion() {
    try {
        return process.env.npm_package_version || 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

async function readJsonResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
    }
    return data;
}

export async function submitFeedback(message, config = {}, options = {}) {
    const trimmed = String(message || '').trim();
    if (!trimmed) {
        throw new Error('Feedback cannot be empty.');
    }

    if (trimmed.length > 5000) {
        throw new Error('Feedback is too long. Please keep it under 5000 characters.');
    }

    const url = options.url || DEFAULT_FEEDBACK_URL;
    const payload = {
        message: trimmed,
        source: 'banana-code-cli',
        metadata: {
            version: getPackageVersion(),
            provider: config.provider || null,
            model: config.model || null,
            authType: config.authType || null,
            platform: os.platform(),
            release: os.release()
        }
    };

    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_FEEDBACK_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error(`Feedback request timed out after ${timeoutMs}ms.`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }

    return await readJsonResponse(res);
}
