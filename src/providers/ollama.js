import { getAvailableTools, executeTool, sanitizeSchemaForStrictAPIs } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';

export class OllamaProvider {
    constructor(config) {
        this.config = config;
        this.modelName = config.model === 'auto' ? 'llama3' : (config.model || 'llama3');
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
        this.URL = 'http://localhost:11434/api/chat';
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
            spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                const response = await fetch(this.URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: this.modelName,
                        messages: this.messages,
                        tools: this.tools.length > 0 ? this.tools : undefined,
                        stream: false
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
                }

                const data = await response.json();
                if (spinner) spinner.stop();

                const messageObj = data.message;

                if (messageObj.content) {
                    if (this.config.useMarkedTerminal && !this.config.isApiMode) {
                        printMarkdown(messageObj.content);
                    } else if (!this.config.isApiMode) {
                        process.stdout.write(chalk.cyan(messageObj.content));
                    }
                    finalResponse += messageObj.content;
                }

                this.messages.push(messageObj);

                if (!messageObj.tool_calls || messageObj.tool_calls.length === 0) {
                    if (!this.config.isApiMode) console.log();
                    break;
                }

                for (const call of messageObj.tool_calls) {
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
                        tool_call_id: call.id || 'mcp_call',
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                if (!this.config.isApiMode) {
                    spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
                }
            }

            return finalResponse;
        } catch (err) {
            if (spinner) spinner.stop();
            if (!this.config.isApiMode) {
                console.error(chalk.red(`Ollama Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
