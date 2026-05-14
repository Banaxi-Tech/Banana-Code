// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import crypto from 'crypto';
import { getNewUiFilePermissionInfo, isNewUiFilePermission } from './utils/newUiFileDiff.js';
import { getTermWidth, isNewUiEnabled, padLine, truncatePlain } from './utils/newUi.js';

const sessionPermissions = new Set();
const GOALS_COMMAND_ACTIONS = new Set([
    'Execute Command',
    'Execute Interactive Command'
]);
const GOALS_AUTO_ACTIONS = new Set([
    'Read File',
    'Write File',
    'Patch File',
    'Rename File',
    'List Directory',
    'Search in',
    'Fetch URL'
]);
const SENSITIVE_REMOTE_ACTIONS = new Set([
    'GitHub API Request',
    'GitHub Comment',
    'GitHub PR Review',
    'GitHub Merge Pull Request'
]);

export function setYoloMode(enabled) {
    global.bananaYoloMode = !!enabled;
}

export function setGoalsPermissionMode(mode = null) {
    const normalized = mode === 'edits' || mode === 'all' ? mode : null;
    global.goalsPermissionMode = normalized;
}

export function setAutoAcceptEditsMode(enabled) {
    global.bananaAutoAcceptEditsMode = !!enabled;
}

function enableAutoAcceptEditsMode() {
    global.bananaAutoAcceptEditsMode = true;
    if (global.bananaConfig) {
        global.bananaConfig.autoAcceptEditsMode = true;
    }
    if (global.activeProviderInstance?.config) {
        global.activeProviderInstance.config.autoAcceptEditsMode = true;
    }
}

function rememberSessionPermission(actionType, permKey) {
    sessionPermissions.add(permKey);
    if (actionType === 'Patch File' && isNewUiFilePermission(actionType)) {
        enableAutoAcceptEditsMode();
    }
}

function wrapText(text, width) {
    const lines = [];
    for (let i = 0; i < text.length; i += width) {
        lines.push(text.substring(i, i + width));
    }
    return lines;
}

function firstDetailLine(details) {
    return String(details || '').split('\n').find(line => line.trim())?.trim() || '';
}

function formatDetails(details, { skipFirst = false, maxLines = 6 } = {}) {
    const width = Math.max(20, getTermWidth() - 2);
    const rawLines = String(details || '').split('\n');
    const lines = (skipFirst ? rawLines.slice(1) : rawLines)
        .map(line => line.trimEnd())
        .filter(line => line.trim())
        .slice(0, maxLines)
        .map(line => ` ${truncatePlain(line, width)}`);

    if (String(details || '').split('\n').filter(line => line.trim()).length > maxLines + (skipFirst ? 1 : 0)) {
        lines.push(chalk.gray(' ...'));
    }
    return lines;
}

function splitArrow(details) {
    const [source, destination] = String(details || '').split('→').map(part => part.trim());
    return { source, destination };
}

