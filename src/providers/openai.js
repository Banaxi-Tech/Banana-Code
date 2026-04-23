import OpenAI from 'openai';
import { getAvailableTools, executeTool } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getRandomSpinnerText } from '../utils/spinner.js';
import os from 'os';
import path from 'path';
import fsSync from 'fs';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';
import { OPENAI_MODELS, CODEX_MODELS } from '../constants.js';
import { AUTO_MODEL_DESCRIPTIONS, AUTO_ROUTER_MODELS, buildRoutingPrompt, parseRoutingResponse, openAIMessagesToAutoRouterHistory } from '../utils/autoModel.js';

/**
 * Notice: Parts of the OAuth authentication flow and SSE streaming logic in this file 
 * are derived from or inspired by the 'opencode-openai-codex-auth' package 
 * (Copyright (c) 2024-2025 numman-ali). See NOTICE file for full license details.
 */
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

    async autoRoute(message) {
        const isOAuth = this.config.authType === 'oauth';
        const modelList = isOAuth ? CODEX_MODELS : OPENAI_MODELS;
        const historyText = openAIMessagesToAutoRouterHistory(this.messages || []);

        if (isOAuth) {
            // Use the same OAuth API with the cheapest Codex model to route
            const models = modelList.map(m => ({
                id: m.value,
                description: AUTO_MODEL_DESCRIPTIONS[m.value] || m.name
            }));
            const prompt = buildRoutingPrompt(models, message, historyText);
            try {
                const authFile = path.join(os.homedir(), '.codex', 'auth.json');
                const session = JSON.parse(fsSync.readFileSync(authFile, 'utf-8'));
                const accessToken = session?.tokens?.access_token || session.access_token || session.accessToken;
                const accountId  = session?.tokens?.account_id  || session.account_id;
                if (!accessToken || !accountId) throw new Error('Missing OAuth token');

                const payload = {
                    model: AUTO_ROUTER_MODELS.openai_oauth,
                    instructions: 'You are a model router. Reply only with the requested JSON.',
                    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
                    tools: [],
                    store: false,
                    stream: true,
                    include: ["reasoning.encrypted_content"],
                    reasoning: { effort: "medium", summary: "auto" },
                    text: { verbosity: "low" }
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
                    const errBody = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errBody}`);
                }

                // Collect streaming text
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let text = '';
                let lineBuffer = '';
                let currentEvent = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    lineBuffer += decoder.decode(value);
                    const lines = lineBuffer.split('\n');
                    lineBuffer = lines.pop();
                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            currentEvent = line.substring(7).trim();
                        } else if (line.startsWith('data: ') && currentEvent === 'response.output_text.delta') {
                            try { text += JSON.parse(line.substring(6)).delta; } catch (e) {}
                        }
                    }
                }

                const result = parseRoutingResponse(text);
                if (result && models.some(m => m.id === result.model)) return result;
                if (this.config.debug) {
                    console.error(chalk.yellow(`\n[DEBUG] Auto-route parsing failed. Raw response: ${text}`));
                }
            } catch (e) {
                if (this.config.debug) {
                    console.error(chalk.yellow(`\n[DEBUG] Auto-route error: ${e.message}`));
                }
            }
            return { model: modelList[0].value, reason: 'Auto-routing failed, using most capable model.' };
        }

        // API key mode — call the cheapest model to route
        const models = modelList.map(m => ({
            id: m.value,
            description: AUTO_MODEL_DESCRIPTIONS[m.value] || m.name
        }));
        const prompt = buildRoutingPrompt(models, message, historyText);
        try {
            const resp = await this.openai.chat.completions.create({
                model: AUTO_ROUTER_MODELS.openai,
                messages: [{ role: 'user', content: prompt }],
                stream: false
            });
            const text = resp.choices[0]?.message?.content || '';
            const result = parseRoutingResponse(text);
            if (result && models.some(m => m.id === result.model)) return result;
            if (this.config.debug) {
                console.error(chalk.yellow(`\n[DEBUG] Auto-route parsing failed. Raw response: ${text}`));
            }
        } catch (e) {
            if (this.config.debug) {
                console.error(chalk.yellow(`\n[DEBUG] Auto-route error: ${e.message}`));
            }
        }
        return { model: modelList[0].value, reason: 'Auto-routing failed, using most capable model.' };
    }

    async sendMessage(input) {
        if (this.config.authType === 'oauth') {
            return await this.sendOauthMessage(input);
        }

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
            spinner = ora({ text: getRandomSpinnerText('openai'), color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                let stream = null;
                try {
                    const params = {
                        model: activeModel,
                        messages: this.messages,
                        tools: this.tools,
                        stream: true
                    };

                    stream = await this.openai.chat.completions.create(params);
                } catch (e) {
                    if (spinner) spinner.stop();
                    if (!this.config.isApiMode) {
                        console.error(chalk.red(`OpenAI Request Error: ${e.message}`));
                    }
                    return `Error: ${e.message}`;
                }

                let chunkResponse = '';
                let toolCalls = [];

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;

                    if (delta?.content) {
                        if (spinner && spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                        if (!this.config.useMarkedTerminal) {
                            if (this.config.isApiMode) {
                                if (this.onChunk) this.onChunk(delta.content);
                            } else {
                                process.stdout.write(chalk.cyan(delta.content));
                            }
                        }
                        chunkResponse += delta.content;
                        finalResponse += delta.content;
                    }

                    if (delta?.tool_calls) {
                        if (spinner && spinner.isSpinning) spinner.stop();
                        for (const tc of delta.tool_calls) {
                            if (tc.index === undefined) continue;
                            if (!toolCalls[tc.index]) {
                                toolCalls[tc.index] = { id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } };
                            }
                            if (tc.function?.arguments) {
                                toolCalls[tc.index].function.arguments += tc.function.arguments;
                                // Visual feedback for streaming tool arguments
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

                if (chunkResponse) {
                    if (this.config.useMarkedTerminal && !this.config.isApiMode) printMarkdown(chunkResponse);
                    this.messages.push({ role: 'assistant', content: chunkResponse });
                }

                toolCalls = toolCalls.filter(Boolean);

                if (toolCalls.length === 0) {
                    if (!this.config.isApiMode) console.log();
                    break;
                }

                this.messages.push({
                    role: 'assistant',
                    tool_calls: toolCalls,
                    content: chunkResponse || null
                });

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
                    } catch (e) { }

                    let res;
                    try {
                        res = await executeTool(call.function.name, args, this.config);
                    } catch (toolErr) {
                        if (toolErr.name === 'ExitPromptError') {
                            res = `[Tool execution was cancelled by the user]`;
                        } else {
                            res = `[Tool execution failed: ${toolErr.message}]`;
                        }
                    }
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

            // Repair dangling tool_calls in history
            for (let i = this.messages.length - 1; i >= 0; i--) {
                const msg = this.messages[i];
                if (msg.role === 'assistant' && msg.tool_calls?.length) {
                    const idsNeeded = msg.tool_calls.map(tc => tc.id);
                    const idsFulfilled = this.messages.slice(i + 1)
                        .filter(m => m.role === 'tool')
                        .map(m => m.tool_call_id);
                    const missing = idsNeeded.filter(id => !idsFulfilled.includes(id));
                    if (missing.length > 0) {
                        this.messages.splice(i, 1); // remove the orphaned assistant message
                    }
                    break;
                }
            }

            if (!this.config.isApiMode) {
                console.error(chalk.red(`OpenAI Runtime Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }

    async sendOauthMessage(input) {
        let message = '';
        let images = [];
        if (typeof input === 'string') {
            message = input;
        } else {
            message = input.text;
            images = input.images || [];
        }

        let activeOauthModel = this.modelName;
        if (this.modelName === 'auto') {
            const routing = await this.autoRoute(message);
            activeOauthModel = routing.model;
            if (!this.config.isApiMode) {
                console.log(chalk.magenta(`\n[Auto Mode] → ${chalk.yellow(activeOauthModel)}: ${routing.reason}`));
            }
        }

        this.messages.push({ role: 'user', content: message, attachedImages: images });

        const authFile = path.join(os.homedir(), '.codex', 'auth.json');
        let accessToken, accountId;
        try {
            const data = fsSync.readFileSync(authFile, 'utf-8');
            const session = JSON.parse(data);
            accessToken = session?.tokens?.access_token || session.access_token || session.accessToken;
            accountId = session?.tokens?.account_id || session.account_id;
            if (!accessToken || !accountId) throw new Error("Token or Account ID missing");
        } catch (e) {
            if (!this.config.isApiMode) {
                console.error(chalk.red("\nCodex auth token not found. Please quit 'banana', delete ~/.config/banana-code/config.json, and run setup again."));
            }
            return "Error: Codex auth token not found.";
        }

        const mapMessagesToBackend = (messages) => {
            const result = [];
            // Skip the first system message as it goes into 'instructions'
            const history = messages.slice(1);

            for (const msg of history) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    if (msg.tool_calls) {
                        if (msg.content) {
                            result.push({
                                type: 'message',
                                role: 'assistant',
                                content: [{ type: 'output_text', text: msg.content }]
                            });
                        }
                        for (const tc of msg.tool_calls) {
                            result.push({
                                type: 'function_call',
                                name: tc.function.name,
                                call_id: tc.id,
                                arguments: tc.function.arguments
                            });
                        }
                    } else if (msg.content) {
                        const contentParts = [];
                        if (typeof msg.content === 'string') {
                            const contentType = msg.role === 'assistant' ? 'output_text' : 'input_text';
                            contentParts.push({ type: contentType, text: msg.content });
                        } else if (Array.isArray(msg.content)) {
                            // Copy existing structured content parts
                            contentParts.push(...msg.content);
                        }

                        // Also include any images explicitly attached to this message object
                        if (msg.attachedImages) {
                            for (const img of msg.attachedImages) {
                                contentParts.push({
                                    type: 'image',
                                    image_url: `data:${img.mimeType};base64,${img.base64}`
                                });
                            }
                        }

                        result.push({
                            type: 'message',
                            role: msg.role,
                            content: contentParts
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

        let spinner = null;
        if (!this.config.isApiMode) {
            spinner = ora({ text: getRandomSpinnerText('openai'), color: 'yellow', stream: process.stdout }).start();
        }
        let finalResponse = '';

        try {
            while (true) {
                const backendInput = mapMessagesToBackend(this.messages);
                if (this.config.debug) {
                    console.error(chalk.gray(`[DEBUG] Backend input (${backendInput.length} items): ${JSON.stringify(backendInput, null, 2)}`));
                }
                const backendTools = mapToolsToBackend(this.tools);

                const payload = {
                    model: activeOauthModel || 'gpt-5.2',
                    instructions: this.systemPrompt,
                    input: backendInput.length > 0 ? backendInput : [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: ' ' }] }],
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
                    if (spinner) spinner.stop();
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
                let hasFinishedReasoning = false;

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
                                            if (!this.config.isApiMode) {
                                                process.stdout.write(chalk.cyan(data.delta));
                                            }
                                        }
                                        currentChunkResponse += data.delta;
                                        finalResponse += data.delta;
                                    } else if (currentEvent === 'response.reasoning.delta' || currentEvent === 'response.reasoning_text.delta' || currentEvent.includes('reasoning.delta')) {
                                        if (this.config.debug && !this.config.isApiMode && data.delta) {
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
                                        if (!this.config.isApiMode) {
                                            if (!spinner || !spinner.isSpinning) {
                                                spinner = ora({ text: `Generating ${chalk.yellow(currentToolCall.name)} (${currentToolCall.arguments.length} bytes)...`, color: 'yellow', stream: process.stdout }).start();
                                            } else {
                                                spinner.text = `Generating ${chalk.yellow(currentToolCall.name)} arguments (${currentToolCall.arguments.length} bytes)...`;
                                            }
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
                            if (this.config.debug) {
                                console.error(chalk.gray(`[DEBUG] SSE event: ${currentEvent}`));
                            }
                            if (this.config.debug && (currentEvent === 'error' || currentEvent === 'response.failed')) {
                                console.error(chalk.red(`[DEBUG] SSE error data: ${currentDataBuffer}`));
                            }
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
                                if (spinner && spinner.isSpinning) spinner.stop();
                                if (!this.config.isApiMode) {
                                    process.stdout.write(chalk.cyan(data.delta));
                                }
                                currentChunkResponse += data.delta;
                                finalResponse += data.delta;
                            }
                        } catch (e) { }
                    }
                }
                // Also stop spinner at the very end of the stream just in case
                if (spinner && spinner.isSpinning) spinner.stop();

                if (currentChunkResponse) {
                    if (this.config.useMarkedTerminal && !this.config.isApiMode) printMarkdown(currentChunkResponse);
                    this.messages.push({ role: 'assistant', content: currentChunkResponse });
                }

                if (activeToolCalls.length === 0) {
                    if (!this.config.isApiMode) console.log();
                    break;
                }

                this.messages.push({
                    role: 'assistant',
                    tool_calls: activeToolCalls,
                    content: currentChunkResponse || null
                });

                for (const call of activeToolCalls) {
                    if (this.config.isApiMode && this.onToolStart) {
                        this.onToolStart(call.function.name);
                    }
                    if (!this.config.isApiMode) {
                        console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.function.name}]`));
                    }
                    let args = {};
                    try {
                        args = JSON.parse(call.function.arguments);
                    } catch (e) { }

                    let res;
                    try {
                        res = await executeTool(call.function.name, args, this.config);
                    } catch (toolErr) {
                        if (toolErr.name === 'ExitPromptError') {
                            res = `[Tool execution was cancelled by the user]`;
                        } else {
                            res = `[Tool execution failed: ${toolErr.message}]`;
                        }
                    }
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

            // Repair dangling tool_calls in history
            for (let i = this.messages.length - 1; i >= 0; i--) {
                const msg = this.messages[i];
                if (msg.role === 'assistant' && msg.tool_calls?.length) {
                    const idsNeeded = msg.tool_calls.map(tc => tc.id);
                    const idsFulfilled = this.messages.slice(i + 1)
                        .filter(m => m.role === 'tool')
                        .map(m => m.tool_call_id);
                    const missing = idsNeeded.filter(id => !idsFulfilled.includes(id));
                    if (missing.length > 0) {
                        this.messages.splice(i, 1); // remove the orphaned assistant message
                    }
                    break;
                }
            }

            if (!this.config.isApiMode) {
                console.error(chalk.red(`OpenAI Codex Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
