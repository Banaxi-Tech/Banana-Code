import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

export async function getWorkspaceTree() {
    let ignores = ['node_modules/**', '.git/**'];
    
    try {
        const gitignore = await fs.readFile(path.join(process.cwd(), '.gitignore'), 'utf8');
        ignores = ignores.concat(gitignore.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
    } catch (e) {}

    try {
        const bananacodeignore = await fs.readFile(path.join(process.cwd(), '.bananacodeignore'), 'utf8');
        ignores = ignores.concat(bananacodeignore.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
    } catch (e) {}

    try {
        const files = await glob('**/*', { 
            cwd: process.cwd(),
            ignore: ignores,
            nodir: true,
            dot: true
        });
        
        return files.join('\n');
    } catch (err) {
        return `Error reading workspace: ${err.message}`;
    }
}
