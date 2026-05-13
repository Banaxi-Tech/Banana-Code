// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { input } from '@inquirer/prompts';

export const DEFAULT_GITHUB_INTEGRATION_URL = process.env.GITHUB_INTEGRATION_URL
    || process.env.REMOTE_API_URL
    || 'https://bananacode.sh';

const CONNECT_POLL_INTERVAL_MS = 2500;
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

export function normalizeGitHubBackendUrl(value) {
    const raw = String(value || DEFAULT_GITHUB_INTEGRATION_URL).trim().replace(/\/+$/, '');
    try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('GitHub backend URL must use HTTP or HTTPS.');
        }
        return url.toString().replace(/\/+$/, '');
    } catch (err) {
        throw new Error(`Invalid GitHub backend URL: ${err.message}`);
    }
}

export function getGitHubIntegration(config = {}) {
    const github = config.github || {};
    if (github.enabled !== true || !github.token || !github.baseUrl) {
        return null;
    }
    return {
        ...github,
        baseUrl: normalizeGitHubBackendUrl(github.baseUrl)
    };
}

async function readJsonResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
    }
    return data;
}

export async function githubBackendRequest(config, path, options = {}) {
    const integration = getGitHubIntegration(config);
    if (!integration) {
        throw new Error('GitHub is not connected. Run /github first.');
    }

    const res = await fetch(`${integration.baseUrl}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${integration.token}`,
            ...(options.headers || {})
        }
    });
    return await readJsonResponse(res);
}

async function startConnect(baseUrl) {
    const res = await fetch(`${baseUrl}/api/github/connect/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: 'Banana Code CLI' })
    });
    return await readJsonResponse(res);
}

async function pollConnect(baseUrl, state, pollToken) {
    const url = `${baseUrl}/api/github/connect/poll?state=${encodeURIComponent(state)}`;
    const res = await fetch(url, {
        headers: { 'X-Banana-GitHub-Poll-Token': pollToken }
    });

    if (res.status === 202) {
        return { pending: true };
    }

    return await readJsonResponse(res);
}

export async function setupGitHubIntegration(config = {}) {
    const currentUrl = config.github?.baseUrl || DEFAULT_GITHUB_INTEGRATION_URL;
    const baseUrlInput = await input({
        message: 'GitHub integration backend URL:',
        default: currentUrl,
        validate: (value) => {
            try {
                normalizeGitHubBackendUrl(value);
                return true;
            } catch (err) {
                return err.message;
            }
        }
    });
    const baseUrl = normalizeGitHubBackendUrl(baseUrlInput);

    const start = await startConnect(baseUrl);
    console.log(chalk.cyan('\nOpening GitHub to install or authorize the Banana Code GitHub App.'));
    console.log(chalk.gray(`If your browser does not open, visit: ${start.installUrl}`));
    await open(start.installUrl).catch(() => {});

    const spinner = ora({ text: 'Waiting for GitHub authorization...', color: 'yellow', stream: process.stdout }).start();
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    let connected;

    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, CONNECT_POLL_INTERVAL_MS));
        const result = await pollConnect(baseUrl, start.state, start.pollToken);
        if (!result.pending) {
            connected = result;
            break;
        }
    }

    spinner.stop();

    if (!connected?.token) {
        throw new Error('GitHub authorization timed out. Run /github again after checking the GitHub App setup URL.');
    }

    const nextConfig = {
        ...config,
        github: {
            enabled: true,
            baseUrl,
            token: connected.token,
            installationId: connected.installation?.id,
            accountLogin: connected.installation?.accountLogin,
            accountType: connected.installation?.accountType,
            connectedAt: Date.now()
        }
    };

    console.log(chalk.green(`GitHub connected for ${connected.installation?.accountLogin || 'installation ' + connected.installation?.id}.`));
    return nextConfig;
}

export async function showGitHubStatus(config = {}) {
    const integration = getGitHubIntegration(config);
    if (!integration) {
        console.log(chalk.yellow('GitHub is not connected. Run /github to connect a GitHub App installation.'));
        return;
    }

    try {
        const status = await githubBackendRequest(config, '/api/github/installation');
        console.log(chalk.green('GitHub is connected.'));
        console.log(chalk.cyan(`Account: ${status.installation.accountLogin} (${status.installation.accountType})`));
        console.log(chalk.cyan(`Installation ID: ${status.installation.id}`));
        console.log(chalk.gray(`Backend: ${integration.baseUrl}`));
    } catch (err) {
        console.log(chalk.red(`GitHub connection check failed: ${err.message}`));
        console.log(chalk.gray('Run /github reconnect to create a fresh connection token.'));
    }
}

export async function disconnectGitHubIntegration(config = {}) {
    const integration = getGitHubIntegration(config);
    if (integration) {
        await fetch(`${integration.baseUrl}/api/github/token`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${integration.token}` }
        }).catch(() => {});
    }

    const nextConfig = { ...config };
    delete nextConfig.github;
    console.log(chalk.green('GitHub disconnected. GitHub tools are disabled.'));
    return nextConfig;
}
