import { getAvailableTools, executeTool, sanitizeSchemaForStrictAPIs } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';

export class OllamaProvider {
    constructor(config) {
        this.config = config;
        this.modelName = config.model || 'llama3';
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

    async sendMessage(message) {
        this.messages.push({ role: 'user', content: message });

        let spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
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
                spinner.stop();

                const messageObj = data.message;

                if (messageObj.content) {
                    if (this.config.useMarkedTerminal) {
                        printMarkdown(messageObj.content);
                    } else {
                        process.stdout.write(chalk.cyan(messageObj.content));
                    }
                    finalResponse += messageObj.content;
                }

                this.messages.push(messageObj);

                if (!messageObj.tool_calls || messageObj.tool_calls.length === 0) {
                    console.log();
                    break;
                }

                for (const call of messageObj.tool_calls) {
                    const fn = call.function;
                    console.log(chalk.yellow(`\n[Banana Calling Tool: ${fn.name}]`));

                    let res = await executeTool(fn.name, fn.arguments, this.config);
                    if (this.config.debug) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    console.log(chalk.yellow(`[Tool Result Received]\n`));

                    this.messages.push({
                        role: 'tool',
                        tool_call_id: call.id || 'mcp_call',
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
            }

            return finalResponse;
        } catch (err) {
            spinner.stop();
            console.error(chalk.red(`Ollama Error: ${err.message}`));
            return `Error: ${err.message}`;
        }
    }
}
