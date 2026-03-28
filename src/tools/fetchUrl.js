import { requestPermission } from '../permissions.js';
import ora from 'ora';
import chalk from 'chalk';

export async function fetchUrl({ url }) {
    const perm = await requestPermission('Fetch URL', url);
    if (!perm.allowed) return `User denied permission to fetch HTTP: ${url}`;

    const spinner = ora({ text: `Fetching ${chalk.cyan(url)}...`, color: 'yellow', stream: process.stdout }).start();

    try {
        const res = await fetch(url);
        const text = await res.text();
        if (spinner.isSpinning) spinner.stop();
        return text.substring(0, 10000); // Prevent gigantic page fetches crashing context
    } catch (err) {
        if (spinner.isSpinning) spinner.stop();
        return `Error fetching URL: ${err.message}`;
    }
}
