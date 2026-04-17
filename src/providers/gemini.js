import { getAvailableTools, executeTool, sanitizeSchemaForStrictAPIs } from '../tools/registry.js';
import chalk from 'chalk';
import ora from 'ora';
import { getSystemPrompt } from '../prompt.js';
import { printMarkdown } from '../utils/markdown.js';
import { GEMINI_MODELS } from '../constants.js';
import { AUTO_MODEL_DESCRIPTIONS, AUTO_ROUTER_MODELS, buildRoutingPrompt, parseRoutingResponse, geminiMessagesToAutoRouterHistory } from '../utils/autoModel.js';

/** When Gemini Auto Mode routing fails, use this model instead of the first list entry (2.5 Flash). */
const GEMINI_AUTO_FALLBACK_MODEL = 'gemini-3-flash-preview';

/** Minimal request to `gemini-3.1-pro-preview` — success implies paid-tier access for Auto routing. */
const GEMINI_PAID_TIER_PROBE_MODEL = 'gemini-3.1-pro-preview';

/** Auto Mode may only pick these when the API key is on free tier (probe fails or reports free-tier quota). */
const GEMINI_AUTO_FREE_TIER_MODEL_IDS = new Set([
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview'
]);

export class GeminiProvider {
    constructor(config) {
        this.config = config;
        this.apiKey = config.apiKey;
        this.modelName = config.model || 'gemini-2.5-flash';
        /** @type {boolean | undefined} cached result of paid-tier probe (Gemini Auto Mode only) */
        this._geminiPaidTierProbeCache = undefined;
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

    /**
     * One cheap `generateContent` to gemini-3.1-pro-preview. If it succeeds, the key can use paid models in Auto.
     * If the error payload mentions free-tier quota (`free_tier`, etc.), only free-tier Flash models are offered to the router.
     */
    async probeGeminiPaidTierForAuto() {
        if (this._geminiPaidTierProbeCache !== undefined) {
            return this._geminiPaidTierProbeCache;
        }
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PAID_TIER_PROBE_MODEL}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'hi' }] }],
                        generationConfig: { maxOutputTokens: 1 }
                    })
                }
            );
            const data = await resp.json();
            if (this.config.debug) {
                const preview = JSON.stringify(data);
                console.error(chalk.gray(`\n[DEBUG] Gemini paid-tier probe HTTP ${resp.status}: ${preview.length > 800 ? preview.slice(0, 800) + '…' : preview}`));
            }
            if (resp.ok && data.candidates?.[0]) {
                this._geminiPaidTierProbeCache = true;
                return true;
            }
            const errBlob = JSON.stringify(data.error ?? data);
            if (/free_tier|FreeTier|free tier/i.test(errBlob) || /generativelanguage\.googleapis\.com\/generate_content_free_tier/i.test(errBlob)) {
                this._geminiPaidTierProbeCache = false;
                if (this.config.debug) {
                    console.error(chalk.cyan(`\n[DEBUG] Gemini Auto: free-tier API — router limited to Flash models only.`));
                }
                return false;
            }
            this._geminiPaidTierProbeCache = false;
            return false;
        } catch (e) {
            if (this.config.debug) {
                console.error(chalk.yellow(`\n[DEBUG] Gemini paid-tier probe error: ${e.message}`));
            }
            this._geminiPaidTierProbeCache = false;
            return false;
        }
    }

    async autoRoute(message) {
        const historyText = geminiMessagesToAutoRouterHistory(this.messages || []);
        const paidTier = await this.probeGeminiPaidTierForAuto();
        const modelSource = paidTier
            ? GEMINI_MODELS
            : GEMINI_MODELS.filter((m) => GEMINI_AUTO_FREE_TIER_MODEL_IDS.has(m.value));
        const models = modelSource.map(m => ({
            id: m.value,
            description: AUTO_MODEL_DESCRIPTIONS[m.value] || m.name
        }));
        const prompt = buildRoutingPrompt(models, message, historyText);
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${AUTO_ROUTER_MODELS.gemini}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
                }
            );
            const data = await resp.json();
            if (!resp.ok) {
                if (this.config.debug) {
                    console.error(chalk.yellow(`\n[DEBUG] Gemini auto-route HTTP ${resp.status}: ${JSON.stringify(data)}`));
                }
                return { model: GEMINI_AUTO_FALLBACK_MODEL, reason: 'Auto-routing failed, using fallback model.' };
            }
            if (data.error && this.config.debug) {
                console.error(chalk.yellow(`\n[DEBUG] Gemini auto-route API error: ${JSON.stringify(data.error)}`));
            }
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const blockReason = data.candidates?.[0]?.finishReason;
            if (!text && this.config.debug) {
                console.error(chalk.yellow(`\n[DEBUG] Gemini auto-route empty text. finishReason=${blockReason} raw=${JSON.stringify(data)}`));
            }
            const result = parseRoutingResponse(text);
            if (result && models.some(m => m.id === result.model)) return result;
            if (this.config.debug) {
                console.error(chalk.yellow(`\n[DEBUG] Gemini auto-route parse failed. Extracted text: ${JSON.stringify(text)}`));
            }
        } catch (e) {
            if (this.config.debug) {
                console.error(chalk.yellow(`\n[DEBUG] Gemini auto-route error: ${e.message}`));
            }
        }
        return { model: GEMINI_AUTO_FALLBACK_MODEL, reason: 'Auto-routing failed, using fallback model.' };
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

        const userParts = [{ text: message }];
        for (const img of images) {
            userParts.push({
                inlineData: {
                    mimeType: img.mimeType,
                    data: img.base64
                }
            });
        }
        this.messages.push({ role: 'user', parts: userParts });

        let spinner = null;
        if (!this.config.isApiMode) {
            spinner = ora({ text: 'Thinking...', color: 'yellow', stream: process.stdout }).start();
        }
        let responseText = '';

        try {
            while (true) {
                let currentTurnText = '';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:streamGenerateContent?alt=sse&key=${this.apiKey}`, {
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
                                        if (spinner.isSpinning && !this.config.useMarkedTerminal) spinner.stop();
                                        if (!this.config.useMarkedTerminal) {
                                            if (this.config.isApiMode && this.onChunk) {
                                                this.onChunk(part.text);
                                            } else {
                                                process.stdout.write(chalk.cyan(part.text));
                                            }
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
                        if (this.config.isApiMode && this.onToolStart) {
                            this.onToolStart(call.name);
                        }
                        if (!this.config.isApiMode) {
                            console.log(chalk.yellow(`\n[Banana Calling Tool: ${call.name}]`));
                        }
                        const res = await executeTool(call.name, call.args, this.config);
                        if (this.config.isApiMode && this.onToolEnd) {
                            this.onToolEnd(res);
                        }
                        if (this.config.debug && !this.config.isApiMode) {
                            console.log(chalk.gray(`[DEBUG] Tool Result: ${typeof res === 'string' ? res : JSON.stringify(res, null, 2)}`));
                        }
                        if (!this.config.isApiMode) {
                            console.log(chalk.yellow(`[Tool Result Received]\n`));
                        }

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
                if (!this.config.isApiMode) {
                    spinner = ora({ text: 'Processing tool results...', color: 'yellow', stream: process.stdout }).start();
                }
            }

            if (!this.config.isApiMode) console.log(); // Newline after stream
            return responseText;
        } catch (err) {
            if (spinner && spinner.isSpinning) spinner.stop();
            if (!this.config.isApiMode) {
                console.error(chalk.red(`Gemini Error: ${err.message}`));
            }
            return `Error: ${err.message}`;
        }
    }
}
