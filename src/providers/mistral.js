// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import OpenAI from 'openai';
import { getAvailableTools, executeTool } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getRandomSpinnerText } from '../utils/spinner.js';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';
import { printNewUiAssistantMarkerIfNeeded, writeNewUiAssistantChunk } from '../utils/newUi.js';
import { MISTRAL_MODELS } from '../constants.js';
import { AUTO_MODEL_DESCRIPTIONS, AUTO_ROUTER_MODELS, buildRoutingPrompt, parseRoutingResponse, openAIMessagesToAutoRouterHistory } from '../utils/autoModel.js';
import { sendRemoteAiSegment } from '../remote.js';
import { getActiveModelForNextRequest } from '../utils/modelSwitch.js';

export class MistralProvider {
    constructor(config) {
        this.config = config;
        this.openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.mistral.ai/v1'
        });
        this.modelName = config.model || 'mistral-large-latest';
        this.systemPrompt = getSystemPrompt(config);
        this.messages = [{ role: 'system', content: this.systemPrompt }];
        this.tools = getAvailableTools(config).map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters
            }
        }));
    }

    updateSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
        if (this.messages.length > 0 && this.messages[0].role === 'system') {
            this.messages[0].content = newPrompt;
        }
    }

    async autoRoute(message) {
        const historyText = openAIMessagesToAutoRouterHistory(this.messages || []);
        const models = MISTRAL_MODELS.map(m => ({
            id: m.value,
            description: AUTO_MODEL_DESCRIPTIONS[m.value] || m.name
        }));
        const prompt = buildRoutingPrompt(models, message, historyText);
        try {
            const resp = await this.openai.chat.completions.create({
                model: AUTO_ROUTER_MODELS.mistral,
                messages: [{ role: 'user', content: prompt }],
                stream: false
            });
            const text = resp.choices[0]?.message?.content || '';
            const result = parseRoutingResponse(text);
            if (result && models.some(m => m.id === result.model)) return result;
        } catch (e) {}
        return { model: MISTRAL_MODELS[0].value, reason: 'Auto-routing failed, using most capable model.' };
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

        let activeModel = this.modelName;
        if (this.modelName === 'auto') {
            const routing = await this.autoRoute(message);
            activeModel = routing.model;
            if (!this.config.isApiMode) {
                console.log(chalk.magenta(`\n[Auto Mode] → ${chalk.yellow(activeModel)}: ${routing.reason}`));
            }
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
            spinner = ora({ text: getRandomSpinnerText('mistral'), color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                let stream = null;
                try {
                    activeModel = getActiveModelForNextRequest(this, activeModel);
                    stream = await this.openai.chat.completions.create({
                        model: activeModel,
                        messages: this.messages,
                        tools: this.tools.length > 0 ? this.tools : undefined,
                        stream: true
                    });
                } catch (e) {
                    if (spinner) spinner.stop();
                    if (!this.config.isApiMode) {
                        console.error(chalk.red(`Mistral Request Error: ${e.message}`));
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
                            if (this.config.isApiMode && this.onChunk) {
                                this.onChunk(delta.content);
                            } else if (!this.config.isApiMode) {
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
                                toolCalls[tc.index] = { id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } };
                            }
                            if (tc.function?.arguments) {
                                toolCalls[tc.index].function.arguments += tc.function.arguments;
                                // Visual feedback for streaming tool arguments
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
                    } catch (e) { }

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
                    spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
                }
            }

            return finalResponse;
        } catch (err) {
            if (spinner && spinner.isSpinning) spinner.stop();
            if (!this.config.isApiMode) {
                console.error(chalk.red(`Mistral Runtime Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
