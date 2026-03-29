import { spawn } from 'child_process';
import { requestPermission } from '../permissions.js';
import chalk from 'chalk';
import ora from 'ora';

export async function execCommand({ command, cwd = process.cwd() }) {
    const perm = await requestPermission('Execute Command', command);
    if (!perm.allowed) {
        return `User denied permission to execute: ${command}`;
    }

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
            if (code !== 0) {
                result += `\n\n[System Note: The command failed with an error. Please analyze the output above and try to fix the issue if it is possible.]`;
            }
            resolve(result);
        });

        child.on('error', (err) => {
            if (spinner.isSpinning) spinner.stop();
            resolve(`Error executing command: ${err.message}\n\n[System Note: The command failed to execute. Please analyze the error and try to fix the issue if it is possible.]`);
        });
    });
}
