// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

function requireBrowserController(config = {}) {
    if (!config.browserController || typeof config.browserController.request !== 'function') {
        throw new Error('Browser Use is only available from Banana Code Studio.');
    }
    return config.browserController;
}

function formatBrowserResult(result = {}) {
    if (!result || typeof result !== 'object') return result;

    const safe = { ...result };
    if (safe.screenshot?.base64) {
        const browserScreenshot = safe.screenshot;
        safe.screenshot = {
            ...safe.screenshot,
            base64: `[base64 screenshot omitted from text tool result: ${safe.screenshot.base64.length} chars]`
        };
        Object.defineProperty(safe, '__browserScreenshot', {
            value: browserScreenshot,
            enumerable: false
        });
    }
    return safe;
}

async function browserAction(action, args, config) {
    const controller = requireBrowserController(config);
    const result = await controller.request(action, args || {});
    return formatBrowserResult(result);
}

export async function browserOpen(args, config) {
    return await browserAction('open', args, config);
}

export async function browserSnapshot(args, config) {
    return await browserAction('snapshot', args, config);
}

export async function browserClick(args, config) {
    return await browserAction('click', args, config);
}

export async function browserType(args, config) {
    return await browserAction('type', args, config);
}

export async function browserPress(args, config) {
    return await browserAction('press', args, config);
}

export async function browserScroll(args, config) {
    return await browserAction('scroll', args, config);
}

export async function browserBack(args, config) {
    return await browserAction('back', args, config);
}

export async function browserForward(args, config) {
    return await browserAction('forward', args, config);
}

export async function browserReload(args, config) {
    return await browserAction('reload', args, config);
}

export async function browserClose(args, config) {
    return await browserAction('close', args, config);
}
