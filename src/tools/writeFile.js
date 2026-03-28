import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';
import * as diff from 'diff';
import chalk from 'chalk';

export async function writeFile({ filepath, content }) {
    const absPath = path.resolve(process.cwd(), filepath);

    let oldContent = '';
    try {
        oldContent = await fs.readFile(absPath, 'utf8');
    } catch (err) { }

    const patch = diff.createPatch(filepath, oldContent, content);

    console.log(chalk.cyan(`\nPreviewing changes for ${filepath}:`));
    patch.split('\n').filter(l => l.length > 0 && !l.startsWith('===') && !l.startsWith('---') && !l.startsWith('+++')).forEach(line => {
        if (line.startsWith('+')) console.log(chalk.green(line));
        else if (line.startsWith('-')) console.log(chalk.red(line));
        else console.log(chalk.gray(line));
    });
    console.log('');

    const perm = await requestPermission('Write File', filepath);
    if (!perm.allowed) return `User denied permission to write: ${filepath}`;

    try {
        const dir = path.dirname(absPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absPath, content, 'utf8');
        return `Successfully wrote to ${filepath}`;
    } catch (err) {
        return `Error writing file: ${err.message}`;
    }
}
