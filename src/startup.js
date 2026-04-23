import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

export async function runStartup() {
    await checkAndSendFirstOpenPing();
    
    console.clear();
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
