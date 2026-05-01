// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getBananaSplitReviewerConfig } from '../config.js';

const execFileAsync = promisify(execFile);
const MAX_ACTIVITY_CHARS = 60000;
const MAX_GIT_CONTEXT_CHARS = 30000;
const EMPTY_REVIEWER_RESPONSE_CONTINUATION = `SYSTEM: Your previous BananaSplit review/fix turn used tools but ended without a final response.
Continue from the latest tool results now. If you found a real bug, apply the minimal fix with the available file-editing tools. If the change is correct, return the required review summary. Do not repeat completed tool calls unless the latest tool result shows it is necessary.`;

function normalizeArgs(args) {
    if (typeof args === 'string') {
        try {
            return JSON.parse(args);
        } catch (error) {
            return { summary: args };
        }
    }

    return args || {};
}

function truncate(value, maxChars = MAX_GIT_CONTEXT_CHARS) {
    if (!value || value.length <= maxChars) {
        return value || '';
    }

    return `${value.slice(0, maxChars)}\n\n[Output truncated to ${maxChars} characters.]`;
}

function stringifyContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content.map(item => {
            if (typeof item === 'string') return item;
            if (item?.type === 'text') return item.text;
            return JSON.stringify(item);
        }).filter(Boolean).join('\n');
    }

    if (content === null || content === undefined) {
        return '';
    }

    return JSON.stringify(content);
}

function stringifyToolArgs(args) {
    if (typeof args === 'string') return args;
    if (args === null || args === undefined) return '';
    return JSON.stringify(args, null, 2);
}

function messageHasToolActivity(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.role === 'tool' || message.type === 'function_call_output') return true;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;

    const content = Array.isArray(message.content) ? message.content : [];
    if (content.some(part => part?.type === 'tool_use' || part?.type === 'tool_result')) return true;

    const parts = Array.isArray(message.parts) ? message.parts : [];
    return parts.some(part => part?.functionCall || part?.functionResponse);
}

function hasToolActivitySince(provider, startIndex) {
    const messages = provider?.messages;
    if (!Array.isArray(messages)) return false;
    return messages.slice(startIndex).some(messageHasToolActivity);
}

function isEmptyResponse(responseText) {
    return typeof responseText !== 'string' || responseText.trim().length === 0;
}

function extractRecentLocalActivity() {
    const messages = global.activeProviderInstance?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return 'No local model activity log is available.';
    }

    let startIndex = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') {
            startIndex = i;
            break;
        }
    }

    const activity = [];
    const recentMessages = messages.slice(startIndex);

    for (const message of recentMessages) {
        if (!message || typeof message !== 'object') continue;

        if (message.role === 'user') {
            activity.push(`USER REQUEST:\n${truncate(stringifyContent(message.content), 8000)}`);
            continue;
        }

        if (message.role === 'assistant' || message.role === 'model') {
            const content = stringifyContent(message.content);
            if (content) {
                activity.push(`LOCAL MODEL RESPONSE:\n${truncate(content, 12000)}`);
            }

            const toolCalls = message.tool_calls || [];
            for (const call of toolCalls) {
                const name = call.function?.name || call.name || 'unknown_tool';
                if (name === 'bananasplit_review') continue;
                const args = call.function?.arguments ?? call.arguments ?? {};
                activity.push(`LOCAL TOOL CALL: ${name}\nARGS:\n${truncate(stringifyToolArgs(args), 12000)}`);
            }
            continue;
        }

        if (message.role === 'tool') {
            activity.push(`LOCAL TOOL RESULT:\n${truncate(stringifyContent(message.content), 12000)}`);
        }
    }

    return truncate(activity.join('\n\n---\n\n') || 'No tool calls or local model actions were recorded for this turn.', MAX_ACTIVITY_CHARS);
}

async function readGitContext(includeFullDiff = false) {
    const commands = [
        ['status', ['--no-pager', 'status', '--short']],
        ['diffStat', ['--no-pager', 'diff', '--stat']]
    ];
    if (includeFullDiff) {
        commands.push(['diff', ['--no-pager', 'diff']]);
    }
    const results = {};

    for (const [key, args] of commands) {
        try {
            const { stdout, stderr } = await execFileAsync('git', args, {
                cwd: process.cwd(),
                maxBuffer: 1024 * 1024 * 4
            });
            results[key] = truncate(stdout || stderr || '');
        } catch (error) {
            results[key] = '';
        }
    }

    return results;
}

