import Anthropic from '@anthropic-ai/sdk';
import { getAvailableTools, executeTool } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';
import { CLAUDE_MODELS, CLAUDE_PRICING } from '../constants.js';
import { AUTO_MODEL_DESCRIPTIONS, AUTO_ROUTER_MODELS, buildRoutingPrompt, parseRoutingResponse, claudeMessagesToAutoRouterHistory } from '../utils/autoModel.js';

export class ClaudeProvider {
    constructor(config) {
        this.config = config;
        this.anthropic = new Anthropic({ apiKey: config.apiKey });
        
        this.modelName = config.model || 'claude-sonnet-4-6';
        this.isFastMode = this.modelName.endsWith('-fast');
        // The base model ID used for API calls (without the internal -fast suffix)
        this.activeApiModel = this.isFastMode ? this.modelName.replace('-fast', '') : this.modelName;

        this.messages = [];
        this.tools = getAvailableTools(config).map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters
        }));
        this.systemPrompt = getSystemPrompt(config);

        // Track session-wide financial data
        this.sessionCost = 0;
        this.sessionSavings = 0;

        // Still track raw tokens for /context display
        this.sessionUsage = {
            input: 0,
            output: 0,
            cacheWrite: 0,
            cacheRead: 0
        };
    }
    updateSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
    }

    /**
     * Calculates and adds the cost of a turn to the session totals.
     * @param {Object} usage - The usage object from Anthropic API
     * @param {string} model - The specific model used for this turn
     */
    addUsage(usage, model) {
        if (!usage) return;
        const p = CLAUDE_PRICING[model] || CLAUDE_PRICING['claude-sonnet-4-6'];

        const input = usage.input_tokens || 0;
        const output = usage.output_tokens || 0;
        const cacheWrite = usage.cache_creation_input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;

        // Add to raw token counts
        this.sessionUsage.input += input;
        this.sessionUsage.output += output;
        this.sessionUsage.cacheWrite += cacheWrite;
        this.sessionUsage.cacheRead += cacheRead;

        // Calculate dollar cost for THIS turn
        const turnCost = (
            (input * p.input) + 
            (output * p.output) + 
            (cacheWrite * p.cacheWrite) + 
            (cacheRead * p.cacheRead)
        ) / 1000000;

        // Calculate what it WOULD have cost without caching
        const totalInput = input + cacheWrite + cacheRead;
        const turnWithoutCaching = ((totalInput * p.input) + (output * p.output)) / 1000000;

        this.sessionCost += turnCost;
        this.sessionSavings += Math.max(0, turnWithoutCaching - turnCost);
    }

    /**
     * Calculates the estimated cost and savings for the current session based on real API usage.
     */
    calculateSessionCost() {
        return {
            cost: this.sessionCost.toFixed(4),
            savings: this.sessionSavings.toFixed(4),
            rawCost: this.sessionCost
        };
    }

    async autoRoute(message) {
        const historyText = claudeMessagesToAutoRouterHistory(this.messages || []);
        const models = CLAUDE_MODELS.map(m => ({
            id: m.value,
            description: AUTO_MODEL_DESCRIPTIONS[m.value] || m.name
        }));
        const prompt = buildRoutingPrompt(models, message, historyText, 'claude');
        try {
            const resp = await this.anthropic.messages.create({
                model: AUTO_ROUTER_MODELS.claude,
                max_tokens: 256,
                messages: [{ role: 'user', content: prompt }]
            });

            // Track usage for the routing request (using the router model's price)
            this.addUsage(resp.usage, AUTO_ROUTER_MODELS.claude);

            const text = resp.content[0]?.text || '';
            const result = parseRoutingResponse(text);
            if (result && models.some(m => m.id === result.model)) return result;
        } catch (e) {}
        return { model: CLAUDE_MODELS[0].value, effort: 'high', reason: 'Auto-routing failed, using most capable model.' };
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
        let activeEffort = this.config.claudeEffort || 'high';

        if (this.modelName === 'auto') {
            const routing = await this.autoRoute(message);
            activeModel = routing.model;
            activeEffort = routing.effort || 'high';
            if (!this.config.isApiMode) {
                console.log(chalk.magenta(`\n[Auto Mode] → ${chalk.yellow(activeModel)} (Effort: ${chalk.yellow(activeEffort.toUpperCase())}): ${routing.reason}`));
            }
        }

        const userContent = [];
        if (message) {
            userContent.push({ type: 'text', text: message });
        }
        for (const img of images) {
            userContent.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: img.mimeType,
                    data: img.base64
                }
            });
        }
        this.messages.push({ role: 'user', content: userContent });

        let spinner = null;
        if (!this.config.isApiMode) {
            spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                let stream = null;
                try {
                    // Translate our internal virtual model IDs (like *-fast) back to 
                    // official Anthropic model IDs before sending the request.
                    const cacheObj = this.config.useExtendedCache ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
                    const params = {
                        model: activeModel === 'auto' ? activeModel : (activeModel.endsWith('-fast') ? activeModel.replace('-fast', '') : activeModel),
                        max_tokens: 8192,
                        system: [
                            {
                                type: 'text',
                                text: this.systemPrompt,
                                cache_control: cacheObj
                            }
                        ],
                        messages: this.messages.map((msg, idx) => {
                            // Add a cache breakpoint to the very last message in history
                            // This ensures the entire conversation up to the last turn is cached
                            if (idx === this.messages.length - 1) {
                                if (typeof msg.content === 'string') {
                                    return { ...msg, content: [{ type: 'text', text: msg.content, cache_control: cacheObj }] };
                                } else if (Array.isArray(msg.content)) {
                                    const newContent = [...msg.content];
                                    const lastTextPart = [...newContent].reverse().find(p => p.type === 'text');
                                    if (lastTextPart) {
                                        lastTextPart.cache_control = cacheObj;
                                    }
                                    return { ...msg, content: newContent };
                                }
                            }
                            return msg;
                        }),
                        tools: this.tools,
                        stream: true
                    };

                    // Enable Fast Mode if selected
                    if (activeModel.endsWith('-fast')) {
                        params.speed = 'fast';
                        // Use a local copy or ensures headers are sent via constructor config if using higher-level SDK
                        // For this SDK version, we add the beta header to the request
                        params.betas = (params.betas || []).concat(['fast-mode-2026-02-01']);
                    }

                    // Apply reasoning effort for models that support output_config
                    const modelCheck = params.model;
                    if (modelCheck.includes('opus-4') || modelCheck.includes('sonnet-4')) {
                        params.output_config = {
                            effort: activeEffort
                        };
                    }

                    // Enable adaptive thinking for latest Claude 4.x models
                    if (activeModel.includes('opus-4') || activeModel.includes('sonnet-4')) {
                        params.thinking = { type: 'adaptive' };
                    } else if (activeModel.includes('haiku-4-5')) {
                        // Haiku 4.5 supports manual thinking with a budget but not adaptive yet
                        params.thinking = { type: 'enabled', budget_tokens: 4096 };
                    }

                    stream = await this.anthropic.messages.create(params);
                } catch (e) {
                    if (spinner && spinner.isSpinning) spinner.stop();
                    if (!this.config.isApiMode) {
                        console.error(chalk.red(`Claude Request Error: ${e.message}`));
                    }
                    return `Error: ${e.message}`;
                }

                let chunkResponse = '';
                let currentToolCall = null;
                let toolCalls = [];
                let hasFinishedThinking = false;
                let accumulatedThinking = '';
                let accumulatedSignature = '';

                for await (const event of stream) {
                    if (event.type === 'message_start') {
                        // Capture initial input usage
                        this.addUsage(event.message.usage, activeModel);
                    } else if (event.type === 'message_delta') {
                        // Capture final output usage
                        this.addUsage(event.usage, activeModel);
                    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                        if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                        
                        // Add a newline if we just finished a thinking block to separate it from the text
                        if (hasFinishedThinking && !this.config.useMarkedTerminal && !this.config.isApiMode) {
                            process.stdout.write('\n');
                            hasFinishedThinking = false; // Only do this once
                        }

                        if (!this.config.useMarkedTerminal) {
                            if (!this.config.isApiMode) {
                                process.stdout.write(chalk.cyan(event.delta.text));
                            }
                        }
                        chunkResponse += event.delta.text;
                        finalResponse += event.delta.text;
                    } else if (event.type === 'content_block_delta' && (event.delta.type === 'thinking_delta' || event.delta.type === 'signature_delta')) {
                        // Handle reasoning process for thinking models (always show, but style it subtly)
                        if (!this.config.isApiMode) {
                            if (spinner && spinner.isSpinning) spinner.stop();
                            
                            if (event.delta.thinking) {
                                process.stdout.write(chalk.gray(event.delta.thinking));
                                accumulatedThinking += event.delta.thinking;
                            }
                            if (event.delta.signature) {
                                accumulatedSignature += event.delta.signature;
                            }
                            hasFinishedThinking = true;
                        }
                    } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
                        if (spinner && spinner.isSpinning) spinner.stop();
                        currentToolCall = {
                            id: event.content_block.id,
                            name: event.content_block.name,
                            input: ''
                        };
                    } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
                        if (currentToolCall) {
                            currentToolCall.input += event.delta.partial_json;
                            // Visual feedback for streaming tool arguments
                            if (!this.config.isApiMode) {
                                if (!spinner || !spinner.isSpinning) {
                                    spinner = ora({ text: `Generating ${chalk.yellow(currentToolCall.name)} arguments (${currentToolCall.input.length} bytes)...`, color: 'yellow', stream: process.stdout }).start();
                                } else {
                                    spinner.text = `Generating ${chalk.yellow(currentToolCall.name)} arguments (${currentToolCall.input.length} bytes)...`;
                                }
                            }
                        }
                    } else if (event.type === 'message_stop' || event.type === 'content_block_stop') {
                        if (currentToolCall) {
                            toolCalls.push(currentToolCall);
                            currentToolCall = null;
                        }
                    }
                }

                if (spinner && spinner.isSpinning) spinner.stop();

                const newContent = [];
                
                // Add thinking block FIRST (required by Anthropic)
                if (accumulatedThinking) {
                    newContent.push({
                        type: 'thinking',
                        thinking: accumulatedThinking,
                        signature: accumulatedSignature
                    });
                }

                if (chunkResponse) {
                    if (this.config.useMarkedTerminal && !this.config.isApiMode) printMarkdown(chunkResponse);
                    newContent.push({ type: 'text', text: chunkResponse });
                }

                for (const tc of toolCalls) {
                    try { tc.input = JSON.parse(tc.input || "{}"); } catch (e) { tc.input = {}; }
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
                    if (!this.config.isApiMode) console.log();
                    break;
                }

                const toolResultContent = [];
                for (const call of toolCalls) {
                    if (this.config.isApiMode && this.onToolStart) {
                        this.onToolStart(call.name);
                    }
                    if (!this.config.isApiMode) {
                        console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.name}]`));
                    }
                    const res = await executeTool(call.name, call.input, this.config);
                    if (this.config.isApiMode && this.onToolEnd) {
                        this.onToolEnd(res);
                    }
                    if (this.config.debug && !this.config.isApiMode) {
                        console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                    }
                    if (!this.config.isApiMode) {
                        console.log(chalk.yellow(`[Tool Result Received]\n`));
                    }

                    toolResultContent.push({
                        type: 'tool_result',
                        tool_use_id: call.id,
                        content: typeof res === 'string' ? res : JSON.stringify(res)
                    });
                }

                this.messages.push({ role: 'user', content: toolResultContent });
                if (!this.config.isApiMode) {
                    spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
                }
            }

            return finalResponse;
        } catch (err) {
            if (spinner && spinner.isSpinning) spinner.stop();
            if (!this.config.isApiMode) {
                console.error(chalk.red(`Claude Runtime Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
