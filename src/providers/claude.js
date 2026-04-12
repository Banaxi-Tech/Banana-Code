import Anthropic from '@anthropic-ai/sdk';
import { getAvailableTools, executeTool } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';

export class ClaudeProvider {
    constructor(config) {
        this.config = config;
        this.anthropic = new Anthropic({ apiKey: config.apiKey });
        this.modelName = config.model || 'claude-3-7-sonnet-20250219';
        this.messages = [];
        this.tools = getAvailableTools(config).map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters
        }));
        this.systemPrompt = getSystemPrompt(config);
    }

    updateSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
    }

    async sendMessage(message) {
        this.messages.push({ role: 'user', content: message });

        let spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
        let finalResponse = '';

        try {
            while (true) {
                let stream = null;
                try {
                    stream = await this.anthropic.messages.create({
                        model: this.modelName,
                        max_tokens: 4096,
                        system: this.systemPrompt,
                        messages: this.messages,
                        tools: this.tools,
                        stream: true
                    });
                } catch (e) {
                    if (spinner.isSpinning) spinner.stop();
                    console.error(chalk.red(`Claude Request Error: ${e.message}`));
                    return `Error: ${e.message}`;
                }

                let chunkResponse = '';
                let currentToolCall = null;
                let toolCalls = [];

                for await (const event of stream) {
                    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                        if (spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                        if (!this.config.useMarkedTerminal) {
                            process.stdout.write(chalk.cyan(event.delta.text));
                        }
                        chunkResponse += event.delta.text;
                        finalResponse += event.delta.text;
                    } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
                        if (spinner.isSpinning) spinner.stop();
                        currentToolCall = {
                            id: event.content_block.id,
                            name: event.content_block.name,
                            input: ''
                        };
                    } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
                        if (currentToolCall) {
                            currentToolCall.input += event.delta.partial_json;
                            // Visual feedback for streaming tool arguments
                            if (!spinner.isSpinning) {
                                spinner = ora({ text: `Generating ${chalk.yellow(currentToolCall.name)} arguments (${currentToolCall.input.length} bytes)...`, color: 'yellow', stream: process.stdout }).start();
                            } else {
                                spinner.text = `Generating ${chalk.yellow(currentToolCall.name)} arguments (${currentToolCall.input.length} bytes)...`;
                            }
                        }
                    } else if (event.type === 'message_stop' || event.type === 'content_block_stop') {
                        if (currentToolCall) {
                            toolCalls.push(currentToolCall);
                            currentToolCall = null;
                        }
                    }
                }

                if (spinner.isSpinning) spinner.stop();

                const newContent = [];
                if (chunkResponse) {
                    if (this.config.useMarkedTerminal) printMarkdown(chunkResponse);
                    newContent.push({ type: 'text', text: chunkResponse });
                }

                for (const tc of toolCalls) {
                    try { tc.input = JSON.parse(tc.input); } catch (e) { }
                    newContent.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: tc.input
                    });
                }

                if (newContent.length > 0) {
                    this.messages.push({ role: 'assistant', content: newContent });
                }

                if (toolCalls.length === 0) {
                    console.log();
                    break;
                }

                const toolResultContent = [];
                for (const call of toolCalls) {
                    if (this.config.isApiMode && this.onToolStart) {
                        this.onToolStart(call.name);
                    }
                    console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.name}]`));
                    const res = await executeTool(call.name, call.input, this.config);
                    if (this.config.isApiMode && this.onToolEnd) {
                        this.onToolEnd(res);
                    }
                    if (this.config.debug) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    console.log(chalk.yellow(`[Tool Result Received]\n`));

                    toolResultContent.push({
                        type: 'tool_result',
                        tool_use_id: call.id,
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                this.messages.push({ role: 'user', content: toolResultContent });
                spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
            }

            return finalResponse;
        } catch (err) {
            if (spinner.isSpinning) spinner.stop();
            console.error(chalk.red(`Claude Runtime Error: ${err.message}`));
            return `Error: ${err.message}`;
        }
    }
}