function getNewUiPermissionCopy(actionType, details) {
    const target = firstDetailLine(details);

    if (actionType === 'Write File' || actionType === 'Patch File') {
        const fileInfo = getNewUiFilePermissionInfo(actionType, details);
        return {
            title: fileInfo.operation,
            target: fileInfo.filepath,
            question: fileInfo.question,
            once: 'Yes',
            session: actionType === 'Patch File'
                ? 'Yes, allow all edits during this session (shift+tab)'
                : 'Yes, allow for this session',
            disallow: 'No',
            showSummary: false
        };
    }

    if (actionType === 'Read File') {
        return {
            title: 'Read file',
            target,
            question: `Do you want to read ${target}?`,
            once: 'Yes, read this file',
            session: 'Yes, allow file reads this session',
            disallow: 'No, do not read it'
        };
    }
    if (actionType === 'List Directory') {
        return {
            title: 'List directory',
            target,
            question: `Do you want to list ${target}?`,
            once: 'Yes, list this directory',
            session: 'Yes, allow directory listing this session',
            disallow: 'No, do not list it'
        };
    }
    if (actionType === 'Search in') {
        return {
            title: 'Search files',
            target,
            question: 'Do you want to search these files?',
            once: 'Yes, search files',
            session: 'Yes, allow file searches this session',
            disallow: 'No, do not search'
        };
    }
    if (actionType === 'Fetch URL') {
        return {
            title: 'Fetch URL',
            target,
            question: `Do you want to fetch ${target}?`,
            once: 'Yes, fetch this URL',
            session: 'Yes, allow URL fetches this session',
            disallow: 'No, do not fetch it'
        };
    }
    if (actionType === 'Execute Command') {
        return {
            title: 'Run command',
            target,
            question: 'Do you want to run this command?',
            once: 'Yes, run this command',
            session: 'Yes, allow shell commands this session',
            disallow: 'No, do not run it'
        };
    }
    if (actionType === 'Execute Interactive Command') {
        return {
            title: 'Start terminal session',
            target,
            question: 'Do you want to start this interactive command?',
            once: 'Yes, start terminal session',
            session: 'Yes, allow terminal commands this session',
            disallow: 'No, do not start it'
        };
    }
    if (actionType === 'Rename File') {
        const { source, destination } = splitArrow(details);
        return {
            title: 'Rename file',
            target: source && destination ? `${source} -> ${destination}` : target,
            question: source && destination
                ? `Do you want to rename ${source} to ${destination}?`
                : 'Do you want to rename this file?',
            once: 'Yes, rename it',
            session: 'Yes, allow file renames this session',
            disallow: 'No, do not rename it'
        };
    }
    if (actionType === 'Delegate Task') {
        return {
            title: 'Delegate task',
            target,
            question: 'Do you want to start this sub-agent task?',
            once: 'Yes, delegate this task',
            session: 'Yes, allow delegations this session',
            disallow: 'No, keep it here'
        };
    }
    if (actionType === 'Generate Image') {
        return {
            title: 'Generate image',
            target,
            question: 'Do you want to generate this image?',
            once: 'Yes, generate image',
            session: 'Yes, allow image generation this session',
            disallow: 'No, do not generate it',
            detailLines: formatDetails(details, { maxLines: 5 })
        };
    }
    if (actionType === 'GitHub API Request') {
        return {
            title: 'GitHub API request',
            target,
            question: 'Do you want to send this GitHub API request?',
            once: 'Yes, send request',
            session: 'Yes, allow GitHub API requests this session',
            disallow: 'No, do not send it',
            detailLines: formatDetails(details, { skipFirst: true, maxLines: 5 })
        };
    }
    if (actionType === 'GitHub Comment') {
        return {
            title: 'Post GitHub comment',
            target,
            question: 'Do you want to post this GitHub comment?',
            once: 'Yes, post comment',
            session: 'Yes, allow GitHub comments this session',
            disallow: 'No, do not post it',
            detailLines: formatDetails(details, { skipFirst: true, maxLines: 5 })
        };
    }
    if (actionType === 'GitHub PR Review') {
        return {
            title: 'Submit GitHub PR review',
            target,
            question: 'Do you want to submit this PR review?',
            once: 'Yes, submit review',
            session: 'Yes, allow PR reviews this session',
            disallow: 'No, do not submit it',
            detailLines: formatDetails(details, { skipFirst: true, maxLines: 6 })
        };
    }
    if (actionType === 'GitHub Merge Pull Request') {
        return {
            title: 'Merge GitHub pull request',
            target,
            question: 'Do you want to merge this pull request?',
            once: 'Yes, merge PR',
            session: 'Yes, allow PR merges this session',
            disallow: 'No, do not merge it',
            detailLines: formatDetails(details, { skipFirst: true, maxLines: 5 })
        };
    }

    return {
        title: actionType,
        target,
        question: `Do you want to allow ${actionType}?`,
        once: 'Yes, allow once',
        session: 'Yes, allow for this session',
        disallow: 'No, do not allow it',
        detailLines: formatDetails(details)
    };
}

function formatNewUiChoices(copy) {
    return [
        { name: `1. ${copy.once}`, value: 'once' },
        { name: `2. ${copy.session}`, value: 'session' },
        { name: `3. ${copy.disallow}`, value: 'disallow' }
    ];
}

function renderNewUiChoice(copy, choices, selectedIndex) {
    const width = getTermWidth();
    const lines = [];

    if (copy.showSummary !== false) {
        lines.push(chalk.gray('─'.repeat(width)));
        lines.push(` ${copy.title}`);
        if (copy.target) lines.push(` ${truncatePlain(copy.target, Math.max(20, width - 2))}`);
        const detailLines = copy.detailLines || [];
        if (detailLines.length > 0) lines.push(...detailLines);
        lines.push(chalk.gray('╌'.repeat(width)));
    }

    lines.push(
        ` ${copy.question}`,
        ...choices.map((choice, index) => `${index === selectedIndex ? ' ❯' : '  '} ${choice.name}`),
        '',
        ' Esc to cancel'
    );

    return lines.map(line => padLine(line, width));
}

