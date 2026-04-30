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

const REMOTE_API_URL = process.env.REMOTE_API_URL || 'https://bananacode.sh';

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

export async function connectRemoteTooling(credentials) {
    if (socket) {
        socket.disconnect();
    }

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

    socket.on('cli_authorized', (data) => {
        console.log(chalk.green(`\n[Remote Tooling] Mobile App connected!`));
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

    isConnected = false;
    delete global.apiPermissionHandler;
    delete global.apiPermissionCancelHandler;
}

export function isRemoteConnected() { return isConnected; }
