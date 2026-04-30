// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { getAvailableTools, executeTool, sanitizeSchemaForStrictAPIs } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getRandomSpinnerText } from '../utils/spinner.js';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';
import { OLLAMA_CLOUD_MODELS } from '../constants.js';
import { AUTO_MODEL_DESCRIPTIONS, AUTO_ROUTER_MODELS, buildRoutingPrompt, parseRoutingResponse, openAIMessagesToAutoRouterHistory } from '../utils/autoModel.js';
import { sendRemoteAiSegment } from '../remote.js';

export class OllamaCloudProvider {
    constructor(config) {
        this.config = config;
        this.apiKey = config.apiKey;
        this.modelName = config.model || 'llama3.3';
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
        this.URL = 'https://ollama.com/api/chat';
    }

    updateSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
        if (this.messages.length > 0 && this.messages[0].role === 'system') {
            this.messages[0].content = newPrompt;
        }
    }

    async autoRoute(message) {
        const historyText = openAIMessagesToAutoRouterHistory(this.messages || []);
        const models = OLLAMA_CLOUD_MODELS.map(m => ({
            id: m.value,
            description: AUTO_MODEL_DESCRIPTIONS[m.value] || m.name
        }));
        const prompt = buildRoutingPrompt(models, message, historyText);
        try {
            const resp = await fetch(this.URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: AUTO_ROUTER_MODELS.ollama_cloud,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false
                })
            });
            const data = await resp.json();
            const text = data.message?.content || '';
            const result = parseRoutingResponse(text);
            if (result && models.some(m => m.id === result.model)) return result;
        } catch (e) {}
        return { model: OLLAMA_CLOUD_MODELS[0].value, reason: 'Auto-routing failed, using most capable model.' };
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

        const userMessage = { 
            role: 'user', 
            content: message 
        };
        if (images.length > 0) {
            userMessage.images = images.map(img => img.base64);
        }
        this.messages.push(userMessage);

        let spinner = null;
        if (!this.config.isApiMode) {
            spinner = ora({ text: getRandomSpinnerText('ollamaCloud'), color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                const response = await fetch(this.URL, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify({
                        model: activeModel,
                        messages: this.messages,
                        tools: this.tools.length > 0 ? this.tools : undefined,
                        stream: true
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    if (spinner) spinner.stop();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let currentChunkResponse = '';
                let lastMessageObj = { role: 'assistant', content: '' };
                let lineBuffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    lineBuffer += chunk;
                    const lines = lineBuffer.split('\n');
                    lineBuffer = lines.pop(); // Keep partial line

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const data = JSON.parse(line);
                            if (data.message) {
                                if (data.message.tool_calls) {
                                    lastMessageObj.tool_calls = data.message.tool_calls;
                                }
                                if (data.message.content) {
                                    const content = data.message.content;
                                    if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                                    if (!this.config.useMarkedTerminal) {
                                        if (this.config.isApiMode && this.onChunk) {
                                            this.onChunk(content);
                                        } else if (!this.config.isApiMode) {
                                            process.stdout.write(chalk.cyan(content));
                                        }
                                    }
                                    currentChunkResponse += content;
                                    finalResponse += content;
                                }
                            }
                        } catch (e) { }
                    }
                }

                if (lineBuffer.trim()) {
                    try {
                        const data = JSON.parse(lineBuffer);
                        if (data.message) {
                            if (data.message.tool_calls) {
                                lastMessageObj.tool_calls = data.message.tool_calls;
                            }
                            if (data.message.content) {
                                const content = data.message.content;
                                if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                                if (!this.config.useMarkedTerminal) {
                                    if (this.config.isApiMode && this.onChunk) {
                                        this.onChunk(content);
                                    } else if (!this.config.isApiMode) {
                                        process.stdout.write(chalk.cyan(content));
                                    }
                                }
                                currentChunkResponse += content;
                                finalResponse += content;
                            }
                        }
                    } catch (e) { }
                }

                if (spinner && spinner.isSpinning) spinner.stop();

                if (currentChunkResponse && this.config.useMarkedTerminal && !this.config.isApiMode) {
                    printMarkdown(currentChunkResponse);
                }

                lastMessageObj.content = currentChunkResponse || '';
                this.messages.push(lastMessageObj);

                if (!lastMessageObj.tool_calls || lastMessageObj.tool_calls.length === 0) {
                    if (!this.config.isApiMode) console.log();
                    break;
                }

                if (currentChunkResponse && !this.config.isApiMode) {
                    sendRemoteAiSegment(currentChunkResponse);
                }

                for (const call of lastMessageObj.tool_calls) {
                    const fn = call.function;
                    if (this.config.isApiMode && this.onToolStart) {
                        this.onToolStart(fn.name);
                    }
                    if (!this.config.isApiMode) {
                        console.log(chalk.yellow(`\n[Banana Calling Tool: ${fn.name}]`));
                    }

                    let res = await executeTool(fn.name, fn.arguments, this.config);
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
                        tool_call_id: call.id || 'mcp_call', // Use ID from call if available
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
                console.error(chalk.red(`Ollama Cloud Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