async function promptNewUiPermissionChoice(actionType, details, signal = undefined) {
    const copy = getNewUiPermissionCopy(actionType, details);
    const choices = formatNewUiChoices(copy);

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return await select({
            message: copy.question,
            choices
        }, signal ? { signal } : undefined);
    }

    return await new Promise((resolve, reject) => {
        let selectedIndex = 0;
        let renderedRows = 0;
        let settled = false;
        let previousRawMode = false;

        const cleanup = () => {
            process.stdout.write('\x1b[?25h');
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(previousRawMode);
            }
            if (!previousRawMode) {
                process.stdin.pause();
            }
            process.stdin.removeListener('data', onData);
            if (signal) signal.removeEventListener('abort', onAbort);
        };

        const finish = (value) => {
            if (settled) return;
            settled = true;
            cleanup();
            process.stdout.write('\n');
            resolve(value);
        };

        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        const draw = () => {
            if (renderedRows > 0) {
                process.stdout.write(`\x1b[${renderedRows}A`);
            }
            process.stdout.write('\x1b[1G\x1b[J\x1b[?25l');
            const lines = renderNewUiChoice(copy, choices, selectedIndex);
            process.stdout.write(lines.join('\n') + '\n');
            renderedRows = lines.length;
        };

        function onAbort() {
            const err = new Error('Permission prompt aborted');
            err.name = 'AbortPromptError';
            fail(err);
        }

        function onData(key) {
            const str = key.toString();
            if (str === '\x03') {
                const err = new Error('Permission prompt cancelled');
                err.name = 'ExitPromptError';
                fail(err);
                return;
            }
            if (str === '\x1b' || str === '\x1b\x1b') {
                finish('disallow');
                return;
            }
            if (str === '\x1b[Z') {
                finish('session');
                return;
            }
            if (str === '\r' || str === '\n') {
                finish(choices[selectedIndex].value);
                return;
            }
            if (str === '\x1b[A') {
                selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
                draw();
                return;
            }
            if (str === '\x1b[B') {
                selectedIndex = (selectedIndex + 1) % choices.length;
                draw();
                return;
            }
            if (/^[1-3]$/.test(str)) {
                finish(choices[Number(str) - 1].value);
            }
        }

        previousRawMode = Boolean(process.stdin.isRaw);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        draw();
    });
}

async function promptPermissionChoice(actionType, details, signal = undefined) {
    if (isNewUiEnabled()) {
        return await promptNewUiPermissionChoice(actionType, details, signal);
    }

    const boxWidth = 41; // Internal width

    const actionLabel = ` Action: ${actionType}`;
    const actionLine = actionLabel.padEnd(boxWidth, ' ');

    const detailsLabel = ' Details: ';
    const detailRows = wrapText(details, boxWidth - detailsLabel.length);

    let detailsBlock = '';
    detailRows.forEach((row, i) => {
        const prefix = (i === 0) ? detailsLabel : ' '.repeat(detailsLabel.length);
        detailsBlock += `│ ${prefix}${row.padEnd(boxWidth - detailsLabel.length, ' ')} │\n`;
    });

    const boxTop = chalk.magenta(`┌─────────────────────────────────────────┐
│  🍌 BANANA CODE — Permission Request    │
├─────────────────────────────────────────┤
│ ${actionLine} │`);
    const boxBottom = chalk.magenta(`├─────────────────────────────────────────┤
│  [1] Allow Once                         │
│  [2] Allow for This Session             │
│  [3] Disallow (suggest changes)         │
└─────────────────────────────────────────┘`);

    console.log(boxTop);
    console.log(chalk.magenta(detailsBlock.trimEnd()));
    console.log(boxBottom);

    const choices = [
        { name: 'Allow Once', value: 'once' },
        { name: 'Allow for This Session', value: 'session' },
        { name: 'Disallow (suggest changes)', value: 'disallow' }
    ];

    return await select({
        message: chalk.magenta('Select an option:'),
        choices
    }, signal ? { signal } : undefined);
}

