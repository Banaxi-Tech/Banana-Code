// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';
import { sendRemoteToolEvent } from '../remote.js';
import * as diff from 'diff';
import chalk from 'chalk';
import { isNewUiEnabled, printNewUiFilePreview } from '../utils/newUiFileDiff.js';

export async function writeFile({ filepath, content }) {
    const absPath = path.resolve(process.cwd(), filepath);

    let oldContent = '';
    try {
        oldContent = await fs.readFile(absPath, 'utf8');
    } catch (err) { }

    const patch = diff.createPatch(filepath, oldContent, content);

    if (isNewUiEnabled()) {
        printNewUiFilePreview('Write File', filepath, patch);
    } else {
        process.stdout.write('\x1b[0m');
        console.log(chalk.cyan(`\nPreviewing changes for ${filepath}:`));
        patch.split('\n').filter(l => l.length > 0 && !l.startsWith('===') && !l.startsWith('---') && !l.startsWith('+++')).forEach(line => {
            if (line.startsWith('+')) console.log(chalk.green(line));
            else if (line.startsWith('-')) console.log(chalk.red(line));
            else console.log(chalk.gray(line));
        });
        console.log('');
    }

    const details = `${filepath}\n\n${patch}`;
    const perm = await requestPermission('Write File', details);
    if (!perm.allowed) {
        sendRemoteToolEvent({ actionType: 'Write File', details, status: 'denied' });
        return `User denied permission to write: ${filepath}`;
    }

    try {
        const dir = path.dirname(absPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absPath, content, 'utf8');
        sendRemoteToolEvent({ actionType: 'Write File', details, status: 'completed' });
        return `Successfully wrote to ${filepath}`;
    } catch (err) {
        sendRemoteToolEvent({ actionType: 'Write File', details: `${details}\n\nError: ${err.message}`, status: 'failed' });
        return `Error writing file: ${err.message}`;
    }
}
