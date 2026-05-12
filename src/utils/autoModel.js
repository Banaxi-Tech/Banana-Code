// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

export const AUTO_MODEL_DESCRIPTIONS = {
    // OpenAI (API key)
    'gpt-5.4':              'Most capable OpenAI model (2026 Janury knowledge). Best for complex reasoning, hard coding problems, architecture design.',
    'gpt-5.4-pro':          'High-compute GPT-5.4. Use for the most demanding multi-step reasoning or extremely complex tasks.',
    'gpt-5.4-mini':         'Fast and cheap GPT-5.4 variant. Great for simple questions, quick fixes, low-complexity work.',
    'gpt-5.3-instant':      'Quick responses with good quality. Balanced for most everyday coding and Q&A tasks.',
    // OpenAI Codex (OAuth)
    'gpt-5.5':              'Most capable OpenAI model. Best for complex reasoning, hard coding problems, architecture design.',
    'gpt-5.4':              'Highly capable OpenAI model. Great for complex reasoning and coding.',
    'gpt-5.4-mini':         'Fast and cheap GPT-5.4 variant. Cheapest OAuth/Codex option. Great for simple questions, quick fixes, low-complexity work.',
    'gpt-5.3-codex':        'Strong coding model (2026). Excellent for code generation, review, and software engineering.',
    'gpt-5.2':              'General purpose GPT-5.2. Good balance of capability and speed, but not the cheapest OAuth/Codex option.',
    // Claude
    'claude-opus-4-7':      'Anthropic flagship (April 2026). Ultimate intelligence, deepest reasoning (xhigh/max effort). Best for frontier-level architectural design and extremely complex bugs.',
    'claude-opus-4-6':      'Highly capable previous flagship. Excellent for complex analysis, long documents, and hard bugs where Opus 4.7 might be overkill.',
    'claude-sonnet-4-6':    'Fast and smart Claude (2026). Best balance of speed and quality for most tasks. Recommended For Most Tasks',
    'claude-haiku-4-5':     'Fastest, cheapest Claude. Ideal for simple tasks, quick lookups, high-volume requests.',
    // Gemini
    'gemini-2.5-flash':         'Fast Gemini (2024). Not Recommended For Coding or normal questions. Only Use for something like a Hello.',
    'gemini-2.5-pro':           'More capable Gemini (2024). For complex tasks needing deeper reasoning. Still not that Recommended. Requires paid API.',
    'gemini-3-flash-preview':       'Latest Gemini Flash (2025). Fast with improved quality. Recommended For Normal Tasks',
    'gemini-3.1-flash-lite-preview':'Fastest and cheapest Gemini. Best for simple, quick tasks. It is insanely Fast',
    'gemini-3.1-pro-preview':       'Most capable Gemini (2025). For the most demanding tasks. Requires paid API. Scoring 80% In Arc AGI 2',
    // Mistral
    'mistral-large-latest': 'Most capable Mistral. Best for complex reasoning and tasks.',
    'mistral-medium-latest':'Balanced Mistral. Good for most everyday tasks.',
    'mistral-small-latest': 'Fast and cheap Mistral. Good for simple tasks. Cheapest full-featured option.',
    'codestral-latest':     'Mistral coding specialist. Best choice for any programming task.',
    'open-mistral-nemo':    'Open-source, very cheap. For simple questions, low-complexity work.',
    'pixtral-12b-2409':     'Mistral multimodal model. Use only if the task involves images.',
    // DeepSeek
    'deepseek-v4-pro':       'DeepSeek flagship V4 model. Best for hard coding tasks, complex reasoning, architecture, and agentic workflows.',
    'deepseek-v4-flash':     'Fast and economical DeepSeek V4 model. Good default for everyday coding, quick fixes, and lower-latency work.',
    // Kimi
    'kimi-k2.6':              'Kimi flagship model. Best for long-horizon coding, agentic workflows, multimodal tasks, and complex software engineering.',
    'kimi-k2.5':              'Highly capable Kimi model with strong coding, reasoning, tool use, and multimodal support.',
    // Qwen
    'qwen3.6-max-preview':    'Qwen preview flagship for the hardest reasoning, agentic coding, and complex multi-step software tasks.',
    'qwen3.6-plus':           'Latest balanced Qwen model with 1M context. Strong default for coding, reasoning, tool use, and long-context work.',
    'qwen3.6-flash':          'Latest fast Qwen model with 1M context. Best for simple tasks, quick fixes, and lower latency.',
    'qwen3.5-plus':           'Highly capable Qwen model with 1M context. Good for coding, reasoning, and long-context tasks.',
    'qwen3.5-flash':          'Fast Qwen 3.5 model with 1M context. Good for simple tasks and cost-sensitive turns.',
    'qwen3-max':              'Stable Qwen flagship model. Best for demanding reasoning when a non-preview model is preferred.',
    'qwen3-coder-next':       'Qwen coding model with long context. Best for code generation, refactors, and repository tasks.',
    'qwen3-next-80b-a3b-thinking': 'Qwen thinking model. Use for reasoning-heavy tasks where explicit thinking is useful.',
    'qwen3-next-80b-a3b-instruct': 'Qwen instruct model. Good for general tasks where thinking mode is not needed.',
    // Ollama Cloud
    'kimi-k2-thinking:cloud':   'Advanced reasoning model. Best for complex multi-step problems and hard math.',
    'kimi-k2.5:cloud':          'Strong cloud model with good reasoning. Great all-rounder.',
    'qwen3.5:397b-cloud':       'Very large Qwen model. Excellent for complex tasks and long context.',
    'deepseek-v3.2:cloud':      'Strong general-purpose model. Great coding and reasoning.',
    'glm-5.1:cloud':            'GLM cloud model. Good for general tasks.',
    'minimax-m2.7:cloud':       'MiniMax cloud model. Solid general performance.',
    'gemma4:31b-cloud':         'Cheapest Ollama Cloud option. Best value, surprisingly good at code.',
};

