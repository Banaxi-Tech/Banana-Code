// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { spawn } from 'child_process';
import { requestPermission } from '../permissions.js';
import { sendRemoteToolEvent } from '../remote.js';
import chalk from 'chalk';
import ora from 'ora';

export async function execCommand({ command, cwd = process.cwd() }) {
    const perm = await requestPermission('Execute Command', command);
    if (!perm.allowed) {
        sendRemoteToolEvent({ actionType: 'Execute Command', details: command, status: 'denied' });
        return `User denied permission to execute: ${command}`;
    }

    // Reset any lingering ANSI colour/background from AI output before tool output
    process.stdout.write('\x1b[0m');
    const spinner = ora({ text: `Running: ${chalk.cyan(command)}`, color: 'yellow', stream: process.stdout }).start();

    return new Promise((resolve) => {
        const child = spawn(command, { shell: true, cwd, stdio: 'pipe' });
        let output = '';

        child.stdout.on('data', (data) => {
            if (spinner.isSpinning) spinner.stop();
            process.stdout.write(chalk.yellow(data.toString()));
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            if (spinner.isSpinning) spinner.stop();
            process.stderr.write(chalk.red(data.toString()));
            output += data.toString();
        });

        child.on('close', (code) => {
            if (spinner.isSpinning) spinner.stop();
            let result = `Command exited with code ${code}.\nOutput:\n${output}`;
            const status = code === 0 ? 'completed' : 'failed';
            const details = `${command}\n\nExit code: ${code}${output ? `\n\n${output}` : ''}`;
            sendRemoteToolEvent({ actionType: 'Execute Command', details, status });
            if (code !== 0) {
                result += `\n\n[System Note: The command failed with an error. Please analyze the output above and try to fix the issue if it is possible.]`;
            }
            resolve(result);
        });

        child.on('error', (err) => {
            if (spinner.isSpinning) spinner.stop();
            sendRemoteToolEvent({ actionType: 'Execute Command', details: `${command}\n\nError: ${err.message}`, status: 'failed' });
            resolve(`Error executing command: ${err.message}\n\n[System Note: The command failed to execute. Please analyze the error and try to fix the issue if it is possible.]`);
        });
    });
}
