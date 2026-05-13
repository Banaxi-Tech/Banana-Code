// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { requestPermission } from '../permissions.js';
import { sendRemoteToolEvent } from '../remote.js';
import { githubBackendRequest } from '../github.js';

const MAX_JSON_CHARS = 40000;
const MAX_FILE_CHARS = 80000;
const READ_METHODS = new Set(['GET', 'HEAD']);

function compactJson(value, maxChars = MAX_JSON_CHARS) {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n\n[Truncated ${text.length - maxChars} characters]`;
}

function summarizeRepository(repo = {}) {
    return {
        fullName: repo.full_name || [repo.owner?.login, repo.name].filter(Boolean).join('/'),
        name: repo.name,
        owner: repo.owner?.login,
        private: repo.private === true,
        visibility: repo.visibility || (repo.private ? 'private' : 'public'),
        archived: repo.archived === true,
        disabled: repo.disabled === true,
        fork: repo.fork === true,
        defaultBranch: repo.default_branch,
        language: repo.language || null,
        stars: repo.stargazers_count ?? 0,
        forks: repo.forks_count ?? 0,
        openIssues: repo.open_issues_count ?? 0,
        description: repo.description || '',
        htmlUrl: repo.html_url,
        updatedAt: repo.updated_at
    };
}

function requireName(value, field) {
    const text = String(value || '').trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(text)) {
        throw new Error(`${field} must contain only letters, numbers, dots, underscores, or dashes.`);
    }
    return text;
}

function requirePositiveInteger(value, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error(`${field} must be a positive integer.`);
    }
    return number;
}

function repoPath(owner, repo, suffix = '') {
    return `/repos/${encodeURIComponent(requireName(owner, 'owner'))}/${encodeURIComponent(requireName(repo, 'repo'))}${suffix}`;
}

function encodePathSegments(filePath) {
    return String(filePath || '')
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

async function callGitHubRest(config, method, path, body) {
    const payload = { method, path };
    if (body !== undefined) payload.body = body;
    const response = await githubBackendRequest(config, '/api/github/rest', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    return response;
}

async function confirmGitHubMutation(action, details) {
    const perm = await requestPermission(action, details);
    return perm.allowed;
}

export async function githubApiRequest({ method = 'GET', path, body = null }, config = {}) {
    const normalizedMethod = String(method || 'GET').trim().toUpperCase();
    const details = `${normalizedMethod} ${path}${body ? `\n\n${compactJson(body, 12000)}` : ''}`;

    if (!READ_METHODS.has(normalizedMethod)) {
        const allowed = await confirmGitHubMutation('GitHub API Request', details);
        if (!allowed) {
            sendRemoteToolEvent({ actionType: 'GitHub API Request', details, status: 'denied' });
            return `User denied GitHub API request: ${normalizedMethod} ${path}`;
        }
    }

    try {
        const response = await callGitHubRest(config, normalizedMethod, path, body);
        sendRemoteToolEvent({ actionType: 'GitHub API Request', details, status: 'completed' });
        return compactJson(response);
    } catch (err) {
        sendRemoteToolEvent({ actionType: 'GitHub API Request', details: `${details}\n\nError: ${err.message}`, status: 'failed' });
        return `GitHub API request failed: ${err.message}`;
    }
}

export async function githubListRepositories(_args = {}, config = {}) {
    try {
        const response = await callGitHubRest(config, 'GET', '/installation/repositories?per_page=100');
        const repositories = Array.isArray(response.data?.repositories)
            ? response.data.repositories.map(summarizeRepository)
            : [];

        return compactJson({
            totalCount: response.data?.total_count ?? repositories.length,
            count: repositories.length,
            note: repositories.length === 100
                ? 'GitHub returned the first 100 repositories. Use github_api_request with pagination for more.'
                : undefined,
            repositories
        });
    } catch (err) {
        return `GitHub repository list failed: ${err.message}`;
    }
}

export async function githubGetIssue({ owner, repo, issueNumber }, config = {}) {
    try {
        const number = requirePositiveInteger(issueNumber, 'issueNumber');
        const response = await callGitHubRest(config, 'GET', repoPath(owner, repo, `/issues/${number}`));
        return compactJson(response);
    } catch (err) {
        return `GitHub issue read failed: ${err.message}`;
    }
}

export async function githubGetPullRequest({ owner, repo, pullNumber }, config = {}) {
    try {
        const number = requirePositiveInteger(pullNumber, 'pullNumber');
        const response = await callGitHubRest(config, 'GET', repoPath(owner, repo, `/pulls/${number}`));
        return compactJson(response);
    } catch (err) {
        return `GitHub pull request read failed: ${err.message}`;
    }
}

export async function githubGetFile({ owner, repo, path, ref }, config = {}) {
    try {
        const encodedPath = encodePathSegments(path);
        if (!encodedPath) throw new Error('path is required.');

        const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
        const response = await callGitHubRest(config, 'GET', repoPath(owner, repo, `/contents/${encodedPath}${query}`));
        const data = response.data;

        if (Array.isArray(data)) {
            return compactJson(response);
        }

        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            const content = Buffer.from(data.content.replace(/\s+/g, ''), 'base64').toString('utf8');
            const truncated = content.length > MAX_FILE_CHARS
                ? `${content.slice(0, MAX_FILE_CHARS)}\n\n[Truncated ${content.length - MAX_FILE_CHARS} characters]`
                : content;
            return `File: ${data.path}\nSHA: ${data.sha}\nSize: ${data.size}\n\n${truncated}`;
        }

        return compactJson(response);
    } catch (err) {
        return `GitHub file read failed: ${err.message}`;
    }
}

export async function githubAddIssueComment({ owner, repo, issueNumber, body }, config = {}) {
    try {
        const number = requirePositiveInteger(issueNumber, 'issueNumber');
        const text = String(body || '').trim();
        if (!text) return 'GitHub comment failed: body is required.';

        const details = `${owner}/${repo}#${number}\n\n${text}`;
        const allowed = await confirmGitHubMutation('GitHub Comment', details);
        if (!allowed) {
            sendRemoteToolEvent({ actionType: 'GitHub Comment', details, status: 'denied' });
            return `User denied GitHub comment on ${owner}/${repo}#${number}`;
        }

        const response = await callGitHubRest(config, 'POST', repoPath(owner, repo, `/issues/${number}/comments`), { body: text });
        sendRemoteToolEvent({ actionType: 'GitHub Comment', details, status: 'completed' });
        return compactJson(response);
    } catch (err) {
        return `GitHub comment failed: ${err.message}`;
    }
}