export async function requestPermission(actionType, details) {
    if (global.bananaYoloMode || process.argv.includes('--yolo')) {
        return { allowed: true };
    }

    const goalsMode = global.goalsPermissionMode;
    const autoAcceptEditsMode = global.bananaAutoAcceptEditsMode === true;
    const isGoalsCommand = GOALS_COMMAND_ACTIONS.has(actionType);
    const isSensitiveRemoteAction = SENSITIVE_REMOTE_ACTIONS.has(actionType);
    if (!isSensitiveRemoteAction && goalsMode === 'all') {
        console.log(chalk.green(`🎯 [Goals] Auto-approved: ${chalk.gray(actionType)}`));
        return { allowed: true };
    }
    if (!isSensitiveRemoteAction && goalsMode === 'edits' && GOALS_AUTO_ACTIONS.has(actionType)) {
        console.log(chalk.green(`🎯 [Goals] Auto-approved: ${chalk.gray(actionType)}`));
        return { allowed: true };
    }
    if (!isSensitiveRemoteAction && autoAcceptEditsMode && GOALS_AUTO_ACTIONS.has(actionType)) {
        console.log(chalk.yellow(`⏵⏵ [Auto Accept Edits] Approved: ${chalk.gray(actionType)}`));
        return { allowed: true };
    }

    const permKey = `allow_session_${actionType}`;

    if (sessionPermissions.has(permKey)) {
        return { allowed: true };
    }

    // Banana Guard AI Auto-Approve
    const config = global.bananaConfig;
    const createProvider = global.createProvider;
    
    if (config && config.useBananaGuard !== false && !isSensitiveRemoteAction && !((goalsMode === 'edits' || autoAcceptEditsMode) && isGoalsCommand)) {
        // Only commands and URLs get AI scrutiny
        if (actionType === 'Execute Command' || actionType === 'Execute Interactive Command' || actionType === 'Fetch URL') {
            if (createProvider) {
                const { runBananaGuard } = await import('./utils/guard.js');
                const guardResult = await runBananaGuard(actionType, details, config, createProvider);
                
                if (guardResult.allowed) {
                    const actionLabel = actionType === 'Fetch URL' ? 'URL' : 'command';
                    console.log(chalk.green(`🛡️  [Banana Guard] Auto-approved ${actionLabel}: ${chalk.gray(details.substring(0, 50))}${details.length > 50 ? '...' : ''}`) + chalk.dim(` — ${guardResult.reason}`));

                    // Report costs back to the main session if supported
                    if (guardResult.usage && global.activeProviderInstance && typeof global.activeProviderInstance.addUsage === 'function') {
                        global.activeProviderInstance.addUsage(guardResult.usage, guardResult.model);
                    }

                    return { allowed: true };
                }
            }
        } else {
            // Auto-approve everything else (write_file, patch_file, etc.)
            console.log(chalk.green(`🛡️  [Banana Guard] Auto-approved action: ${chalk.gray(actionType)}`));
            return { allowed: true };
        }
    }

    if (typeof global.apiPermissionHandler === 'function') {
        const ticketId = crypto.randomUUID();
        const controller = new AbortController();
        const remoteApproval = global.apiPermissionHandler(ticketId, actionType, details);

        const winner = await Promise.race([
            remoteApproval.then(result => {
                controller.abort();
                return { source: 'remote', result };
            }),
            promptPermissionChoice(actionType, details, controller.signal)
                .then(choice => ({ source: 'local', choice }))
                .catch(err => {
                    if (err?.name === 'AbortPromptError' || err?.name === 'ExitPromptError') {
                        return new Promise(() => {});
                    }
                    throw err;
                })
        ]);

        if (winner.source === 'remote') {
            if (winner.result.remember) {
                rememberSessionPermission(actionType, permKey);
            }
            console.log(winner.result.allowed
                ? chalk.green('Remote approved. Continuing as Allow Once.')
                : chalk.red('Remote denied. Tool call cancelled.'));
            return { allowed: winner.result.allowed };
        }

        if (typeof global.apiPermissionCancelHandler === 'function') {
            global.apiPermissionCancelHandler(ticketId);
        }

        const choice = winner.choice;

        if (choice === 'once') return { allowed: true };
        if (choice === 'session') {
            rememberSessionPermission(actionType, permKey);
            return { allowed: true };
        }

        return { allowed: false };
    }

    const choice = await promptPermissionChoice(actionType, details);

    if (choice === 'once') return { allowed: true };
    if (choice === 'session') {
        rememberSessionPermission(actionType, permKey);
        return { allowed: true };
    }

    return { allowed: false };
}

export function getSessionPermissions() {
    return Array.from(sessionPermissions);
}
