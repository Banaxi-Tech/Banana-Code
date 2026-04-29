// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import ora from 'ora';
import chalk from 'chalk';

export async function duckDuckGo({ query }) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&pretty=1`;
    const spinner = ora({ text: `Searching DuckDuckGo for ${chalk.cyan(query)}...`, color: 'yellow', stream: process.stdout }).start();

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (spinner.isSpinning) spinner.stop();

        // DuckDuckGo API returns a lot of fields, let's extract the most useful ones
        const result = {
            Abstract: data.Abstract,
            AbstractText: data.AbstractText,
            AbstractSource: data.AbstractSource,
            AbstractURL: data.AbstractURL,
            Answer: data.Answer,
            Definition: data.Definition,
            DefinitionSource: data.DefinitionSource,
            DefinitionURL: data.DefinitionURL,
            RelatedTopics: data.RelatedTopics?.slice(0, 5).map(topic => ({
                Text: topic.Text,
                FirstURL: topic.FirstURL
            }))
        };

        return JSON.stringify(result, null, 2);
    } catch (err) {
        if (spinner.isSpinning) spinner.stop();
        return `Error searching DuckDuckGo: ${err.message}`;
    }
}
