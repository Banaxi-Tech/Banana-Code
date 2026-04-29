// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BANANA_CODE_DOCS } from '../docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Provides official documentation for Banana Code.
 * It uses a hardcoded summary for speed/reliability and falls back to README.md if available.
 */
export async function getBananaDocs() {
    try {
        let docs = `--- Banana Code Official Documentation ---\n\n${BANANA_CODE_DOCS}`;
        
        // Add a section for the full README if found (deep dive)
        let readmePath = path.resolve(process.cwd(), 'README.md');
        if (!fs.existsSync(readmePath)) {
            readmePath = path.resolve(__dirname, '../../README.md');
        }

        if (fs.existsSync(readmePath)) {
            const fullReadme = fs.readFileSync(readmePath, 'utf8');
            docs += `\n\n--- Deep Dive (README.md) ---\n\n${fullReadme}`;
        }

        docs += `\n\n--- End of Documentation ---`;
        return docs;
    } catch (error) {
        // Even if README fails, we still have the hardcoded summary
        return `--- Banana Code Official Documentation ---\n\n${BANANA_CODE_DOCS}\n\n(Warning: Could not read deep-dive README: ${error.message})\n\n--- End of Documentation ---`;
    }
}
