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

// Same secret as server
const API_SECRET = process.env.API_SECRET || 'banana_secret_key_2026';

function signData(data) {
    return crypto.createHmac('sha256', API_SECRET).update(JSON.stringify(data)).digest('hex');
}

export function finalizeTurn() {
    if (socket && currentTurnId) {
        const data = { turnId: currentTurnId };
        socket.emit('turn_end', { ...data, signature: signData(data) });
    }
    currentTurnId = null;
}

export function sendRemoteAiMessage(text) {
    if (!socket || !isConnected || typeof text !== 'string' || text.trim().length === 0) {
        return;
    }

    if (!currentTurnId) {
        currentTurnId = crypto.randomUUID();
    }

    const msgData = { text, turnId: currentTurnId, final: true };
    socket.emit('ai_message', { ...msgData, signature: signData(msgData) });
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
    socket.emit('tool_event', { ...eventData, signature: signData(eventData) });
}

export async function connectRemoteTooling(uuidOrCode) {
    if (socket) {
        socket.disconnect();
    }

    const apiUrl = process.env.REMOTE_API_URL || 'https://bananacode.sh';
    let uuid = uuidOrCode;

    if (uuidOrCode.length <= 8 && !uuidOrCode.includes('-')) {
        try {
            const res = await fetch(`${apiUrl}/api/remote/resolve/${uuidOrCode}`);
            if (res.ok) {
                const data = await res.json();
                uuid = data.uuid;
            } else {
                console.log(chalk.red(`Failed to resolve pairing code.`));
                return;
            }
        } catch (e) {
            console.log(chalk.red(`Error: ${e.message}`));
            return;
        }
    }

    socket = io(apiUrl, { reconnection: true });

    socket.on('connect', () => {
        const joinData = { role: 'cli', uuid };
        socket.emit('join', { ...joinData, signature: signData(joinData) });
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
            socket.emit('tool_request', { ...reqData, signature: signData(reqData) });
        });
    };

    global.apiPermissionCancelHandler = (ticketId) => {
        if (!isConnected || !ticketId) return;

        pendingRequests.delete(ticketId);
        const data = { id: ticketId };
        socket.emit('tool_cancel', { ...data, signature: signData(data) });
    };

    return { socket, uuid };
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
