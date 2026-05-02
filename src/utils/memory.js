// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const MEMORY_DIR = path.join(os.homedir(), '.config', 'banana-code');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');

const PROJECT_MEMORY_DIR = path.join(process.cwd(), '.banana');
const PROJECT_MEMORY_FILE = path.join(PROJECT_MEMORY_DIR, 'project-memory.json');

export async function loadMemory() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return []; // Return empty array if file doesn't exist
        }
        throw error;
    }
}

export async function saveMemory(memories) {
    try {
        await fs.mkdir(MEMORY_DIR, { recursive: true });
        await fs.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf-8');
    } catch (error) {
        console.error("Failed to save memory:", error);
    }
}

export async function loadProjectMemory() {
    try {
        const data = await fs.readFile(PROJECT_MEMORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return []; // Return empty array if file doesn't exist
        }
        throw error;
    }
}

export async function saveProjectMemory(memories) {
    try {
        await fs.mkdir(PROJECT_MEMORY_DIR, { recursive: true });
        await fs.writeFile(PROJECT_MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf-8');
    } catch (error) {
        console.error("Failed to save project memory:", error);
    }
}

export async function addMemory(fact) {
    const memories = await loadMemory();
    const newMemory = {
        id: crypto.randomUUID().slice(0, 8),
        fact,
        createdAt: new Date().toISOString()
    };
    memories.push(newMemory);
    await saveMemory(memories);
    return newMemory.id;
}

export async function addProjectMemory(fact) {
    const memories = await loadProjectMemory();
    const newMemory = {
        id: crypto.randomUUID().slice(0, 8),
        fact,
        createdAt: new Date().toISOString()
    };
    memories.push(newMemory);
    await saveProjectMemory(memories);
    return newMemory.id;
}

export async function removeMemory(id) {
    const memories = await loadMemory();
    const initialLength = memories.length;
    const filtered = memories.filter(m => m.id !== id);
    
    if (filtered.length < initialLength) {
        await saveMemory(filtered);
        return true;
    }
    return false;
}

export async function removeProjectMemory(id) {
    const memories = await loadProjectMemory();
    const initialLength = memories.length;
    const filtered = memories.filter(m => m.id !== id);

    if (filtered.length < initialLength) {
        await saveProjectMemory(filtered);
        return true;
    }
    return false;
}
