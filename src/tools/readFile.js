import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';

export async function readFile({ filepath }) {
    const absPath = path.resolve(process.cwd(), filepath);
    const perm = await requestPermission('Read File', filepath);
    if (!perm.allowed) return `User denied permission to read: ${filepath}`;

    try {
        const content = await fs.readFile(absPath, 'utf8');
        return content;
    } catch (err) {
        return `Error reading file: ${err.message}`;
    }
}