export async function githubCreatePullRequestReview({ owner, repo, pullNumber, event = 'COMMENT', body = '', comments = [] }, config = {}) {
    try {
        const number = requirePositiveInteger(pullNumber, 'pullNumber');
        const reviewEvent = String(event || 'COMMENT').trim().toUpperCase();
        if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(reviewEvent)) {
            return 'GitHub review failed: event must be COMMENT, APPROVE, or REQUEST_CHANGES.';
        }

        const payload = { event: reviewEvent };
        if (body) payload.body = String(body);
        if (Array.isArray(comments) && comments.length > 0) payload.comments = comments;

        const details = `${owner}/${repo} PR #${number}\n\n${compactJson(payload, 16000)}`;
        const allowed = await confirmGitHubMutation('GitHub PR Review', details);
        if (!allowed) {
            sendRemoteToolEvent({ actionType: 'GitHub PR Review', details, status: 'denied' });
            return `User denied GitHub PR review on ${owner}/${repo}#${number}`;
        }

        const response = await callGitHubRest(config, 'POST', repoPath(owner, repo, `/pulls/${number}/reviews`), payload);
        sendRemoteToolEvent({ actionType: 'GitHub PR Review', details, status: 'completed' });
        return compactJson(response);
    } catch (err) {
        return `GitHub PR review failed: ${err.message}`;
    }
}

export async function githubMergePullRequest({ owner, repo, pullNumber, mergeMethod = 'merge', commitTitle, commitMessage }, config = {}) {
    try {
        const number = requirePositiveInteger(pullNumber, 'pullNumber');
        const method = String(mergeMethod || 'merge').trim().toLowerCase();
        if (!['merge', 'squash', 'rebase'].includes(method)) {
            return 'GitHub merge failed: mergeMethod must be merge, squash, or rebase.';
        }

        const payload = { merge_method: method };
        if (commitTitle) payload.commit_title = String(commitTitle);
        if (commitMessage) payload.commit_message = String(commitMessage);

        const details = `${owner}/${repo} PR #${number}\n\n${compactJson(payload, 12000)}`;
        const allowed = await confirmGitHubMutation('GitHub Merge Pull Request', details);
        if (!allowed) {
            sendRemoteToolEvent({ actionType: 'GitHub Merge Pull Request', details, status: 'denied' });
            return `User denied merging ${owner}/${repo}#${number}`;
        }

        const response = await callGitHubRest(config, 'PUT', repoPath(owner, repo, `/pulls/${number}/merge`), payload);
        sendRemoteToolEvent({ actionType: 'GitHub Merge Pull Request', details, status: 'completed' });
        return compactJson(response);
    } catch (err) {
        return `GitHub merge failed: ${err.message}`;
    }
}
