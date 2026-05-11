// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { io } from 'socket.io-client';
import chalk from 'chalk';
import fetch from 'node-fetch';
import crypto from 'crypto';

let socket;
let isConnected = false;
let pendingRequests = new Map();
let currentTurnId = null;
let sentTextThisResponse = '';
let remoteHandlers = {};
let remoteCapabilitiesProvider = null;

const REMOTE_API_URL = process.env.REMOTE_API_URL || 'https://bananacode.sh';
export const REMOTE_IMAGE_LIMITS = Object.freeze({
    maxImages: 4,
    maxImageBytes: 2 * 1024 * 1024,
    maxTotalImageBytes: 8 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
});

export function finalizeTurn() {
    if (socket && currentTurnId) {
        const data = { turnId: currentTurnId };
        socket.emit('turn_end', data);
    }
    currentTurnId = null;
}

export function resetRemoteAiResponseTracking() {
    sentTextThisResponse = '';
}

export function sendRemoteAiMessage(text) {
    if (!socket || !isConnected || typeof text !== 'string' || text.trim().length === 0) {
        return;
    }

    let textToSend = text;
    if (sentTextThisResponse && text.startsWith(sentTextThisResponse)) {
        textToSend = text.slice(sentTextThisResponse.length);
    }

    if (textToSend.trim().length === 0) {
        return;
    }

    if (!currentTurnId) {
        currentTurnId = crypto.randomUUID();
    }

    const msgData = { text: textToSend, turnId: currentTurnId, final: true };
    socket.emit('ai_message', msgData);
}

export function sendRemoteAiSegment(text) {
    if (!socket || !isConnected || typeof text !== 'string' || text.trim().length === 0) {
        return;
    }

    if (!currentTurnId) {
        currentTurnId = crypto.randomUUID();
    }

    const msgData = { text, turnId: currentTurnId, final: true };
    socket.emit('ai_message', msgData);
    sentTextThisResponse += text;
    finalizeTurn();
}

export function sendRemoteToolEvent({ id = crypto.randomUUID(), actionType, details, status = 'completed' }) {
    if (!socket || !isConnected || !actionType) {
        return;
    }

    const eventData = {
        id,
        actionType,
        details: details || '',
        status,
        timestamp: Date.now()
    };
    socket.emit('tool_event', eventData);
}

export function sendRemoteImageGenEvent(type, payload = {}) {
    if (!socket || !isConnected || !type) {
        return;
    }

    if (!currentTurnId) {
        currentTurnId = crypto.randomUUID();
    }

    socket.emit('imagegen_event', {
        type,
        payload,
        turnId: currentTurnId,
        timestamp: Date.now()
    });
}

export function publishRemoteCapabilities(capabilities = null) {
    if (!socket || !isConnected) return;

    const payload = capabilities || (typeof remoteCapabilitiesProvider === 'function'
        ? remoteCapabilitiesProvider()
        : null);
    if (!payload) return;

    socket.emit('remote_capabilities', {
        imageAttachments: payload.imageAttachments === true,
        provider: payload.provider || '',
        model: payload.model || '',
        maxImages: payload.maxImages || REMOTE_IMAGE_LIMITS.maxImages,
        maxImageBytes: payload.maxImageBytes || REMOTE_IMAGE_LIMITS.maxImageBytes
    });
}

export function sendRemoteUserMessageStatus(id, status, error = null) {
    if (!socket || !isConnected || !id || !status) return;
    socket.emit('user_message_status', { id, status, error });
}

export function sendRemoteUserMessageError(id, error) {
    if (!socket || !isConnected || !id || !error) return;
    socket.emit('user_message_error', { id, error });
}

export async function redeemRemotePairingCode(pairingCode) {
    const code = String(pairingCode || '').trim().toUpperCase();
    if (!code) {
        console.log(chalk.red('Pairing code cannot be empty.'));
        return null;
    }

    try {
        const res = await fetch(`${REMOTE_API_URL}/api/remote/pair/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            console.log(chalk.red(`Failed to redeem pairing code: ${data.error || res.statusText}`));
            return null;
        }

        return { uuid: data.uuid, token: data.token, deviceType: 'cli' };
    } catch (e) {
        console.log(chalk.red(`Error redeeming pairing code: ${e.message}`));
        return null;
    }
}

export async function connectRemoteTooling(credentials, handlers = {}) {
    if (socket) {
        socket.disconnect();
    }

    remoteHandlers = handlers || {};
    remoteCapabilitiesProvider = typeof remoteHandlers.getCapabilities === 'function'
        ? remoteHandlers.getCapabilities
        : null;

    const uuid = credentials?.uuid;
    const token = credentials?.token || credentials?.remoteDeviceToken;

    if (!uuid || !token) {
        console.log(chalk.red('Remote tooling now requires secure pairing. Run /remotetooling and enter a code from the phone app.'));
        return null;
    }

    socket = io(REMOTE_API_URL, { reconnection: true });

    socket.on('connect', () => {
        const joinData = { role: 'cli', token };
        socket.emit('join', joinData);
        isConnected = true;
    });

    socket.on('join_authorized', () => {
        publishRemoteCapabilities();
    });

    socket.on('cli_authorized', (data) => {
        console.log(chalk.green(`\n[Remote Tooling] Mobile App connected!`));
        publishRemoteCapabilities();
    });

    socket.on('remote_capabilities_request', () => {
        publishRemoteCapabilities();
    });

    socket.on('user_message', (data) => {
        if (typeof remoteHandlers.onUserMessage === 'function') {
            remoteHandlers.onUserMessage(data);
        } else if (data?.id) {
            sendRemoteUserMessageStatus(data.id, 'failed', 'This CLI cannot accept phone messages.');
        }
    });

    socket.on('tool_response', (data) => {
        const { id, approved } = data;
        if (pendingRequests.has(id)) {
            const resolve = pendingRequests.get(id);
            resolve({ allowed: approved, remember: false });
            pendingRequests.delete(id);
        }
    });

    socket.on('disconnect', () => { isConnected = false; });
    socket.on('error', (err) => { console.log(chalk.red(`\n[Remote Tooling] Error: ${err}`)); });

    global.apiPermissionHandler = async (ticketId, actionType, details) => {
        finalizeTurn();
        if (!isConnected) return { allowed: false };

        return new Promise((resolve) => {
            console.log(chalk.yellow(`\n[Remote Tooling] Waiting for Mobile App approval...`));
            pendingRequests.set(ticketId, resolve);
            const reqData = { id: ticketId, actionType, details };
            socket.emit('tool_request', reqData);
        });
    };

    global.apiPermissionCancelHandler = (ticketId) => {
        if (!isConnected || !ticketId) return;

        pendingRequests.delete(ticketId);
        const data = { id: ticketId };
        socket.emit('tool_cancel', data);
    };

    return { socket, uuid, token, deviceType: 'cli' };
}

export function disconnectRemoteTooling() {
    finalizeTurn();

    for (const resolve of pendingRequests.values()) {
        resolve({ allowed: false, remember: false });
    }
    pendingRequests.clear();

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    remoteHandlers = {};
    remoteCapabilitiesProvider = null;
    isConnected = false;
    delete global.apiPermissionHandler;
    delete global.apiPermissionCancelHandler;
}

export function isRemoteConnected() { return isConnected; }
