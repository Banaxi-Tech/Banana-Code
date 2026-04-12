import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import crypto from 'crypto';

const sessionPermissions = new Set();

function wrapText(text, width) {
    const lines = [];
    for (let i = 0; i < text.length; i += width) {
        lines.push(text.substring(i, i + width));
    }
    return lines;
}

export async function requestPermission(actionType, details) {
    const permKey = `allow_session_${actionType}`;

    if (sessionPermissions.has(permKey)) {
        return { allowed: true };
    }

    if (typeof global.apiPermissionHandler === 'function') {
        const ticketId = crypto.randomUUID();
        const result = await global.apiPermissionHandler(ticketId, actionType, details);
        if (result.remember) {
            sessionPermissions.add(permKey);
        }
        return { allowed: result.allowed };
    }

    const boxWidth = 41; // Internal width

    const actionLabel = ` Action: ${actionType}`;
    const actionLine = actionLabel.padEnd(boxWidth, ' ');

    const detailsLabel = ' Details: ';
    const detailRows = wrapText(details, boxWidth - detailsLabel.length);

    let detailsBlock = '';
    detailRows.forEach((row, i) => {
        const prefix = (i === 0) ? detailsLabel : ' '.repeat(detailsLabel.length);
        detailsBlock += `│ ${prefix}${row.padEnd(boxWidth - detailsLabel.length, ' ')} │\n`;
    });

    const boxTop = chalk.magenta(`┌─────────────────────────────────────────┐
│  🍌 BANANA CODE — Permission Request    │
├─────────────────────────────────────────┤
│ ${actionLine} │`);
    const boxBottom = chalk.magenta(`├─────────────────────────────────────────┤
│  [1] Allow Once                         │
│  [2] Allow for This Session             │
│  [3] Disallow (suggest changes)         │
└─────────────────────────────────────────┘`);

    console.log(boxTop);
    console.log(chalk.magenta(detailsBlock.trimEnd()));
    console.log(boxBottom);

    const choice = await select({
        message: chalk.magenta('Select an option:'),
        choices: [
            { name: 'Allow Once', value: 'once' },
            { name: 'Allow for This Session', value: 'session' },
            { name: 'Disallow (suggest changes)', value: 'disallow' }
        ]
    });

    if (choice === 'once') return { allowed: true };
    if (choice === 'session') {
        sessionPermissions.add(permKey);
        return { allowed: true };
    }

    return { allowed: false };
}

export function getSessionPermissions() {
    return Array.from(sessionPermissions);
}
