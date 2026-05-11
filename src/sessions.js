// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const CHATS_DIR = path.join(os.homedir(), '.config', 'banana-code', 'chats');

export async function ensureChatsDir() {
    try {
        await fs.mkdir(CHATS_DIR, { recursive: true });
    } catch (e) { }
}

export function generateSessionId() {
    return crypto.randomUUID();
}

export async function saveSession(uuid, data) {
    await ensureChatsDir();
    const filePath = path.join(CHATS_DIR, `${uuid}.json`);
    const sessionData = {
        ...data,
        uuid,
        title: data.title || null,
        updatedAt: new Date().toISOString(),
        provider: data.provider,
        model: data.model,
        messages: data.messages
    };
    await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), 'utf-8');
}

export async function loadSession(uuid) {
    const filePath = path.join(CHATS_DIR, `${uuid}.json`);
    if (!fsSync.existsSync(filePath)) return null;
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
}

export async function deleteSession(uuid) {
    if (typeof uuid !== 'string' || !uuid.trim() || uuid.includes('/') || uuid.includes('\\')) {
        throw new Error('Invalid session id');
    }

    const filePath = path.join(CHATS_DIR, `${uuid}.json`);
    try {
        await fs.unlink(filePath);
        return true;
    } catch (err) {
        if (err?.code === 'ENOENT') return false;
        throw err;
    }
}

export async function listSessions() {
    await ensureChatsDir();
    const files = await fs.readdir(CHATS_DIR);
    const sessions = [];
    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const data = await loadSession(file.replace('.json', ''));
                if (data) sessions.push(data);
            } catch (e) { }
        }
    }
    // Sort by updatedAt desc
    return sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getLatestSessionId() {
    const sessions = await listSessions();
    return sessions.length > 0 ? sessions[0].uuid : null;
}
