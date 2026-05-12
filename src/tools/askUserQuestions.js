// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';

const CUSTOM_VALUE = '__banana_custom_answer__';

function cleanString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeOptions(question) {
    if (!Array.isArray(question.options)) return [];
    return question.options
        .map((option, index) => {
            if (typeof option === 'string') {
                const label = option.trim();
                return label ? { label, description: '' } : null;
            }
            const label = cleanString(option?.label || option?.name || option?.value, `Option ${index + 1}`);
            return {
                label,
                description: cleanString(option?.description || option?.hint || '')
            };
        })
        .filter(Boolean)
        .slice(0, 8);
}

export async function askUserQuestions({ questions = [] }) {
    if (!Array.isArray(questions) || questions.length === 0) {
        return 'No questions were provided.';
    }

    const answers = [];
    const limitedQuestions = questions.slice(0, 6);

    for (let i = 0; i < limitedQuestions.length; i++) {
        const question = limitedQuestions[i] || {};
        const promptText = cleanString(question.question || question.message, `Question ${i + 1}`);
        const header = cleanString(question.header || question.title || '');
        const options = normalizeOptions(question);
        const allowCustom = question.allowCustom !== false;

        if (header) {
            console.log(chalk.cyan.bold(`\n${header}`));
        }

        let answer;
        if (options.length > 0) {
            const choices = options.map((option, index) => ({
                name: `${index + 1}. ${option.label}`,
                value: option.label,
                description: option.description || undefined
            }));

            if (allowCustom) {
                choices.push({
                    name: `${choices.length + 1}. Type something.`,
                    value: CUSTOM_VALUE,
                    description: 'Enter a custom answer.'
                });
            }

            const selected = await select({
                message: promptText,
                choices,
                loop: false,
                pageSize: Math.min(choices.length, 10)
            });

            if (selected === CUSTOM_VALUE) {
                answer = await input({
                    message: 'Type your answer:',
                    validate: (value) => value.trim().length > 0 || 'Answer cannot be empty'
                });
            } else {
                answer = selected;
            }
        } else {
            answer = await input({
                message: promptText,
                validate: (value) => value.trim().length > 0 || 'Answer cannot be empty'
            });
        }

        answers.push({
            question: promptText,
            answer: String(answer).trim()
        });
    }

    return JSON.stringify({ answers }, null, 2);
}
