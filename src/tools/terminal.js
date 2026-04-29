// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { spawn } from 'child_process';
import { requestPermission } from '../permissions.js';
import chalk from 'chalk';
import crypto from 'crypto';

// Global registry for active terminal sessions
const terminalSessions = new Map();

/**
 * Utility: Wait for output to settle (no new data for a short period).
 */
async function waitForSettle(session, timeoutMs = 3000, settleMs = 300) {
    const startIdx = session.output.length;
    let lastLength = session.output.length;
    let elapsed = 0;
    const interval = 100;

    while (elapsed < timeoutMs) {
        await new Promise(r => setTimeout(r, interval));
        elapsed += interval;

        // If process closed, return immediately
        if (session.isClosed) return;

        // If we got new data, wait a bit longer to see if more is coming (settle)
        if (session.output.length > lastLength) {
            lastLength = session.output.length;
            let settleElapsed = 0;
            while (settleElapsed < settleMs) {
                await new Promise(r => setTimeout(r, 50));
                if (session.output.length > lastLength) {
                    lastLength = session.output.length;
                    settleElapsed = 0; // Reset settle timer if data keeps coming
                } else {
                    settleElapsed += 50;
                }
            }
            return; // Data has settled
        }
    }
}

/**
 * Cleanup function to be called on app exit.
 */
export function cleanupTerminalSessions() {
    for (const [id, session] of terminalSessions.entries()) {
        if (!session.isClosed) {
            try {
                session.child.kill();
            } catch (e) {}
        }
        terminalSessions.delete(id);
    }
}

/**
 * Executes a command in a persistent terminal session.
 */
export async function executeCommandInTerminal({ command, cwd = process.cwd() }) {
    const perm = await requestPermission('Execute Interactive Command', command);
    if (!perm.allowed) {
        return `User denied permission to execute: ${command}`;
    }

    const sessionId = crypto.randomUUID();
    const child = spawn(command, { shell: true, cwd, stdio: 'pipe' });

    const session = {
        child,
        command,
        output: '',
        isClosed: false,
        exitCode: null,
        lastReadIndex: 0,
        pollCount: 0 // Safety counter for AI polling
    };

    terminalSessions.set(sessionId, session);

    child.stdout.on('data', (data) => {
        const str = data.toString();
        session.output += str;
        process.stdout.write(chalk.yellow(str));
    });

    child.stderr.on('data', (data) => {
        const str = data.toString();
        session.output += str;
        process.stderr.write(chalk.red(str));
    });

    child.on('close', (code) => {
        session.isClosed = true;
        session.exitCode = code;
    });

    child.on('error', (err) => {
        session.isClosed = true;
        session.error = err.message;
    });

    // Wait for initial output to settle
    await waitForSettle(session, 4000);

    if (session.isClosed) {
        const finalOutput = session.output;
        const code = session.exitCode;
        terminalSessions.delete(sessionId);
        return `Command finished immediately.\nExit Code: ${code}\nOutput:\n${finalOutput}`;
    }

    const currentOutput = session.output;
    session.lastReadIndex = currentOutput.length;

    return `Terminal session started (Session ID: ${sessionId}).\n` +
           `The process is still running and may be waiting for input.\n` +
           `Current Output:\n${currentOutput}`;
}

/**
 * Sends input to an active terminal session.
 */
export async function sendToTerminal({ sessionId, input }) {
    const session = terminalSessions.get(sessionId);
    if (!session) {
        return `Error: No active terminal session found with ID ${sessionId}.`;
    }

    if (session.isClosed) {
        const output = session.output;
        const code = session.exitCode;
        terminalSessions.delete(sessionId);
        return `Terminal session ${sessionId} has already closed.\nExit Code: ${code}\nOutput:\n${output}`;
    }

    // Safety check for empty polling
    if (!input || input === "") {
        session.pollCount = (session.pollCount || 0) + 1;
        if (session.pollCount > 5) {
            return `Error: Maximum polling attempts reached (5). The process seems stuck or is not producing output. Please consider terminating it if you cannot proceed.`;
        }
    } else {
        session.pollCount = 0; // Reset on real input
    }

    // Resolve common escape sequences if the AI sent them as literal characters
    const resolvedInput = input ? input.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : "";
    
    // Write input to stdin (if provided)
    if (resolvedInput) {
        session.child.stdin.write(resolvedInput);
    }

    // Wait for response to settle
    await waitForSettle(session, 3000);

    const newOutput = session.output.substring(session.lastReadIndex);
    session.lastReadIndex = session.output.length;

    if (session.isClosed) {
        const code = session.exitCode;
        terminalSessions.delete(sessionId);
        return `Terminal session ${sessionId} closed.\nExit Code: ${code}\nFinal Output:\n${newOutput}`;
    }

    return `Interaction sent to session ${sessionId}.\n` +
           `The process is STILL RUNNING.\n` +
           `New Output:\n${newOutput || '(Still waiting for response...)'}`;
}

/**
 * Terminates an active terminal session.
 */
export async function terminateTerminalSession({ sessionId }) {
    const session = terminalSessions.get(sessionId);
    if (!session) {
        return `Error: No active terminal session found with ID ${sessionId}.`;
    }

    if (!session.isClosed) {
        session.child.kill();
    }

    terminalSessions.delete(sessionId);
    return `Terminal session ${sessionId} has been terminated.`;
}
