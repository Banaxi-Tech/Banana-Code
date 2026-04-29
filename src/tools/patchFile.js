// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';
import { sendRemoteToolEvent } from '../remote.js';
import * as diff from 'diff';
import chalk from 'chalk';

export async function patchFile({ filepath, edits }) {
    const absPath = path.resolve(process.cwd(), filepath);
    
    let content = '';
    try {
        content = await fs.readFile(absPath, 'utf8');
    } catch (err) {
        return `Error reading file: ${err.message}`;
    }

    const originalContent = content;

    for (let i = 0; i < edits.length; i++) {
        const { oldText, newText, occurrence = 1 } = edits[i];
        
        if (!content.includes(oldText)) {
            return `Edit ${i + 1} failed: Cannot find the exact text to replace in ${filepath}. Please ensure you provide the exact text including whitespace and indentation.`;
        }

        if (occurrence === 0) {
            content = content.split(oldText).join(newText);
        } else {
            let index = -1;
            for (let j = 0; j < occurrence; j++) {
                index = content.indexOf(oldText, index + 1);
                if (index === -1) {
                    return `Edit ${i + 1} failed: Cannot find occurrence ${occurrence} of the text to replace in ${filepath}.`;
                }
            }
            content = content.substring(0, index) + newText + content.substring(index + oldText.length);
        }
    }

    if (originalContent === content) {
        return `No changes were made. The file is identical to the requested edit.`;
    }

    const patch = diff.createPatch(filepath, originalContent, content);

    process.stdout.write('\x1b[0m');
    console.log(chalk.cyan(`\nPreviewing changes for ${filepath}:`));
    patch.split('\n').filter(l => l.length > 0 && !l.startsWith('===') && !l.startsWith('---') && !l.startsWith('+++')).forEach(line => {
        if (line.startsWith('+')) console.log(chalk.green(line));
        else if (line.startsWith('-')) console.log(chalk.red(line));
        else console.log(chalk.gray(line));
    });
    console.log('');

    const details = `${filepath}\n\n${patch}`;
    const perm = await requestPermission('Patch File', details);
    if (!perm.allowed) {
        sendRemoteToolEvent({ actionType: 'Patch File', details, status: 'denied' });
        return `User denied permission to patch: ${filepath}`;
    }

    try {
        await fs.writeFile(absPath, content, 'utf8');
        sendRemoteToolEvent({ actionType: 'Patch File', details, status: 'completed' });
        return `Successfully patched ${filepath}`;
    } catch (err) {
        sendRemoteToolEvent({ actionType: 'Patch File', details: `${details}\n\nError: ${err.message}`, status: 'failed' });
        return `Error writing file: ${err.message}`;
    }
}
