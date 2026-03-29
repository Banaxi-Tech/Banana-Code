import OpenAI from 'openai';
import { getAvailableTools, executeTool } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import os from 'os';
import path from 'path';
import fsSync from 'fs';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';

export class OpenAIProvider {
    constructor(config) {
        this.config = config;
        if (config.authType !== 'oauth') {
            this.openai = new OpenAI({ apiKey: config.apiKey });
        }
        this.modelName = config.model || 'gpt-4o';
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

    async sendMessage(message) {
        if (this.config.authType === 'oauth') {
            return await this.sendOauthMessage(message);
        }

        this.messages.push({ role: 'user', content: message });

        let spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
        let finalResponse = '';

        try {
            while (true) {
                let stream = null;
                try {
                    stream = await this.openai.chat.completions.create({
                        model: this.modelName,
                        messages: this.messages,
                        tools: this.tools,
                        stream: true
                    });
                } catch (e) {
                    spinner.stop();
                    console.error(chalk.red(`OpenAI Request Error: ${e.message}`));
                    return `Error: ${e.message}`;
                }

                let chunkResponse = '';
                let toolCalls = [];

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;

                    if (delta?.content) {
                        if (spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                        if (!this.config.useMarkedTerminal) {
                            process.stdout.write(chalk.cyan(delta.content));
                        }
                        chunkResponse += delta.content;
                        finalResponse += delta.content;
                    }

                    if (delta?.tool_calls) {
                        if (spinner.isSpinning) spinner.stop();
                        for (const tc of delta.tool_calls) {
                            if (tc.index === undefined) continue;
                            if (!toolCalls[tc.index]) {
                                toolCalls[tc.index] = { id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } };
                            }
                            if (tc.function?.arguments) {
                                toolCalls[tc.index].function.arguments += tc.function.arguments;
                                // Visual feedback for streaming tool arguments
                                if (!spinner.isSpinning) {
                                    spinner = ora({ text: `Generating ${chalk.yellow(toolCalls[tc.index].function.name)} (${toolCalls[tc.index].function.arguments.length} bytes)...`, color: 'yellow', stream: process.stdout }).start();
                                } else {
                                    spinner.text = `Generating ${chalk.yellow(toolCalls[tc.index].function.name)} (${toolCalls[tc.index].function.arguments.length} bytes)...`;
                                }
                            }
                        }
                    }
                }
                if (spinner.isSpinning) spinner.stop();

                if (chunkResponse) {
                    if (this.config.useMarkedTerminal) printMarkdown(chunkResponse);
                    this.messages.push({ role: 'assistant', content: chunkResponse });
                }

                toolCalls = toolCalls.filter(Boolean);

                if (toolCalls.length === 0) {
                    console.log();
                    break;
                }

                this.messages.push({
                    role: 'assistant',
                    tool_calls: toolCalls,
                    content: chunkResponse || null
                });

                for (const call of toolCalls) {
                    console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.function.name}]`));
                    let args = {};
                    try {
                        args = JSON.parse(call.function.arguments);
                    } catch (e) { }

                    const res = await executeTool(call.function.name, args);
                    if (this.config.debug) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    console.log(chalk.yellow(`[Tool Result Received]\n`));

                    this.messages.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
            }

            return finalResponse;
        } catch (err) {
            if (spinner && spinner.isSpinning) spinner.stop();
            console.error(chalk.red(`OpenAI Runtime Error: ${err.message}`));
            return `Error: ${err.message}`;
        }
    }

    async sendOauthMessage(message) {
        this.messages.push({ role: 'user', content: message });

        const authFile = path.join(os.homedir(), '.codex', 'auth.json');
        let accessToken, accountId;
        try {
            const data = fsSync.readFileSync(authFile, 'utf-8');
            const session = JSON.parse(data);
            accessToken = session?.tokens?.access_token || session.access_token || session.accessToken;
            accountId = session?.tokens?.account_id || session.account_id;
            if (!accessToken || !accountId) throw new Error("Token or Account ID missing");
        } catch (e) {
            console.error(chalk.red("\nCodex auth token not found. Please quit 'banana', delete ~/.config/banana-code/config.json, and run setup again."));
            return "Error: Codex auth token not found.";
        }

        const mapMessagesToBackend = (messages) => {
            const result = [];
            // Skip the first system message as it goes into 'instructions'
            const history = messages.slice(1);

            for (const msg of history) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    if (msg.tool_calls) {
                        // Add the assistant message with tool calls
                        for (const tc of msg.tool_calls) {
                            result.push({
                                type: 'function_call',
                                name: tc.function.name,
                                call_id: tc.id,
                                arguments: tc.function.arguments
                            });
                        }
                    } else if (msg.content) {
                        const contentType = msg.role === 'assistant' ? 'output_text' : 'input_text';
                        result.push({
                            type: 'message',
                            role: msg.role,
                            content: [{ type: contentType, text: msg.content }]
                        });
                    }
                } else if (msg.role === 'tool') {
                    result.push({
                        type: 'function_call_output',
                        call_id: msg.tool_call_id,
                        output: msg.content
                    });
                }
            }
            return result;
        };

        const mapToolsToBackend = (tools) => {
            return tools.map(t => {
                const f = t.function;
                return {
                    type: 'function',
                    name: f.name,
                    description: f.description,
                    parameters: f.parameters
                };
            });
        };

        let spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
        let finalResponse = '';

        try {
            while (true) {
                const backendInput = mapMessagesToBackend(this.messages);
                const backendTools = mapToolsToBackend(this.tools);

                const payload = {
                    model: this.modelName || 'gpt-5.1-codex',
                    instructions: this.systemPrompt,
                    input: backendInput,
                    tools: backendTools,
                    store: false,
                    stream: true,
                    include: ["reasoning.encrypted_content"],
                    reasoning: { effort: "medium", summary: "auto" },
                    text: { verbosity: "medium" }
                };

                const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'chatgpt-account-id': accountId,
                        'OpenAI-Beta': 'responses=experimental',
                        'originator': 'codex_cli_rs',
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    spinner.stop();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let currentChunkResponse = '';
                let currentToolCall = null;
                let activeToolCalls = [];
                let currentEvent = '';
                let currentDataBuffer = '';
                let lineBuffer = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    lineBuffer += chunk;
                    const lines = lineBuffer.split('\n');
                    lineBuffer = lines.pop(); // Keep partial line for next chunk

                    for (const line of lines) {
                        if (line.trim() === '') {
                            if (currentEvent && currentDataBuffer) {
                                try {
                                    const data = JSON.parse(currentDataBuffer);
                                    if (currentEvent === 'response.output_text.delta') {
                                        if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                                        if (!this.config.useMarkedTerminal) {
                                            process.stdout.write(chalk.cyan(data.delta));
                                        }
                                        currentChunkResponse += data.delta;
                                        finalResponse += data.delta;
                                    } else if (currentEvent === 'response.reasoning.delta' || currentEvent === 'response.reasoning_text.delta' || currentEvent.includes('reasoning.delta')) {
                                        if (this.config.debug && data.delta) {
                                            if (spinner && spinner.isSpinning) spinner.stop();
                                            process.stdout.write(chalk.gray(data.delta));
                                        }
                                    } else if (currentEvent === 'response.output_item.added' && data.item?.type === 'function_call') {
                                        if (spinner && spinner.isSpinning) spinner.stop();
                                        currentToolCall = {
                                            id: data.item.call_id,
                                            name: data.item.name,
                                            arguments: ''
                                        };
                                    } else if (currentEvent === 'response.function_call_arguments.delta' && currentToolCall) {
                                        currentToolCall.arguments += data.delta;
                                        // Visual feedback for streaming tool arguments
                                        if (!spinner.isSpinning) {
                                            spinner = ora({ text: `Generating ${chalk.yellow(currentToolCall.name)} (${currentToolCall.arguments.length} bytes)...`, color: 'yellow', stream: process.stdout }).start();
                                        } else {
                                            spinner.text = `Generating ${chalk.yellow(currentToolCall.name)} arguments (${currentToolCall.arguments.length} bytes)...`;
                                        }
                                    } else if (currentEvent === 'response.output_item.done' && data.item?.type === 'function_call' && currentToolCall) {
                                        if (spinner && spinner.isSpinning) spinner.stop();
                                        activeToolCalls.push({
                                            id: currentToolCall.id,
                                            type: 'function',
                                            function: {
                                                name: currentToolCall.name,
                                                arguments: currentToolCall.arguments
                                            }
                                        });
                                        currentToolCall = null;
                                    }
                                } catch (e) { }
                                currentDataBuffer = '';
                            }
                            continue;
                        }

                        if (line.startsWith('event: ')) {
                            currentEvent = line.substring(7).trim();
                            currentDataBuffer = '';
                        } else if (line.startsWith('data: ')) {
                            currentDataBuffer += line.substring(6).trim();
                        }
                    }
                }
                // Process any remaining line in buffer
                if (lineBuffer.trim()) {
                    const line = lineBuffer;
                    if (line.startsWith('event: ')) {
                        currentEvent = line.substring(7).trim();
                        currentDataBuffer = '';
                    } else if (line.startsWith('data: ')) {
                        currentDataBuffer += line.substring(6).trim();
                    }
                    if (currentEvent && currentDataBuffer) {
                        try {
                            const data = JSON.parse(currentDataBuffer);
                            if (currentEvent === 'response.output_text.delta') {
                                if (spinner.isSpinning) spinner.stop();
                                process.stdout.write(chalk.cyan(data.delta));
                                currentChunkResponse += data.delta;
                                finalResponse += data.delta;
                            }
                        } catch (e) { }
                    }
                }
                // Also stop spinner at the very end of the stream just in case
                if (spinner.isSpinning) spinner.stop();

                if (currentChunkResponse) {
                    if (this.config.useMarkedTerminal) printMarkdown(currentChunkResponse);
                    this.messages.push({ role: 'assistant', content: currentChunkResponse });
                }

                if (activeToolCalls.length === 0) {
                    console.log();
                    break;
                }

                this.messages.push({
                    role: 'assistant',
                    tool_calls: activeToolCalls,
                    content: currentChunkResponse || null
                });

                for (const call of activeToolCalls) {
                    console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.function.name}]`));
                    let args = {};
                    try {
                        args = JSON.parse(call.function.arguments);
                    } catch (e) { }

                    const res = await executeTool(call.function.name, args);
                    if (this.config.debug) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    console.log(chalk.yellow(`[Tool Result Received]\n`));

                    this.messages.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
            }

            return finalResponse;

        } catch (err) {
            if (spinner && spinner.isSpinning) spinner.stop();
            console.error(chalk.red(`OpenAI Codex Error: ${err.message}`));
            return `Error: ${err.message}`;
        }
    }
}