export const AUTO_ROUTER_MODELS = {
    openai:         'gpt-5.4-mini',
    openai_oauth:   'gpt-5.2',
    claude:         'claude-haiku-4-5',
    gemini:         'gemini-3.1-flash-lite-preview',
    mistral:        'mistral-small-latest',
    deepseek:       'deepseek-v4-flash',
    kimi:           'kimi-k2.5',
    qwen:           'qwen3.6-flash',
    ollama_cloud:   'gemma4:31b-cloud',
};

/** How many prior turns to include so short replies like "Implement it" stay grounded. */
export const AUTO_ROUTER_HISTORY_MAX = 7;

const AUTO_ROUTER_TEXT_TRUNCATE = 1500;

function truncateRouterText(s) {
    const t = (s || '').trim();
    return t.length > AUTO_ROUTER_TEXT_TRUNCATE ? t.slice(0, AUTO_ROUTER_TEXT_TRUNCATE) + '…' : t;
}

/**
 * OpenAI / Mistral / Ollama Cloud style: `{ role, content }` plus optional `tool_calls`.
 * Skips leading `system` message. Uses last `max` messages (not including a message not yet appended).
 */
export function openAIMessagesToAutoRouterHistory(messages, max = AUTO_ROUTER_HISTORY_MAX) {
    if (!messages?.length) return '';
    const withoutSystem = messages[0]?.role === 'system' ? messages.slice(1) : [...messages];
    const recent = withoutSystem.slice(-max);
    const lines = recent.map((m) => {
        const label = `[${m.role}]`;
        let body = '';
        if (m.role === 'tool') {
            body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        } else if (m.role === 'assistant' && m.tool_calls?.length) {
            const names = m.tool_calls.map((t) => t.function?.name).filter(Boolean).join(', ');
            const text = typeof m.content === 'string' ? m.content : '';
            body = text + (names ? ` [tools: ${names}]` : '');
        } else if (typeof m.content === 'string') {
            body = m.content;
        } else if (Array.isArray(m.content)) {
            body = m.content
                .map((part) => {
                    if (part.type === 'text' || part.type === 'output_text') return part.text || '';
                    if (part.type === 'tool_use') return `[tool ${part.name}]`;
                    if (part.type === 'tool_result') return '[tool result]';
                    return '';
                })
                .join(' ');
        }
        return `${label} ${truncateRouterText(body)}`;
    });
    return lines.join('\n\n');
}

