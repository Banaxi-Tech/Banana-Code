// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { requestPermission } from '../permissions.js';
import { loadRuntimePuppeteer } from '../utils/puppeteerRuntime.js';
import ora from 'ora';
import chalk from 'chalk';

const MAX_FETCH_CHARS = 10000;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function validateFetchUrl(url) {
    let parsedUrl;

    try {
        parsedUrl = new URL(url);
    } catch {
        return 'Error fetching URL: Invalid URL.';
    }

    if (!ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
        return 'Error fetching URL: Only HTTP and HTTPS URLs are supported.';
    }

    return null;
}

async function fetchHttp(url) {
    const res = await fetch(url);
    const text = await res.text();
    return text.substring(0, MAX_FETCH_CHARS);
}

async function fetchRendered(url) {
    const puppeteerModule = await loadRuntimePuppeteer();
    const puppeteer = puppeteerModule.default || puppeteerModule;
    let browser;

    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        try {
            await page.waitForNetworkIdle({ idleTime: 500, timeout: 3000 });
        } catch {
            // Some pages keep long-lived connections open; DOM text is still useful.
        }

        const text = await page.evaluate(() => {
            return document.body?.innerText || document.documentElement?.innerText || document.documentElement?.outerHTML || '';
        });

        return text.substring(0, MAX_FETCH_CHARS);
    } finally {
        if (browser) await browser.close();
    }
}

export async function fetchUrl({ url }, config = {}) {
    const validationError = validateFetchUrl(url);
    if (validationError) return validationError;

    const perm = await requestPermission('Fetch URL', url);
    if (!perm.allowed) return `User denied permission to fetch HTTP: ${url}`;

    const usePuppeteer = config.usePuppeteerFetch === true;
    const spinnerText = usePuppeteer
        ? `Rendering ${chalk.cyan(url)} with Puppeteer...`
        : `Fetching ${chalk.cyan(url)}...`;
    const spinner = ora({ text: spinnerText, color: 'yellow', stream: process.stdout }).start();

    try {
        const text = usePuppeteer ? await fetchRendered(url) : await fetchHttp(url);
        if (spinner.isSpinning) spinner.stop();
        return text;
    } catch (err) {
        if (spinner.isSpinning) spinner.stop();
        const mode = usePuppeteer ? ' with Puppeteer' : '';
        return `Error fetching URL${mode}: ${err.message}`;
    }
}
