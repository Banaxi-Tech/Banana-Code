// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import path from 'path';
import { requestPermission } from '../permissions.js';
import { glob } from 'glob';
import fs from 'fs/promises';
import ora from 'ora';
import chalk from 'chalk';

export async function searchFiles({ directory, pattern }) {
    const perm = await requestPermission('Search in', `${directory} for: ${pattern}`);
    if (!perm.allowed) return `User denied permission to search.`;

    const spinner = ora({ text: `Searching in ${chalk.cyan(directory)} for "${chalk.yellow(pattern)}"...`, color: 'yellow', stream: process.stdout }).start();

    try {
        const dirPath = path.resolve(process.cwd(), directory);
        const files = await glob('**/*', { cwd: dirPath, nodir: true, ignore: 'node_modules/**' });
        let results = [];
        const regex = new RegExp(pattern, 'i');
        let truncated = false;

        for (let file of files) {
            if (results.length > 100) {
                truncated = true;
                break;
            }
            try {
                const fullPath = path.join(dirPath, file);
                const content = await fs.readFile(fullPath, 'utf8');
                const lines = content.split('\n');
                lines.forEach((line, index) => {
                    if (regex.test(line)) {
                        if (results.length <= 100) {
                            results.push(`${file}:${index + 1}: ${line.trim()}`);
                        }
                    }
                });
            } catch (err) { }
        }

        if (results.length === 0) {
            if (spinner.isSpinning) spinner.stop();
            return 'No matches found.';
        }
        let finalStr = results.join('\n');
        if (truncated) finalStr += '\n... (More than 100 matches found, truncated)';

        if (spinner.isSpinning) spinner.stop();
        return finalStr;
    } catch (err) {
        if (spinner && spinner.isSpinning) spinner.stop();
        return `Error searching files: ${err.message}`;
    }
}