function buildReviewPrompt(args, gitContext, localActivity) {
    const summary = args.summary || args.description || args.workCompleted || 'No summary provided.';
    const changedFiles = args.changedFiles || args.filesChanged || args.files || [];
    const concerns = args.concerns || args.focus || '';
    const extraContextReason = args.extraContextReason || args.reasonForExtraContext || '';

    return `You are BananaSplit Review/Fix, a senior cloud coding model checking work produced by a cheaper local coding model.

Review for real bugs first: correctness, runtime errors, missing edge cases, unsafe behavior, broken tests, data loss, and security issues. Avoid style-only nitpicks unless they hide a bug.

Primary review scope:
- Review what the local model did in this turn: its responses, tool calls, tool arguments, and tool results.
- Do NOT review the whole project by default.
- Use the git status/diff summary only to orient yourself around the local model's changes.
- Only use broader context tools when there is a concrete reason listed below or the local activity log is genuinely insufficient to judge a likely bug. If you inspect broader context, explain why it mattered.
- If you find real bugs or regressions, fix them directly with the available file-editing tools.
- Keep fixes minimal and limited to the local model's changes unless broader context proves a related fix is required.
- If no real bug is found, do not edit files.

Return concise markdown in this exact structure:

## Critical
- Finding and whether you fixed it, or "None found."

## Warnings
- Finding and whether you fixed it, or "None found."

## Suggestions
- Finding, or "None found."

## Fixes Applied
- Files changed and what you fixed. If nothing needed fixing, say "No fix needed."

## Remaining Guidance
- Any follow-up the local model should do next. If nothing remains, say "None."

Local model summary:
${summary}

Changed files reported by local model:
${Array.isArray(changedFiles) ? changedFiles.join('\n') || 'Not provided.' : changedFiles}

Review focus from local model:
${concerns || 'Not provided.'}

Extra context reason:
${extraContextReason || 'Not requested. Keep the review focused on the local activity log.'}

Local model activity log:
${localActivity}

Git status:
${gitContext.status || 'No git status available.'}

Git diff stat:
${gitContext.diffStat || 'No git diff stat available.'}

${extraContextReason ? `Extra git diff context, included because the local model gave a reason:\n${gitContext.diff || 'No git diff available.'}` : 'Full git diff was not included because no extra context reason was provided.'}`;
}

export async function bananasplitReview(args, config) {
    if (!config?.bananaSplit?.enabled) {
        return 'BananaSplit is not enabled. Run /bananasplit first.';
    }

    const reviewerConfig = getBananaSplitReviewerConfig(config);
    if (!reviewerConfig) {
        return 'BananaSplit reviewer is not configured. Run /bananasplit setup.';
    }

    if (typeof global.createProvider !== 'function') {
        return 'BananaSplit review cannot run because provider creation is unavailable.';
    }

    const normalizedArgs = normalizeArgs(args);
    const includeFullDiff = !!(normalizedArgs.extraContextReason || normalizedArgs.reasonForExtraContext || normalizedArgs.includeFullDiff);
    const gitContext = await readGitContext(includeFullDiff);
    const localActivity = extractRecentLocalActivity();
    const prompt = buildReviewPrompt(normalizedArgs, gitContext, localActivity);

    try {
        const reviewerProvider = global.createProvider(reviewerConfig);
        const messageCountBeforeReview = Array.isArray(reviewerProvider.messages) ? reviewerProvider.messages.length : 0;
        let response = await reviewerProvider.sendMessage(prompt);

        if (isEmptyResponse(response) && hasToolActivitySince(reviewerProvider, messageCountBeforeReview)) {
            response = await reviewerProvider.sendMessage(EMPTY_REVIEWER_RESPONSE_CONTINUATION);
        }

        if (isEmptyResponse(response)) {
            return 'BananaSplit reviewer returned an empty response. No cloud fixes were applied.';
        }

        return response;
    } catch (error) {
        return `BananaSplit review failed: ${error.message}`;
    }
}
