// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const RUNTIME_DIR = path.join(os.homedir(), '.config', 'banana-code', 'puppeteer-runtime');
const RUNTIME_PACKAGE_JSON = path.join(RUNTIME_DIR, 'package.json');

let installPromise = null;

async function pathExists(filepath) {
    try {
        await fs.access(filepath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

async function ensureRuntimePackage() {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });

    if (await pathExists(RUNTIME_PACKAGE_JSON)) return;

    await fs.writeFile(RUNTIME_PACKAGE_JSON, JSON.stringify({
        private: true,
        description: 'Runtime dependencies for Banana Code optional Puppeteer fetch.',
        dependencies: {}
    }, null, 2), 'utf-8');
}

function createRuntimeRequire() {
    return createRequire(RUNTIME_PACKAGE_JSON);
}

function resolveInstalledPuppeteer() {
    const runtimeRequire = createRuntimeRequire();
    runtimeRequire.resolve('puppeteer');
    return runtimeRequire('puppeteer');
}

async function installPuppeteer() {
    await ensureRuntimePackage();

    try {
        await execFileAsync('npm', ['install', 'puppeteer', '--omit=dev', '--no-audit', '--no-fund'], {
            cwd: RUNTIME_DIR,
            maxBuffer: 1024 * 1024 * 10
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('npm was not found. Install npm, then try Puppeteer fetch again.');
        }

        const details = error.stderr || error.stdout || error.message;
        throw new Error(`Failed to install Puppeteer runtime: ${details}`);
    }
}

export async function loadRuntimePuppeteer() {
    await ensureRuntimePackage();

    try {
        return resolveInstalledPuppeteer();
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') {
            throw error;
        }
    }

    installPromise ??= installPuppeteer().finally(() => {
        installPromise = null;
    });

    await installPromise;
    return resolveInstalledPuppeteer();
}
