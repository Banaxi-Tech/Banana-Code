// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import crypto from 'crypto';

const sessionPermissions = new Set();

export function setYoloMode(enabled) {
    global.bananaYoloMode = !!enabled;
}

function wrapText(text, width) {
    const lines = [];
    for (let i = 0; i < text.length; i += width) {
        lines.push(text.substring(i, i + width));
    }
    return lines;
}

async function promptPermissionChoice(actionType, details, signal = undefined) {
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

    const permKey = `allow_session_${actionType}`;

    if (sessionPermissions.has(permKey)) {
        return { allowed: true };
    }

    // Banana Guard AI Auto-Approve
    const config = global.bananaConfig;
    const createProvider = global.createProvider;
    
    if (config && config.useBananaGuard !== false) {
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
                sessionPermissions.add(permKey);
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
            sessionPermissions.add(permKey);
            return { allowed: true };
        }

        return { allowed: false };
    }

    const choice = await promptPermissionChoice(actionType, details);

    if (choice === 'once') return { allowed: true };
    if (choice === 'session') {
        sessionPermissions.add(permKey);
        return { allowed: true };
    }

    return { allowed: false };
}

export function getSessionPermissions() {
    return Array.from(sessionPermissions);
}
