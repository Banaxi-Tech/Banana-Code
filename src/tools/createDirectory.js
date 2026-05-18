// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';
import { sendRemoteToolEvent } from '../remote.js';

/**
 * Creates a directory at the specified path.
 *
 * @param {Object} args - The arguments for the tool.
 * @param {string} args.directoryPath - The path of the directory to create.
 * @returns {Promise<string>} A success message.
 */
export async function createDirectory(args) {
    const { directoryPath } = args;

    if (!directoryPath) {
        throw new Error('directoryPath is required');
    }

    const absPath = path.resolve(process.cwd(), directoryPath);
    const perm = await requestPermission('Create Directory', directoryPath);
    if (!perm.allowed) {
        sendRemoteToolEvent({ actionType: 'Create Directory', details: directoryPath, status: 'denied' });
        return `User denied permission to create directory: ${directoryPath}`;
    }

    try {
        await fs.mkdir(absPath, { recursive: true });
        sendRemoteToolEvent({ actionType: 'Create Directory', details: directoryPath, status: 'completed' });
        return `Successfully created directory: ${directoryPath}`;
    } catch (error) {
        sendRemoteToolEvent({ actionType: 'Create Directory', details: `${directoryPath}\n\nError: ${error.message}`, status: 'failed' });
        throw new Error(`Failed to create directory: ${error.message}`);
    }
}
