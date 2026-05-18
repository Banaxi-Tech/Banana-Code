// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getGitHubIntegration,
    normalizeGitHubBackendUrl
} from '../src/github.js';

test('normalizeGitHubBackendUrl trims trailing slashes and preserves valid HTTP(S) URLs', () => {
    assert.equal(normalizeGitHubBackendUrl(' https://bananacode.sh/// '), 'https://bananacode.sh');
    assert.equal(normalizeGitHubBackendUrl('http://localhost:3000/api///'), 'http://localhost:3000/api');
});

test('normalizeGitHubBackendUrl rejects non-HTTP URLs and malformed input', () => {
    assert.throws(
        () => normalizeGitHubBackendUrl('ftp://example.com'),
        /HTTP or HTTPS/
    );
    assert.throws(
        () => normalizeGitHubBackendUrl('not a url'),
        /Invalid GitHub backend URL/
    );
});

test('getGitHubIntegration requires an enabled integration with token and base URL', () => {
    assert.equal(getGitHubIntegration({}), null);
    assert.equal(getGitHubIntegration({ github: { enabled: false, token: 'token', baseUrl: 'https://example.com' } }), null);
    assert.equal(getGitHubIntegration({ github: { enabled: true, baseUrl: 'https://example.com' } }), null);
    assert.equal(getGitHubIntegration({ github: { enabled: true, token: 'token' } }), null);

    assert.deepEqual(
        getGitHubIntegration({
            github: {
                enabled: true,
                token: 'token',
                baseUrl: 'https://example.com///',
                installationId: 123
            }
        }),
        {
            enabled: true,
            token: 'token',
            baseUrl: 'https://example.com',
            installationId: 123
        }
    );
});
