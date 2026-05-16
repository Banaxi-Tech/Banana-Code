// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import OpenAI from 'openai';
import { getAvailableTools, executeTool, sanitizeSchemaForStrictAPIs } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getRandomSpinnerText } from '../utils/spinner.js';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';
import { printNewUiAssistantMarkerIfNeeded, writeNewUiAssistantChunk } from '../utils/newUi.js';
import { sendRemoteAiSegment } from '../remote.js';
import { normalizeLlamaCppBaseUrl } from '../config.js';

export class LlamaCppProvider {
    constructor(config) {
        this.config = config;
        const baseUrl = normalizeLlamaCppBaseUrl(config.llamaCppBaseUrl);
        this.openai = new OpenAI({
            apiKey: config.llamaCppApiKey || 'llama.cpp',
            baseURL: baseUrl
        });
        this.modelName = config.model || 'default';
        this.systemPrompt = getSystemPrompt(config);
        this.messages = [{ role: 'system', content: this.systemPrompt }];
        this.tools = getAvailableTools(config).map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: sanitizeSchemaForStrictAPIs(t.parameters)
            }
        }));
    }

    updateSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
        if (this.messages.length > 0 && this.messages[0].role === 'system') {
            this.messages[0].content = newPrompt;
        }
    }

    async sendMessage(input) {
        let message = '';
        let images = [];
        if (typeof input === 'string') {
            message = input;
        } else {
            message = input.text;
            images = input.images || [];
        }

        const userContent = [{ type: 'text', text: message }];
        for (const img of images) {
            userContent.push({
                type: 'image_url',
                image_url: {
                    url: `data:${img.mimeType};base64,${img.base64}`
                }
            });
        }
        this.messages.push({ role: 'user', content: userContent });

        let spinner = null;
        if (!this.config.isApiMode) {
            spinner = ora({ text: getRandomSpinnerText('llamacpp'), color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                let stream = null;
                try {
                    const params = {
                        model: this.modelName,
                        messages: this.messages,
                        tools: this.tools.length > 0 ? this.tools : undefined,
                        stream: true
                    };

                    stream = await this.openai.chat.completions.create(params);
                } catch (e) {
                    if (spinner) spinner.stop();
                    if (!this.config.isApiMode) {
                        console.error(chalk.red(`llama.cpp Request Error: ${e.message}`));
                    }
                    return `Error: ${e.message}`;
                }

                let chunkResponse = '';
                let toolCalls = [];

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;

                    if (delta?.content) {
                        if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                        if (!this.config.useMarkedTerminal) {
                            if (this.config.isApiMode) {
                                if (this.onChunk) this.onChunk(delta.content);
                            } else {
                                writeNewUiAssistantChunk(delta.content, this.config);
                            }
                        }
                        chunkResponse += delta.content;
                        finalResponse += delta.content;
                    }

                    if (delta?.tool_calls) {
                        if (spinner && spinner.isSpinning) spinner.stop();
                        for (const tc of delta.tool_calls) {
                            if (tc.index === undefined) continue;
                            if (!toolCalls[tc.index]) {
                                toolCalls[tc.index] = { id: tc.id || `call_${tc.index}`, type: 'function', function: { name: tc.function?.name || '', arguments: '' } };
                            } else {
                                if (tc.id) toolCalls[tc.index].id = tc.id;
                                if (tc.function?.name) toolCalls[tc.index].function.name = tc.function.name;
                            }
                            if (tc.function?.arguments) {
                                toolCalls[tc.index].function.arguments += tc.function.arguments;
                                if (!this.config.isApiMode) {
                                    if (!spinner || !spinner.isSpinning) {
                                        spinner = ora({ text: `Generating ${chalk.yellow(toolCalls[tc.index].function.name)} (${toolCalls[tc.index].function.arguments.length} bytes)...`, color: 'yellow', stream: process.stdout }).start();
                                    } else {
                                        spinner.text = `Generating ${chalk.yellow(toolCalls[tc.index].function.name)} (${toolCalls[tc.index].function.arguments.length} bytes)...`;
                                    }
                                }
                            }
                        }
                    }
                }
                if (spinner && spinner.isSpinning) spinner.stop();

                if (chunkResponse) {
                    if (this.config.useMarkedTerminal && !this.config.isApiMode) {
                        printNewUiAssistantMarkerIfNeeded(this.config);
                        printMarkdown(chunkResponse);
                    }
                    this.messages.push({ role: 'assistant', content: chunkResponse });
                }

                toolCalls = toolCalls.filter(Boolean);

                if (toolCalls.length === 0) {
                    if (!this.config.isApiMode) console.log();
                    break;
                }

                if (chunkResponse && !this.config.isApiMode) {
                    sendRemoteAiSegment(chunkResponse);
                }

                this.messages.push({
                    role: 'assistant',
                    tool_calls: toolCalls,
                    content: chunkResponse || null
                });

                for (const call of toolCalls) {
                    if (this.config.isApiMode && this.onToolStart) {
                        this.onToolStart(call.function.name);
                    }
                    if (!this.config.isApiMode && !this.config.newUi) {
                        console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.function.name}]`));
                    }
                    let args = {};
                    try {
                        args = JSON.parse(call.function.arguments);
                    } catch (e) {
                        if (this.config.debug) {
                            console.error(chalk.red(`Failed to parse tool arguments: ${call.function.arguments}`));
                        }
                    }

                    const res = await executeTool(call.function.name, args, this.config);
                    if (this.config.isApiMode && this.onToolEnd) {
                        this.onToolEnd(res);
                    }
                    if (this.config.debug && !this.config.isApiMode) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    if (!this.config.isApiMode && !this.config.newUi) {
                        console.log(chalk.yellow(`[Tool Result Received]\n`));
                    }

                    this.messages.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                if (!this.config.isApiMode) {
                    spinner = ora({ text: 'Processing tool results (llama.cpp)...', color: 'yellow', stream: process.stdout }).start();
                }
            }

            return finalResponse;
        } catch (err) {
            if (spinner && spinner.isSpinning) spinner.stop();

            if (!this.config.isApiMode) {
                console.error(chalk.red(`llama.cpp Runtime Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
