// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';

export async function readManyFiles({ filepaths }) {
    if (!Array.isArray(filepaths)) {
        return 'Error: filepaths must be an array of strings.';
    }

    let results = [];
    
    // Request permission for all files. You could ask for them individually or batch them.
    // Here we'll request them individually but sequentially.
    for (const filepath of filepaths) {
        const absPath = path.resolve(process.cwd(), filepath);
        const perm = await requestPermission('Read File', filepath);
        
        if (!perm.allowed) {
            results.push(`--- File: ${filepath} ---\nUser denied permission to read: ${filepath}\n`);
            continue;
        }

        try {
            const content = await fs.readFile(absPath, 'utf8');
            results.push(`--- File: ${filepath} ---\n${content}\n`);
        } catch (err) {
            results.push(`--- File: ${filepath} ---\nError reading file: ${err.message}\n`);
        }
    }

    return results.join('\n');
}
