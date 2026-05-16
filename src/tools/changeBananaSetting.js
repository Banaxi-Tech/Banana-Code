// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { saveConfig } from '../config.js';
import { requestPermission } from '../permissions.js';
import { sendRemoteToolEvent } from '../remote.js';

const SETTING_DEFINITIONS = {
    duck_duck_go: {
        label: 'DuckDuckGo Quick Answer',
        type: 'betaTool',
        betaTool: 'duck_duck_go',
        effect: 'Adds the duck_duck_go quick-answer web search tool to Banana Code.'
    },
    duck_duck_go_scrape: {
        label: 'DuckDuckGo Scrape (Lite)',
        type: 'betaTool',
        betaTool: 'duck_duck_go_scrape',
        effect: 'Adds the duck_duck_go_scrape web search tool to Banana Code.',
        warning: 'This scrapes DuckDuckGo Lite. It is not an official API, may violate DuckDuckGo terms, and may be rate limited or blocked.'
    },
    usePuppeteerFetch: {
        label: 'Puppeteer fetch_url rendering',
        type: 'boolean',
        key: 'usePuppeteerFetch',
        effect: 'Allows fetch_url to render JavaScript pages with Puppeteer. Puppeteer may install Chromium into the Banana Code config directory on first use.'
    },
    usePatchFile: {
        label: 'Surgical File Patching',
        type: 'boolean',
        key: 'usePatchFile',
        effect: 'Controls whether the patch_file editing tool is available.'
    },
    useMemory: {
        label: 'Global AI Memory',
        type: 'boolean',
        key: 'useMemory',
        effect: 'Controls whether global memory tools are available for persistent saved facts.'
    },
    useBananaGuard: {
        label: 'Banana Guard',
        type: 'boolean',
        key: 'useBananaGuard',
        effect: 'Controls AI-assisted auto-approval for safe commands and other non-sensitive tool actions.'
    },
    autoFeedWorkspace: {
        label: 'Auto-feed workspace files',
        type: 'boolean',
        key: 'autoFeedWorkspace',
        effect: 'Controls whether workspace files are automatically added to model context.'
    }
};

function enabledText(enabled) {
    return enabled ? 'Enable' : 'Disable';
}

function getCurrentSettingValue(config, definition) {
    if (definition.type === 'betaTool') {
        return (config.betaTools || []).includes(definition.betaTool);
    }

    if (definition.key === 'usePatchFile' || definition.key === 'useMemory' || definition.key === 'useBananaGuard') {
        return config[definition.key] !== false;
    }

    return config[definition.key] === true;
}

function applySetting(config, definition, enabled) {
    if (definition.type === 'betaTool') {
        const betaTools = new Set(Array.isArray(config.betaTools) ? config.betaTools : []);
        if (enabled) {
            betaTools.add(definition.betaTool);
        } else {
            betaTools.delete(definition.betaTool);
        }
        return { betaTools: Array.from(betaTools) };
    }

    return { [definition.key]: enabled };
}

function formatPermissionDetails(setting, definition, enabled, reason) {
    return [
        `${definition.label} (${setting})`,
        'WARNING: This could change your Banana Code settings. Review carefully what the AI wants to do before approving.',
        `Requested change: ${enabledText(enabled)} ${definition.label}.`,
        `Effect: ${definition.effect}`,
        definition.warning ? `Additional warning: ${definition.warning}` : '',
        reason ? `AI reason: ${reason}` : ''
    ].filter(Boolean).join('\n');
}

export async function changeBananaSetting({ setting, enabled, reason = '' }, config = {}) {
    const definition = SETTING_DEFINITIONS[setting];
    if (!definition) {
        return `Unknown Banana Code setting: ${setting}. Allowed settings: ${Object.keys(SETTING_DEFINITIONS).join(', ')}`;
    }

    if (typeof enabled !== 'boolean') {
        return 'Invalid enabled value. Set enabled to true or false.';
    }

    const details = formatPermissionDetails(setting, definition, enabled, reason);
    const currentValue = getCurrentSettingValue(config, definition);
    const perm = await requestPermission('Change Banana Code Setting', details, {
        manualOnly: true,
        allowSession: false
    });

    if (!perm.allowed) {
        sendRemoteToolEvent({ actionType: 'Change Banana Code Setting', details, status: 'denied' });
        return `User denied permission to change Banana Code setting: ${definition.label}`;
    }

    if (currentValue === enabled) {
        return `${definition.label} is already ${enabled ? 'enabled' : 'disabled'}. No Banana Code setting was changed.`;
    }

    const updates = applySetting(config, definition, enabled);
    Object.assign(config, updates);

    if (typeof global.applyBananaConfigUpdate === 'function') {
        await global.applyBananaConfigUpdate(updates);
    } else {
        global.bananaConfig = config;
        if (global.activeProviderInstance?.config) {
            Object.assign(global.activeProviderInstance.config, updates);
        }
        await saveConfig(config);
    }

    sendRemoteToolEvent({ actionType: 'Change Banana Code Setting', details, status: 'completed' });
    return `${definition.label} ${enabled ? 'enabled' : 'disabled'}. Banana Code settings were updated.`;
}
