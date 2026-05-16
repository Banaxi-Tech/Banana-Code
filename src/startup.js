// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { getAvailableSkills } from './utils/skills.js';

async function checkAndSendFirstOpenPing() {
    try {
        const configDir = path.join(os.homedir(), '.config', 'banana-code');
        const flagFile = path.join(configDir, 'download.json');

        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        if (!fs.existsSync(flagFile)) {
            // Send request to the download server to count downloads.
            // Note: The server processes IPs momentarily to filter bots but does not store them.
            // Only the total download count is saved.
            await fetch('https://bananacode.sh/monitor/download');
            // Save the flag so we don't send it again
            fs.writeFileSync(flagFile, JSON.stringify({ downloaded: true }));
        }
    } catch (e) {
        // Silently ignore errors so app startup is not interrupted
    }
}

/** Vertical yellow–gold gradient (top → bottom) for the startup banner. */
const BANNER_GRADIENT = [
    '#b8860b', // dark goldenrod
    '#c9a017',
    '#d4af37', // gold
    '#e6c200',
    '#f0d850',
    '#ffe066'
];

const BANNER_LINES = [
    '██████╗  █████╗ ███╗   ██╗ █████╗ ███╗   ██╗ █████╗      ██████╗ ██████╗ ██████╗ ███████╗',
    '██╔══██╗██╔══██╗████╗  ██║██╔══██╗████╗  ██║██╔══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
    '██████╔╝███████║██╔██╗ ██║███████║██╔██╗ ██║███████║    ██║     ██║   ██║██║  ██║█████╗  ',
    '██╔══██╗██╔══██║██║╚██╗██║██╔══██║██║╚██╗██║██╔══██║    ██║     ██║   ██║██║  ██║██╔══╝  ',
    '██████╔╝██║  ██║██║ ╚████║██║  ██║██║ ╚████║██║  ██║    ╚██████╗╚██████╔╝██████╔╝███████╗',
    '╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝'
];

const NEW_UI_BANANA_LINES = [
    '@==@',
    '*====',
    '====',
    '+===',
    '%====+',
    '======#',
    '=======#',
    '========*',
    '@=========',
    '=+++======',
    '=++++=====%',
    '=++++======',
    '*+++++======',
    '+++++======#',
    '++++++======*',
    '++++++=======',
    '#++++++=======%',
    '*++++++========%',
    '#++++++==========',
    '+++++++===========%',
    '+++++++++==========',
    '++++++++++=======',
    '*+++++++++++++',
    '*+++++++++',
    '@++++'
];

