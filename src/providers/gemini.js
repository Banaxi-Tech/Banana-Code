import { getAvailableTools, executeTool, sanitizeSchemaForStrictAPIs } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';

export class GeminiProvider {
    constructor(config) {
        this.config = config;
        this.apiKey = config.apiKey;
        this.modelName = config.model || 'gemini-2.5-flash';
        this.messages = [];
        this.tools = getAvailableTools(config).map(t => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeSchemaForStrictAPIs(t.parameters)
        }));
        this.systemPrompt = getSystemPrompt(config);
    }

    updateSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
    }

    async sendMessage(message) {
        this.messages.push({ role: 'user', parts: [{ text: message }] });

        let spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
        let responseText = '';

        try {
            while (true) {
                let currentTurnText = '';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:streamGenerateContent?alt=sse&key=${this.apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: this.messages,
                        systemInstruction: { parts: [{ text: this.systemPrompt }] },
                        tools: [{ functionDeclarations: this.tools }]
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = '';

                let aggregatedParts = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (value) {
                        buffer += decoder.decode(value, { stream: true });
                    }

                    buffer = buffer.replace(/\r\n/g, '\n');
                    let sseParts = buffer.split('\n\n');

                    if (!done) {
                        buffer = sseParts.pop() || '';
                    } else {
                        buffer = '';
                    }

                    for (const ssePart of sseParts) {
                        const line = ssePart.trim();
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6).trim();
                            if (dataStr === '[DONE]' || !dataStr) continue;

                            let data;
                            try { data = JSON.parse(dataStr); } catch (e) { continue; }

                            const content = data.candidates?.[0]?.content;
                            if (content && content.parts) {
                                for (const part of content.parts) {
                                    if (part.text) {
                                        if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                                        if (!this.config.useMarkedTerminal) {
                                            process.stdout.write(chalk.cyan(part.text));
                                        }
                                        responseText += part.text;
                                        currentTurnText += part.text;

                                        // Aggregate sequential text parts
                                        let lastPart = aggregatedParts[aggregatedParts.length - 1];
                                        if (lastPart && lastPart.text !== undefined) {
                                            lastPart.text += part.text;
                                        } else {
                                            aggregatedParts.push({ text: part.text });
                                        }
                                    } else if (part.functionCall) {
                                        if (spinner && spinner.isSpinning) spinner.stop();
                                        aggregatedParts.push(part);

                                        // Visual feedback for streaming tool arguments
                                        const call = part.functionCall;
                                        const argSize = JSON.stringify(call.args || {}).length;
                                        if (!spinner.isSpinning) {
                                            spinner = ora({ text: `Generating ${chalk.yellow(call.name)} arguments (${argSize} bytes)...`, color: 'yellow', stream: process.stdout }).start();
                                        } else {
                                            spinner.text = `Generating ${chalk.yellow(call.name)} arguments (${argSize} bytes)...`;
                                        }
                                    } else {
                                        aggregatedParts.push(part);
                                    }
                                }
                            }
                        }
                    }
                    if (done) break;
                }

                if (spinner && spinner.isSpinning) spinner.stop();

                if (currentTurnText && this.config.useMarkedTerminal) {
                    printMarkdown(currentTurnText);
                }

                if (aggregatedParts.length === 0) break;

                // Push exact unmutated model response back to history
                this.messages.push({ role: 'model', parts: aggregatedParts });

                let hasToolCalls = false;
                let toolResults = [];

                for (const part of aggregatedParts) {
                    if (part.functionCall) {
                        hasToolCalls = true;
                        const call = part.functionCall;
                        console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.name}]`));
                        const res = await executeTool(call.name, call.args, this.config);
                        if (this.config.debug) {
                            console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                        }
                        console.log(chalk.yellow(`[Tool Result Received]\n`));

                        toolResults.push({
                            functionResponse: {
                                name: call.name,
                                response: { result: res }
                            }
                        });
                    }
                }

                if (!hasToolCalls) break;

                this.messages.push({ role: 'user', parts: toolResults });
                spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
            }

            console.log(); // Newline after stream
            return responseText;
        } catch (err) {
            if (spinner && spinner.isSpinning) spinner.stop();
            console.error(chalk.red(`Gemini Error: ${err.message}`));
            return `Error: ${err.message}`;
        }
    }
}
