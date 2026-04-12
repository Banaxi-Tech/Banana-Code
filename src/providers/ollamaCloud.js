import { getAvailableTools, executeTool, sanitizeSchemaForStrictAPIs } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';

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

    async sendMessage(message) {
        this.messages.push({ role: 'user', content: message });

        let spinner = ora({ text: 'Thinking (Cloud)...', color: 'yellow', stream: process.stdout }).start();
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
                        model: this.modelName,
                        messages: this.messages,
                        tools: this.tools.length > 0 ? this.tools : undefined,
                        stream: true
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    spinner.stop();
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
                                    if (spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                                    if (!this.config.useMarkedTerminal) {
                                        if (this.config.isApiMode && this.onChunk) {
                                            this.onChunk(content);
                                        } else {
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
                                if (spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                                if (!this.config.useMarkedTerminal) {
                                    process.stdout.write(chalk.cyan(content));
                                }
                                currentChunkResponse += content;
                                finalResponse += content;
                            }
                        }
                    } catch (e) { }
                }

                if (spinner.isSpinning) spinner.stop();

                if (currentChunkResponse && this.config.useMarkedTerminal) {
                    printMarkdown(currentChunkResponse);
                }

                lastMessageObj.content = currentChunkResponse || '';
                this.messages.push(lastMessageObj);

                if (!lastMessageObj.tool_calls || lastMessageObj.tool_calls.length === 0) {
                    console.log();
                    break;
                }

                for (const call of lastMessageObj.tool_calls) {
                    const fn = call.function;
                    if (this.config.isApiMode && this.onToolStart) {
                        this.onToolStart(fn.name);
                    }
                    console.log(chalk.yellow(`\n[Banana Calling Tool: ${fn.name}]`));

                    let res = await executeTool(fn.name, fn.arguments, this.config);
                    if (this.config.isApiMode && this.onToolEnd) {
                        this.onToolEnd(res);
                    }
                    if (this.config.debug) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    console.log(chalk.yellow(`[Tool Result Received]\n`));

                    this.messages.push({
                        role: 'tool',
                        tool_call_id: call.id || 'mcp_call', // Use ID from call if available
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
            }

            return finalResponse;
        } catch (err) {
            if (spinner.isSpinning) spinner.stop();
            console.error(chalk.red(`Ollama Cloud Error: ${err.message}`));
            return `Error: ${err.message}`;
        }
    }
}
