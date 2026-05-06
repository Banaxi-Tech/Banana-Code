// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import crypto from 'crypto';

const DEFAULT_TIMEOUT_MS = 45000;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function validateBrowserUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('Browser URL must be a valid absolute HTTP or HTTPS URL.');
    }

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        throw new Error('Browser can only open HTTP and HTTPS URLs.');
    }

    return parsed.toString();
}

function sanitizeParams(action, params = {}) {
    if (action === 'open') {
        return { ...params, url: validateBrowserUrl(params.url) };
    }
    return params;
}

export class BrowserBridge {
    constructor(ws) {
        this.ws = ws;
        this.pending = new Map();
        this.ready = false;
        this.state = { open: false, url: '', title: '', loading: false };
    }

    get available() {
        return this.ready && this.ws?.readyState === this.ws?.OPEN;
    }

    markReady() {
        this.ready = true;
    }

    updateState(state = {}) {
        this.state = { ...this.state, ...state };
    }

    handleResponse(data = {}) {
        const request = this.pending.get(data.requestId);
        if (!request) return false;

        clearTimeout(request.timeout);
        this.pending.delete(data.requestId);

        if (data.ok) {
            request.resolve(data.result || {});
        } else {
            request.reject(new Error(data.error || 'Browser request failed.'));
        }
        return true;
    }

    request(action, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
        if (!this.available) {
            return Promise.reject(new Error('Studio browser is not connected.'));
        }

        const safeParams = sanitizeParams(action, params);
        const requestId = crypto.randomUUID();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`Browser ${action} timed out.`));
            }, timeoutMs);

            this.pending.set(requestId, { resolve, reject, timeout });
            this.ws.send(JSON.stringify({
                type: 'browser_request',
                requestId,
                action,
                params: safeParams
            }));
        });
    }

    closeAll(reason = 'Browser bridge closed.') {
        for (const [requestId, request] of this.pending.entries()) {
            clearTimeout(request.timeout);
            request.reject(new Error(reason));
            this.pending.delete(requestId);
        }
    }
}
