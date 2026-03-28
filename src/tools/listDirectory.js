import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';

export async function listDirectory({ directoryPath }) {
    const dirPath = path.resolve(process.cwd(), directoryPath || '.');
    const perm = await requestPermission('List Directory', directoryPath || '.');
    if (!perm.allowed) return `User denied permission to list: ${directoryPath}`;

    try {
        const list = await fs.readdir(dirPath, { withFileTypes: true });
        let result = [];
        for (const dirent of list) {
            const isDir = dirent.isDirectory();
            result.push(`${isDir ? '[DIR ]' : '[FILE]'} ${dirent.name}`);
        }
        return result.join('\n');
    } catch (err) {
        return `Error listing directory: ${err.message}`;
    }
}
