import fs from 'fs/promises';
import path from 'path';
import { requestPermission } from '../permissions.js';
import chalk from 'chalk';

export async function renameFile({ sourcePath, destinationPath }) {
    const absSource = path.resolve(process.cwd(), sourcePath);
    const absDest = path.resolve(process.cwd(), destinationPath);

    try {
        // Check if source exists
        await fs.access(absSource);
    } catch (err) {
        return `Error: Source file does not exist: ${sourcePath}`;
    }

    try {
        // Check if destination already exists to prevent overwrite
        await fs.access(absDest);
        return `Error: Destination path already exists: ${destinationPath}`;
    } catch (err) {
        // If access fails, the file doesn't exist, which is what we want
        if (err.code !== 'ENOENT') {
            return `Error checking destination: ${err.message}`;
        }
    }

    console.log(chalk.cyan(`\nRenaming: ${sourcePath} → ${destinationPath}`));

    const perm = await requestPermission('Rename File', `${sourcePath} → ${destinationPath}`);
    if (!perm.allowed) return `User denied permission to rename file: ${sourcePath} → ${destinationPath}`;

    try {
        await fs.rename(absSource, absDest);
        return `Successfully renamed ${sourcePath} to ${destinationPath}`;
    } catch (err) {
        return `Error renaming file: ${err.message}`;
    }
}
