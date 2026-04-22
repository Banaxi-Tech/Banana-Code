import fs from 'fs/promises';
import path from 'path';

/**
 * Creates a directory at the specified path.
 *
 * @param {Object} args - The arguments for the tool.
 * @param {string} args.directoryPath - The path of the directory to create.
 * @returns {Promise<string>} A success message.
 */
export async function createDirectory(args) {
    const { directoryPath } = args;

    if (!directoryPath) {
        throw new Error('directoryPath is required');
    }

    try {
        await fs.mkdir(directoryPath, { recursive: true });
        return `Successfully created directory: ${directoryPath}`;
    } catch (error) {
        throw new Error(`Failed to create directory: ${error.message}`);
    }
}
