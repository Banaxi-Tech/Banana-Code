// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import chalk from 'chalk';
import { getTermWidth, isNewUiEnabled, padLine, truncatePlain } from './newUi.js';

export { isNewUiEnabled };

const FILE_PERMISSION_ACTIONS = new Set(['Write File', 'Patch File']);
const DASH = '╌';
const REMOVED_LINE = chalk.bgRgb(78, 0, 0).rgb(255, 120, 120);
const ADDED_LINE = chalk.bgRgb(0, 62, 0).rgb(135, 255, 135);

function parseHunkHeader(line) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) return null;
    return {
        oldLine: Number(match[1]),
        newLine: Number(match[3])
    };
}

function parseDetails(details = '') {
    const text = String(details || '');
    const splitIndex = text.indexOf('\n\n');
    if (splitIndex === -1) {
        return { filepath: text.trim(), patch: '' };
    }
    return {
        filepath: text.slice(0, splitIndex).trim(),
        patch: text.slice(splitIndex + 2)
    };
}

function isCreatePatch(actionType, patch) {
    return actionType === 'Write File' && /^@@ -0,0 \+\d+(?:,\d+)? @@/m.test(patch);
}

export function getNewUiFilePermissionInfo(actionType, details) {
    const { filepath, patch } = parseDetails(details);
    const create = isCreatePatch(actionType, patch);
    const operation = create ? 'Create file' : 'Edit file';
    const question = create
        ? `Do you want to create ${filepath}?`
        : `Do you want to make this edit to ${filepath}?`;

    return { filepath, patch, create, operation, question };
}

export function isNewUiFilePermission(actionType) {
    return isNewUiEnabled() && FILE_PERMISSION_ACTIONS.has(actionType);
}

function buildPreviewRows(actionType, patch) {
    const rows = [];
    const create = isCreatePatch(actionType, patch);
    let oldLine = 0;
    let newLine = 0;

    for (const rawLine of String(patch || '').split('\n')) {
        if (!rawLine || rawLine.startsWith('Index:') || rawLine.startsWith('===')) continue;
        if (rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) continue;
        if (rawLine.startsWith('\\ No newline') || rawLine.startsWith('\\\\ No newline')) continue;

        const hunk = parseHunkHeader(rawLine);
        if (hunk) {
            oldLine = hunk.oldLine;
            newLine = hunk.newLine;
            continue;
        }

        const marker = rawLine[0];
        const text = rawLine.slice(1);

        if (marker === ' ') {
            rows.push({ lineNo: newLine, marker: '', text, kind: 'context' });
            oldLine++;
            newLine++;
        } else if (marker === '-') {
            rows.push({ lineNo: oldLine, marker: '-', text, kind: 'remove' });
            oldLine++;
        } else if (marker === '+') {
            rows.push({
                lineNo: newLine,
                marker: create ? '' : '+',
                text,
                kind: create ? 'create' : 'add'
            });
            newLine++;
        }
    }

    return rows;
}

function formatPreviewRow(row, lineNoWidth, width) {
    const lineNo = String(row.lineNo).padStart(lineNoWidth, ' ');
    const marker = row.marker ? `${row.marker} ` : '';
    const raw = ` ${lineNo} ${marker}${row.text}`;
    const line = padLine(truncatePlain(raw, width), width);

    if (row.kind === 'remove') return REMOVED_LINE(line);
    if (row.kind === 'add') return ADDED_LINE(line);
    return row.kind === 'context' ? chalk.gray(line) : line;
}

export function printNewUiFilePreview(actionType, filepath, patch) {
    if (!isNewUiEnabled()) return;

    const width = getTermWidth();
    const create = isCreatePatch(actionType, patch);
    const operation = create ? 'Create file' : 'Edit file';
    const displayPath = filepath || '';
    const rows = buildPreviewRows(actionType, patch);
    const lineNoWidth = Math.max(1, ...rows.map(row => String(row.lineNo).length));
    const separator = chalk.gray(DASH.repeat(width));

    process.stdout.write('\x1b[0m');
    console.log();
    console.log(chalk.gray('─'.repeat(width)));
    console.log(` ${operation}`);
    console.log(` ${displayPath}`);
    console.log(separator);

    if (rows.length === 0) {
        console.log(chalk.gray(' No visible line changes'));
    } else {
        rows.forEach(row => console.log(formatPreviewRow(row, lineNoWidth, width)));
    }

    console.log(separator);
}
