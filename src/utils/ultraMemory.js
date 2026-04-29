// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { addMemory, loadMemory } from './memory.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Processes a session to extract memories from messages.
 * Uses a subprocess to avoid terminal interference.
 */
export async function processUltraMemory(session, config, providerFactory) {
    if (!config.useUltraMemory) return;

    const currentMemories = await loadMemory();
    const startIndex = session.ultraMemoryProcessedIndex || 0;
    const messages = session.messages || [];
    
    if (messages.length <= startIndex) return;

    // Filter messages: keep only user and assistant text
    const filteredMessages = messages.slice(startIndex).filter(m => {
        if (m.role === 'system') return false;
        if (config.provider === 'gemini') {
            return m.parts && m.parts.some(p => p.text);
        } else if (config.provider === 'claude') {
             return typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some(c => c.type === 'text'));
        } else {
            return (m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0) || 
                   ((m.role === 'assistant' || m.role === 'output_text') && typeof m.content === 'string' && m.content.trim().length > 0);
        }
    });

    if (filteredMessages.length < 2) {
        if (messages.length > startIndex + 10) { 
             session.ultraMemoryProcessedIndex = messages.length;
        }
        return;
    }

    let conversationText = "";
    filteredMessages.forEach(m => {
        let text = "";
        if (config.provider === 'gemini') {
            text = m.parts.filter(p => p.text).map(p => p.text).join("\n");
        } else if (config.provider === 'claude') {
             if (typeof m.content === 'string') text = m.content;
             else text = m.content.filter(c => c.type === 'text').map(c => c.text).join("\n");
        } else {
            text = m.content;
        }
        const role = m.role === 'user' ? 'User' : 'Assistant';
        conversationText += `${role}: ${text}\n`;
    });

    // We run the extraction in a separate process to avoid ANY terminal mangling
    return new Promise((resolve) => {
        const workerPath = path.join(__dirname, 'ultraMemoryWorker.js');
        const payload = JSON.stringify({
            config,
            currentMemories,
            conversationText
        });

        // Use 'ignore' for stderr so no logs bleed out
        const child = spawn(process.execPath, [workerPath], {
            stdio: ['pipe', 'pipe', 'ignore']
        });

        let output = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.on('close', async (code) => {
            if (code === 0 && output.trim() && output.trim() !== "NONE") {
                const lines = output.split('\n')
                    .map(l => l.replace(/^[-*•]\s*/, '').trim())
                    .filter(l => l.length > 5)
                    .filter(l => !l.toLowerCase().includes('thinking...'))
                    .filter(l => !l.toLowerCase().includes('processing...'));

                const existingFacts = currentMemories.map(m => m.fact.toLowerCase());

                for (const line of lines) {
                    if (!existingFacts.includes(line.toLowerCase())) {
                        await addMemory(line);
                    }
                }
            }
            session.ultraMemoryProcessedIndex = messages.length;
            session.lastUltraMemoryRun = new Date().toISOString();
            resolve();
        });

        child.stdin.write(payload);
        child.stdin.end();
    });
}

/**
 * Periodically scans all eligible sessions in the background.
 */
let isRunning = false;
export async function runUltraMemoryBackground(config, providerFactory) {
    if (!config.useUltraMemory || isRunning) return;
    isRunning = true;

    try {
        const { listSessions, loadSession, saveSession } = await import('../sessions.js');
        const sessions = await listSessions();

        const now = new Date();

        for (const sessionSummary of sessions) {
            if (!config.ultraMemoryEnabledAt || new Date(sessionSummary.updatedAt) < new Date(config.ultraMemoryEnabledAt)) {
                continue;
            }

            const lastUpdate = new Date(sessionSummary.updatedAt);
            const minutesSinceUpdate = (now - lastUpdate) / 1000 / 60;
            if (minutesSinceUpdate < 5) continue;

            const session = await loadSession(sessionSummary.uuid);
            if (session) {
                if (session.lastUltraMemoryRun) {
                    const lastRun = new Date(session.lastUltraMemoryRun);
                    const minutesSinceRun = (now - lastRun) / 1000 / 60;
                    if (minutesSinceRun < 15) continue;
                }

                const oldIndex = session.ultraMemoryProcessedIndex || 0;
                await processUltraMemory(session, config, providerFactory);
                
                if (session.ultraMemoryProcessedIndex !== oldIndex) {
                    await saveSession(session.uuid, session);
                }
            }
        }
    } catch (e) {
    } finally {
        isRunning = false;
    }
}
