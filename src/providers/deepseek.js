// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import OpenAI from 'openai';
import { getAvailableTools, executeTool } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getRandomSpinnerText } from '../utils/spinner.js';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';
import { DEEPSEEK_MODELS } from '../constants.js';
import { AUTO_MODEL_DESCRIPTIONS, AUTO_ROUTER_MODELS, buildRoutingPrompt, parseRoutingResponse, openAIMessagesToAutoRouterHistory } from '../utils/autoModel.js';
import { sendRemoteAiSegment } from '../remote.js';

function formatDeepSeekError(error) {
    let message = error.message || String(error);
    if (error.error?.message) {
        message += ` - ${error.error.message}`;
    } else if (error.response?.data) {
        try {
            message += ` - ${JSON.stringify(error.response.data)}`;
        } catch (err) {}
    }
    return message;
}

export class DeepSeekProvider {
    constructor(config) {
        this.config = config;
        this.openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.deepseek.com'
        });
        this.modelName = config.model || 'deepseek-v4-flash';
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
        const models = DEEPSEEK_MODELS.map(m => ({
            id: m.value,
            description: AUTO_MODEL_DESCRIPTIONS[m.value] || m.name
        }));
        const prompt = buildRoutingPrompt(models, message, historyText);

        try {
            const resp = await this.openai.chat.completions.create({
                model: AUTO_ROUTER_MODELS.deepseek,
                messages: [{ role: 'user', content: prompt }],
                thinking: { type: 'disabled' },
                stream: false
            });
            const text = resp.choices[0]?.message?.content || '';
            const result = parseRoutingResponse(text);
            if (result && models.some(m => m.id === result.model)) return result;
        } catch (e) {}

        return { model: 'deepseek-v4-flash', reason: 'Auto-routing failed, using DeepSeek V4 Flash.' };
    }

    buildRequestParams(activeModel) {
        return {
            model: activeModel,
            messages: this.messages,
            tools: this.tools.length > 0 ? this.tools : undefined,
            reasoning_effort: 'high',
            thinking: { type: 'enabled' },
            stream: true
        };
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
                console.log(chalk.magenta(`\n[Auto Mode] -> ${chalk.yellow(activeModel)}: ${routing.reason}`));
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
            spinner = ora({ text: getRandomSpinnerText('deepseek'), color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                let stream = null;
                try {
                    stream = await this.openai.chat.completions.create(this.buildRequestParams(activeModel));
                } catch (e) {
                    if (spinner) spinner.stop();
                    const errMsg = formatDeepSeekError(e);
                    if (!this.config.isApiMode) {
                        console.error(chalk.red(`DeepSeek Request Error: ${errMsg}`));
                    }
                    return `Error: ${errMsg}`;
                }

                let chunkResponse = '';
                let reasoningContent = '';
                let toolCalls = [];

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta || {};

                    if (delta.reasoning_content) {
                        reasoningContent += delta.reasoning_content;
                    }

                    if (delta.content) {
                        if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                        if (!this.config.useMarkedTerminal) {
                            if (this.config.isApiMode && this.onChunk) {
                                this.onChunk(delta.content);
                            } else if (!this.config.isApiMode) {
                                process.stdout.write(chalk.cyan(delta.content));
                            }
                        }
                        chunkResponse += delta.content;
                        finalResponse += delta.content;
                    }

                    if (delta.tool_calls) {
                        if (spinner && spinner.isSpinning) spinner.stop();
                        for (const tc of delta.tool_calls) {
                            if (tc.index === undefined) continue;
                            if (!toolCalls[tc.index]) {
                                toolCalls[tc.index] = { id: tc.id, type: 'function', function: { name: tc.function?.name || '', arguments: '' } };
                            }
                            if (tc.id) toolCalls[tc.index].id = tc.id;
                            if (tc.function?.name && !toolCalls[tc.index].function.name) {
                                toolCalls[tc.index].function.name = tc.function.name;
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

                toolCalls = toolCalls.filter(Boolean);

                if (toolCalls.length === 0) {
                    if (chunkResponse) {
                        if (this.config.useMarkedTerminal && !this.config.isApiMode) printMarkdown(chunkResponse);
                        this.messages.push({ role: 'assistant', content: chunkResponse });
                    }
                    if (!this.config.isApiMode) console.log();
                    break;
                }

                if (chunkResponse && this.config.useMarkedTerminal && !this.config.isApiMode) {
                    printMarkdown(chunkResponse);
                }
                if (chunkResponse && !this.config.isApiMode) {
                    sendRemoteAiSegment(chunkResponse);
                }

                const assistantMessage = {
                    role: 'assistant',
                    content: chunkResponse || '',
                    tool_calls: toolCalls
                };
                if (reasoningContent) {
                    assistantMessage.reasoning_content = reasoningContent;
                }
                this.messages.push(assistantMessage);

                for (const call of toolCalls) {
                    if (this.config.isApiMode && this.onToolStart) {
                        this.onToolStart(call.function.name);
                    }
                    if (!this.config.isApiMode) {
                        console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.function.name}]`));
                    }
                    let args = {};
                    try {
                        args = JSON.parse(call.function.arguments);
                    } catch (e) {}

                    const res = await executeTool(call.function.name, args, this.config);
                    if (this.config.isApiMode && this.onToolEnd) {
                        this.onToolEnd(res);
                    }
                    if (this.config.debug && !this.config.isApiMode) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    if (!this.config.isApiMode) {
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
                console.error(chalk.red(`DeepSeek Runtime Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
