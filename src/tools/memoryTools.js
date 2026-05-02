// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { addMemory, removeMemory, loadMemory, addProjectMemory, removeProjectMemory, loadProjectMemory } from '../utils/memory.js';
import chalk from 'chalk';
import ora from 'ora';

export async function saveMemoryTool({ fact }) {
    const spinner = ora({ text: `Saving memory...`, color: 'magenta', stream: process.stdout }).start();
    try {
        const id = await addMemory(fact);
        spinner.stop();
        return `Successfully saved fact. ID: ${id}`;
    } catch (err) {
        spinner.stop();
        return `Error saving memory: ${err.message}`;
    }
}

export async function saveProjectMemoryTool({ fact }) {
    const spinner = ora({ text: `Saving project memory...`, color: 'magenta', stream: process.stdout }).start();
    try {
        const id = await addProjectMemory(fact);
        spinner.stop();
        return `Successfully saved project fact. ID: ${id}`;
    } catch (err) {
        spinner.stop();
        return `Error saving project memory: ${err.message}`;
    }
}

export async function listMemoryTool() {
    const spinner = ora({ text: `Reading memories...`, color: 'magenta', stream: process.stdout }).start();
    try {
        const memories = await loadMemory();
        spinner.stop();
        if (memories.length === 0) {
            return `No memories currently saved.`;
        }
        return JSON.stringify(memories, null, 2);
    } catch (err) {
        spinner.stop();
        return `Error listing memories: ${err.message}`;
    }
}

export async function listProjectMemoryTool() {
    const spinner = ora({ text: `Reading project memories...`, color: 'magenta', stream: process.stdout }).start();
    try {
        const memories = await loadProjectMemory();
        spinner.stop();
        if (memories.length === 0) {
            return `No project memories currently saved.`;
        }
        return JSON.stringify(memories, null, 2);
    } catch (err) {
        spinner.stop();
        return `Error listing project memories: ${err.message}`;
    }
}

export async function deleteMemoryTool({ id }) {
    const spinner = ora({ text: `Deleting memory ${id}...`, color: 'magenta', stream: process.stdout }).start();
    try {
        const success = await removeMemory(id);
        spinner.stop();
        if (success) {
            return `Successfully deleted memory with ID: ${id}`;
        } else {
            return `Error: Memory with ID '${id}' not found.`;
        }
    } catch (err) {
        spinner.stop();
        return `Error deleting memory: ${err.message}`;
    }
}

export async function deleteProjectMemoryTool({ id }) {
    const spinner = ora({ text: `Deleting project memory ${id}...`, color: 'magenta', stream: process.stdout }).start();
    try {
        const success = await removeProjectMemory(id);
        spinner.stop();
        if (success) {
            return `Successfully deleted project memory with ID: ${id}`;
        } else {
            return `Error: Project memory with ID '${id}' not found.`;
        }
    } catch (err) {
        spinner.stop();
        return `Error deleting project memory: ${err.message}`;
    }
}
