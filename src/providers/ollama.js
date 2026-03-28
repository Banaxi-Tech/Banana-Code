import { getAvailableTools, executeTool } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';

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
                parameters: t.parameters
            }
        }));
        this.URL = 'http://localhost:11434/api/chat';
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
                        tools: this.tools,
                        stream: false
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                spinner.stop();

                const messageObj = data.message;

                if (messageObj.content) {
                    process.stdout.write(chalk.cyan(messageObj.content));
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

                    let res = await executeTool(fn.name, fn.arguments);
                    if (this.config.debug) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    console.log(chalk.yellow(`[Tool Result Received]\n`));

                    this.messages.push({
                        role: 'tool',
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