function stripAnsi(text) {
    return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(text) {
    return stripAnsi(text).length;
}

function truncatePlain(text, width) {
    const value = String(text || '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, Math.max(0, width));
    return value.slice(0, width - 1) + '…';
}

function padEndVisible(text, width) {
    const pad = Math.max(0, width - visibleLength(text));
    return text + ' '.repeat(pad);
}

function centerPlain(text, width) {
    const value = truncatePlain(text, width);
    const left = Math.max(0, Math.floor((width - value.length) / 2));
    const right = Math.max(0, width - value.length - left);
    return ' '.repeat(left) + value + ' '.repeat(right);
}

function formatProviderLabel(providerName) {
    const labels = {
        openai: 'OpenAI',
        openai_oauth: 'OpenAI',
        openrouter: 'OpenRouter',
        ollama_cloud: 'Ollama Cloud',
        lmstudio: 'LM Studio',
        llamacpp: 'llama.cpp',
        gemini: 'Gemini',
        claude: 'Claude',
        mistral: 'Mistral',
        deepseek: 'DeepSeek',
        kimi: 'Kimi',
        qwen: 'Qwen',
        ollama: 'Ollama'
    };
    const key = String(providerName || 'unknown');
    if (labels[key]) return labels[key];
    return key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, ch => ch.toUpperCase());
}

function formatTopBorder(width, title) {
    const accent = chalk.hex('#e5b93f');
    const titleLabel = accent.bold(title);
    const prefix = '╭─── ';
    const suffix = '╮';
    return accent(prefix) + titleLabel + accent(' ' + '─'.repeat(Math.max(0, width - visibleLength(prefix) - title.length - 1 - visibleLength(suffix))) + suffix);
}

function formatCount(count, label) {
    return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function getGitStatusSummary(cwd) {
    try {
        const output = execFileSync('git', ['status', '--short'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const changedFiles = output.split('\n').filter(line => line.trim()).length;
        return `${formatCount(changedFiles, 'changed file')}`;
    } catch (e) {
        return 'Unavailable';
    }
}

function getProjectSetupRows(cwd) {
    const bananaPath = path.join(cwd, 'BANANA.md');
    const skillCount = getAvailableSkills().length;

    return [
        ['BANANA.md', fs.existsSync(bananaPath) ? 'Found' : 'Not found'],
        ['Git status', getGitStatusSummary(cwd)],
        ['Skills', `${skillCount} available`]
    ];
}

function formatLabeledRow(label, value, width) {
    const labelWidth = 16;
    const prefix = `  ${label.padEnd(labelWidth, ' ')}${value}`;
    return ` ${truncatePlain(prefix, Math.max(0, width - 1))}`;
}

function shouldShowEffortCommand(providerName, authType) {
    return providerName === 'claude' || providerName === 'openai_oauth' || (providerName === 'openai' && authType === 'oauth');
}

function getQuickCommandRows(providerName, authType) {
    const rows = [
        ['/model', 'Switch model'],
        ['/voice', 'Use voice mode 🍌']
    ];

    if (shouldShowEffortCommand(providerName, authType)) {
        rows.push(['/effort', 'Change effort level']);
    }

    return rows;
}

function renderNewUiWelcome({
    width = process.stdout.columns || 100,
    cwd = process.cwd(),
    providerName = 'unknown',
    modelName = 'unknown',
    authType = 'api_key'
} = {}) {
    const boxWidth = Math.max(50, Math.min(width, 150));
    const innerWidth = boxWidth - 2;
    const leftWidth = Math.min(34, Math.max(18, Math.floor(innerWidth * 0.34)));
    const rightWidth = innerWidth - leftWidth - 1;
    const folderName = path.basename(cwd) || cwd;
    const modelLine = truncatePlain(`${modelName || 'unknown'} · ${formatProviderLabel(providerName)}`, leftWidth);
    const releaseHint = '/help for more';

    const leftLines = [
        '',
        centerPlain('Welcome back!', leftWidth),
        '',
        ...NEW_UI_BANANA_LINES.map(line => chalk.hex('#e5b93f')(centerPlain(line, leftWidth))),
        centerPlain(modelLine, leftWidth),
        centerPlain(truncatePlain(folderName, leftWidth), leftWidth)
    ];

    const rowCount = Math.max(leftLines.length, 26);
    const rightLines = Array.from({ length: rowCount }, () => '');
    const hasBananaMd = fs.existsSync(path.join(cwd, 'BANANA.md'));
    let lineIndex = 0;

    rightLines[lineIndex++] = chalk.bold(' Workspace');
    if (!hasBananaMd) {
        rightLines[lineIndex++] = ` ${truncatePlain('Run /init to create BANANA.md', rightWidth - 1)}`;
    }
    rightLines[lineIndex++] = ` ${'─'.repeat(Math.max(0, rightWidth - 2))} `;
    lineIndex++;

    rightLines[lineIndex++] = chalk.bold(' Project Setup');
    getProjectSetupRows(cwd).forEach(([label, value], index) => {
        rightLines[lineIndex + index] = formatLabeledRow(label, value, rightWidth);
    });
    lineIndex += 4;

    rightLines[lineIndex++] = chalk.bold(' Quick Common Commands');
    getQuickCommandRows(providerName, authType).forEach(([command, description], index) => {
        rightLines[lineIndex + index] = formatLabeledRow(command, description, rightWidth);
    });
    lineIndex += getQuickCommandRows(providerName, authType).length + 1;

    rightLines[lineIndex++] = chalk.bold(' Next');
    rightLines[lineIndex] = ` ${truncatePlain('Ask a question, paste an error, or build something', rightWidth - 1)}`;
    rightLines[rowCount - 2] = ` ${releaseHint}`;

    const rows = [];
    const accent = chalk.hex('#e5b93f');
    rows.push(formatTopBorder(boxWidth, 'Banana Code'));
    for (let i = 0; i < rowCount; i++) {
        rows.push(accent('│') +
            padEndVisible(leftLines[i] || '', leftWidth) +
            chalk.gray('│') +
            padEndVisible(rightLines[i] || '', rightWidth) +
            accent('│'));
    }
    rows.push(accent('╰' + '─'.repeat(innerWidth) + '╯'));
    return rows.join('\n');
}

export async function runStartup(options = {}) {
    await checkAndSendFirstOpenPing();
    
    console.clear();
    if (options.newUi) {
        console.log(renderNewUiWelcome(options));
        console.log();
        return;
    }

    BANNER_LINES.forEach((line, i) => {
        const color = BANNER_GRADIENT[Math.min(i, BANNER_GRADIENT.length - 1)];
        console.log(chalk.hex(color)(line));
    });
    console.log();
    console.log(chalk.bold.hex('#f5e6a3')('Hold on, peeling the code...'));

    const spinner = ora({
        text: "Initializing 🍌Banana Code...",
        color: 'yellow'
    }).start();

    await new Promise(resolve => setTimeout(resolve, 1500));
    spinner.stop();
}