/** Claude: `messages` with string or block array `content` (no system in array). */
export function claudeMessagesToAutoRouterHistory(messages, max = AUTO_ROUTER_HISTORY_MAX) {
    if (!messages?.length) return '';
    const recent = messages.slice(-max);
    const lines = recent.map((m) => {
        const label = `[${m.role}]`;
        let body = '';
        if (typeof m.content === 'string') body = m.content;
        else if (Array.isArray(m.content)) {
            body = m.content
                .map((c) => {
                    if (c.type === 'text') return c.text || '';
                    if (c.type === 'tool_use') return `[tool ${c.name}]`;
                    if (c.type === 'tool_result') return '[tool result]';
                    return '';
                })
                .join(' ');
        }
        return `${label} ${truncateRouterText(body)}`;
    });
    return lines.join('\n\n');
}

/** Gemini: `{ role: user|model, parts: [...] }`. */
export function geminiMessagesToAutoRouterHistory(messages, max = AUTO_ROUTER_HISTORY_MAX) {
    if (!messages?.length) return '';
    const recent = messages.slice(-max);
    const lines = recent.map((m) => {
        const label = m.role === 'model' ? '[assistant]' : `[${m.role}]`;
        const parts = m.parts || [];
        const body = parts
            .map((p) => {
                if (p.text) return p.text;
                if (p.functionCall) return `[tool ${p.functionCall.name}]`;
                if (p.functionResponse) return '[tool result]';
                return '';
            })
            .join(' ');
        return `${label} ${truncateRouterText(body)}`;
    });
    return lines.join('\n\n');
}

/**
 * @param {Array<{id: string, description: string}>} models
 * @param {string} currentUserMessage — the new user line only (what we need a model for)
 * @param {string} [historyText] — formatted prior turns (optional)
 * @param {string} provider — the current provider (e.g. 'claude')
 */
export function buildRoutingPrompt(models, currentUserMessage, historyText = '', provider = '') {
    const modelList = models
        .map(({ id, description }) => `- ${id}: ${description}`)
        .join('\n');

    const historyBlock = historyText.trim()
        ? `
---
Conversation history (last up to ${AUTO_ROUTER_HISTORY_MAX} messages, already completed — for context only):
${historyText.trim()}
---
`
        : '';

    let effortInstructions = '';
    if (provider === 'claude') {
        effortInstructions = `
Additionally, you must select a reasoning "effort" level for the chosen model based on the task difficulty:
- "low": Simple questions, quick fixes, basic file lookups, or greetings.
- "medium": Standard coding tasks, standard bug fixes, or explanatory responses.
- "high": Complex logic, multi-file changes, architectural design, or difficult bugs.
- "xhigh": Frontier-level architectural problems or extremely deep reasoning (Only for 'claude-opus-4-7').
- "max": Absolute maximum reasoning depth for the most impossible problems (Only for 'opus' and 'sonnet' series).
`;
    }

    return `You are a model router for an AI coding assistant called Banana Code. You must choose exactly ONE model from the list below.

CRITICAL RULES:
- You are NOT replying to the user. You only output JSON that names which model should handle the NEXT assistant response.
- "Conversation history" is BACKGROUND ONLY (e.g. so short messages like "Implement it" or "Do that" refer to the right task). Do NOT select a model as if you were answering those old messages.
- You ONLY decide the model for the section "Current user message (route for this only)" at the bottom.

Guidelines for which model fits the CURRENT user message:
- Simple questions, quick tasks, small fixes → fast/cheap models
- Complex reasoning, architecture, hard debugging, large refactors, full feature implementation → most capable models
- Code-heavy work → coding-focused models when listed
- Default to the cheapest model that can adequately handle the current message (use history to disambiguate difficulty)
${effortInstructions}
Available models (pick by exact "id"):
${modelList}
${historyBlock}
Current user message (choose model for THIS message only — the assistant's next reply will use your chosen model):
${currentUserMessage}

Respond ONLY with valid JSON and nothing else: {"model": "<exact_model_id_from_the_list>", "effort": "<level_choice>", "reason": "<one brief sentence: why this model and effort fits the current message, using history only as context>"}`;
}

export function parseRoutingResponse(text) {
    try {
        const match = text.match(/\{[\s\S]*?\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);
            if (typeof parsed.model === 'string' && typeof parsed.reason === 'string') {
                return {
                    model: parsed.model,
                    effort: parsed.effort || 'high',
                    reason: parsed.reason
                };
            }
        }
    } catch (e) {}
    return null;
}
