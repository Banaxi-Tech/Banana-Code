// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import chalk from 'chalk';
import { select } from '@inquirer/prompts';

const EXTERNAL_AGENT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readFileIfPresent(filepath) {
    try {
        return await fs.readFile(filepath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function hasCurrentImport(bananaContent, filename, hash) {
    return bananaContent.includes(`<!-- banana-code:imported-instructions ${filename} sha256:${hash} -->`);
}

function hasAnyImportBlock(bananaContent, filename) {
    const escaped = escapeRegExp(filename);
    const pattern = new RegExp(
        `<!-- banana-code:imported-instructions ${escaped} sha256:[a-f0-9]+ -->`
    );
    return pattern.test(bananaContent);
}

function listImportedFilenames(bananaContent) {
    const filenames = new Set();
    const pattern = /<!-- banana-code:imported-instructions ([^\s]+) sha256:[a-f0-9]+ -->/g;
    for (const match of bananaContent.matchAll(pattern)) {
        filenames.add(match[1]);
    }
    return [...filenames];
}

function removeExistingImportBlock(bananaContent, filename) {
    const escaped = escapeRegExp(filename);
    const blockPattern = new RegExp(
        `\\n{0,2}<!-- banana-code:imported-instructions ${escaped} sha256:[a-f0-9]+ -->[\\s\\S]*?<!-- /banana-code:imported-instructions ${escaped} -->\\n*`,
        'g'
    );

    return bananaContent.replace(blockPattern, '\n\n').trimEnd();
}

function buildImportBlock(filename, hash, content) {
    const trimmedContent = content.trim();

    return [
        `<!-- banana-code:imported-instructions ${filename} sha256:${hash} -->`,
        `## Imported from ${filename}`,
        '',
        trimmedContent,
        '',
        `<!-- /banana-code:imported-instructions ${filename} -->`
    ].join('\n');
}

async function getPendingExternalInstructions(cwd, bananaContent) {
    const pending = [];

    for (const filename of EXTERNAL_AGENT_INSTRUCTION_FILES) {
        const filepath = path.join(cwd, filename);
        const content = await readFileIfPresent(filepath);

        if (content === null || content.trim().length === 0) {
            continue;
        }

        const hash = sha256(content);
        if (hasCurrentImport(bananaContent, filename, hash)) {
            continue;
        }

        pending.push({ filename, content, hash });
    }

    return pending;
}

async function getOrphanedImports(cwd, bananaContent) {
    const orphans = [];

    for (const filename of listImportedFilenames(bananaContent)) {
        const filepath = path.join(cwd, filename);
        const content = await readFileIfPresent(filepath);

        if (content === null || content.trim().length === 0) {
            if (hasAnyImportBlock(bananaContent, filename)) {
                orphans.push(filename);
            }
        }
    }

    return orphans;
}

export async function promptToMergeExternalAgentInstructions(cwd = process.cwd()) {
    const bananaPath = path.join(cwd, 'BANANA.md');
    const existingBananaContent = await readFileIfPresent(bananaPath) || '';
    const pending = await getPendingExternalInstructions(cwd, existingBananaContent);
    const orphans = await getOrphanedImports(cwd, existingBananaContent);

    if (pending.length === 0 && orphans.length === 0) {
        return { merged: false, removed: [], files: [], status: 'no_pending' };
    }

    const pendingList = pending.map(file => file.filename).join(', ');
    const orphanList = orphans.join(', ');

    console.log(chalk.yellow.bold('\nBANANA.md update available:\n'));
    if (pending.length > 0) {
        console.log(chalk.yellow(` Imports to merge:  ${pendingList}`));
    }
    if (orphans.length > 0) {
        console.log(chalk.yellow(` Stale blocks to remove (source file deleted/emptied): ${orphanList}`));
    }
    console.log('');

    const promptMessage = pending.length > 0 && orphans.length > 0
        ? `Update ${bananaPath}? (${pending.length} merge, ${orphans.length} remove)`
        : pending.length > 0
            ? `Merge ${pendingList} into ${bananaPath}?`
            : `Remove stale ${orphanList} block${orphans.length > 1 ? 's' : ''} from ${bananaPath}?`;

    let shouldApply;
    try {
        shouldApply = await select({
            message: promptMessage,
            choices: [
                { name: 'Yes, update BANANA.md', value: true },
                { name: 'No, skip for now', value: false }
            ]
        });
    } catch (error) {
        if (error.name === 'ExitPromptError') {
            return { merged: false, removed: [], files: [], status: 'cancelled' };
        }
        throw error;
    }

    if (!shouldApply) {
        return { merged: false, removed: [], files: [], status: 'declined' };
    }

    let nextBananaContent = existingBananaContent.trimEnd();

    for (const filename of orphans) {
        nextBananaContent = removeExistingImportBlock(nextBananaContent, filename);
    }

    if (pending.length > 0 && !nextBananaContent) {
        nextBananaContent = [
            '# Banana Code Project Context',
            '',
            'This file contains project instructions Banana Code loads automatically.'
        ].join('\n');
    }

    for (const file of pending) {
        nextBananaContent = removeExistingImportBlock(nextBananaContent, file.filename);
        nextBananaContent = `${nextBananaContent.trimEnd()}\n\n${buildImportBlock(file.filename, file.hash, file.content)}`;
    }

    await fs.writeFile(bananaPath, `${nextBananaContent.trimEnd()}\n`, 'utf8');

    if (pending.length > 0) {
        console.log(chalk.green(`Merged ${pendingList} into BANANA.md.`));
    }
    if (orphans.length > 0) {
        console.log(chalk.green(`Removed stale block${orphans.length > 1 ? 's' : ''} for ${orphanList} from BANANA.md.`));
    }

    return {
        merged: pending.length > 0,
        files: pending.map(file => file.filename),
        removed: orphans,
        status: 'merged'
    };
}
