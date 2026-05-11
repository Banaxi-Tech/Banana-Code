// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

export const GEMINI_MODELS = [
    { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
    { name: 'Gemini 2.5 Pro (needs paid api)', value: 'gemini-2.5-pro' },
    { name: 'Gemini 3 Flash', value: 'gemini-3-flash-preview' },
    { name: 'Gemini 3.1 Flash Lite (fast responses)', value: 'gemini-3.1-flash-lite-preview' },
    { name: 'Gemini 3.1 Pro (needs paid api)', value: 'gemini-3.1-pro-preview' }
];

export const CLAUDE_MODELS = [
    { name: 'Claude Opus 4.7 (Flagship)', value: 'claude-opus-4-7' },
    { name: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
    // Virtual ID: 'claude-opus-4-6-fast' is used internally to track premium pricing.
    // It is translated back to the real 'claude-opus-4-6' ID before being sent to the API.
    { name: 'Claude Opus 4.6 (Fast Mode - 6x Cost)', value: 'claude-opus-4-6-fast' },
    { name: 'Claude Sonnet 4.6 (Fast & Smart)', value: 'claude-sonnet-4-6' },
    { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' }
];

export const OPENAI_MODELS = [
    { name: 'GPT-5.4 Thinking (Newest)', value: 'gpt-5.4' },
    { name: 'GPT-5.4 Pro (High Compute)', value: 'gpt-5.4-pro' },
    { name: 'GPT-5.4 mini', value: 'gpt-5.4-mini' },
    { name: 'GPT-5.3 Instant', value: 'gpt-5.3-instant' }
];

export const OLLAMA_CLOUD_MODELS = [
    { name: 'Kimi K2 Thinking (Cloud)', value: 'kimi-k2-thinking:cloud' },
    { name: 'Kimi K2.5 (Cloud)', value: 'kimi-k2.5:cloud' },
    { name: 'Qwen 3.5 397B (Cloud)', value: 'qwen3.5:397b-cloud' },
    { name: 'DeepSeek V3.2 (Cloud)', value: 'deepseek-v3.2:cloud' },
    { name: 'GLM-5.1 (Cloud)', value: 'glm-5.1:cloud' },
    { name: 'MiniMax M2.7 (Cloud)', value: 'minimax-m2.7:cloud' },
    { name: 'Gemma 4 31B (Cheapest, Very Good Code)', value: 'gemma4:31b-cloud' }
];

export const MISTRAL_MODELS = [
    { name: 'Mistral Large (Latest)', value: 'mistral-large-latest' },
    { name: 'Mistral Medium (Latest)', value: 'mistral-medium-latest' },
    { name: 'Mistral Small (Latest)', value: 'mistral-small-latest' },
    { name: 'Codestral (Latest)', value: 'codestral-latest' },
    { name: 'Mistral Nemo', value: 'open-mistral-nemo' },
    { name: 'Pixtral 12B', value: 'pixtral-12b-2409' }
];

export const DEEPSEEK_MODELS = [
    { name: 'DeepSeek V4 Pro (Newest, most capable)', value: 'deepseek-v4-pro' },
    { name: 'DeepSeek V4 Flash (Newest, fast)', value: 'deepseek-v4-flash' }
];

export const KIMI_MODELS = [
    { name: 'Kimi K2.6 (Newest, multimodal, 256K)', value: 'kimi-k2.6' },
    { name: 'Kimi K2.5 (multimodal, 256K)', value: 'kimi-k2.5' }
];

export const CODEX_MODELS = [
    { name: 'GPT-5.5 (Newest)', value: 'gpt-5.5' },
    { name: 'GPT-5.4', value: 'gpt-5.4' },
    { name: 'GPT-5.4 mini (Cheapest)', value: 'gpt-5.4-mini' },
    { name: 'GPT-5.3 Codex', value: 'gpt-5.3-codex' },
    { name: 'GPT-5.2 (General)', value: 'gpt-5.2' }
];

export const CLAUDE_PRICING = {
    'claude-opus-4-7':   { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheWrite1h: 10.0, cacheRead: 0.50 },
    'claude-opus-4-6':   { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheWrite1h: 10.0, cacheRead: 0.50 },
    'claude-opus-4-6-fast': { input: 30.0, output: 150.0, cacheWrite: 37.50, cacheWrite1h: 60.0, cacheRead: 3.00 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheWrite1h: 6.0, cacheRead: 0.30 },
    'claude-haiku-4-5':  { input: 1.0, output: 5.0,  cacheWrite: 1.25, cacheWrite1h: 2.0, cacheRead: 0.10 }
};
