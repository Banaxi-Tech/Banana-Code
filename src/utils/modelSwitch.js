// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import {
    GEMINI_MODELS,
    CLAUDE_MODELS,
    OPENAI_MODELS,
    CODEX_MODELS,
    OLLAMA_CLOUD_MODELS,
    MISTRAL_MODELS,
    DEEPSEEK_MODELS,
    KIMI_MODELS,
    QWEN_MODELS
} from '../constants.js';

export const MODEL_SWITCH_TOOL_NAME = 'request_model_switch';

const EXCLUDED_MODEL_SWITCH_PROVIDERS = new Set(['openrouter', 'ollama', 'lmstudio', 'llamacpp']);

export function getModelSwitchProviderId(config = {}) {
    return config?.bananaSplit?.enabled && config.bananaSplit.local?.provider
        ? config.bananaSplit.local.provider
        : config.provider;
}

export function getModelSwitchCurrentModel(config = {}) {
    if (config?.bananaSplit?.enabled && config.bananaSplit.local?.provider) {
        return config.bananaSplit.local.model;
    }
    return config.model;
}

export function getModelSwitchChoices(config = {}) {
    const provider = getModelSwitchProviderId(config);
    if (EXCLUDED_MODEL_SWITCH_PROVIDERS.has(provider)) return [];

    if (provider === 'gemini') return GEMINI_MODELS;
    if (provider === 'claude') return CLAUDE_MODELS;
    if (provider === 'openai') return config.authType === 'oauth' ? CODEX_MODELS : OPENAI_MODELS;
    if (provider === 'mistral') return MISTRAL_MODELS;
    if (provider === 'deepseek') return DEEPSEEK_MODELS;
    if (provider === 'kimi') return KIMI_MODELS;
    if (provider === 'qwen') return QWEN_MODELS;
    if (provider === 'ollama_cloud') return OLLAMA_CLOUD_MODELS;

    return [];
}

export function providerSupportsModelSwitch(config = {}) {
    return getModelSwitchChoices(config).length > 0;
}

export function resolveRecommendedModel(config = {}, requestedModel = '') {
    const model = String(requestedModel || '').trim();
    if (!model) return null;

    const choices = getModelSwitchChoices(config);
    const exact = choices.find(choice => choice.value === model);
    if (exact) return exact.value;

    const lower = model.toLowerCase();
    const byName = choices.find(choice => choice.name.toLowerCase() === lower);
    return byName?.value || null;
}

export function setRuntimeModelOverride(providerInstance, model) {
    if (!providerInstance?.config || !model) return;
    providerInstance.config.runtimeModelOverride = model;
}

export function getActiveModelForNextRequest(providerInstance, previousActiveModel) {
    const overrideModel = providerInstance?.config?.runtimeModelOverride;
    if (overrideModel) {
        delete providerInstance.config.runtimeModelOverride;
        return overrideModel;
    }
    return previousActiveModel;
}

export function getModelSwitchPromptSection(config = {}) {
    if (!providerSupportsModelSwitch(config)) return '';

    const provider = getModelSwitchProviderId(config);
    const currentModel = getModelSwitchCurrentModel(config) || 'unknown';
    const modelLines = getModelSwitchChoices(config)
        .map(choice => `- ${choice.value}: ${choice.name}`)
        .join('\n');

    return `

# Model Switching
You may call \`${MODEL_SWITCH_TOOL_NAME}\` when the current model is clearly too expensive/slow for the task or clearly underpowered for the task.
- The tool asks the user whether to use your recommended model for the rest of this turn or continue with the current model.
- Approved switches are temporary for the current user message only. Future user messages return to the configured model unless you request another switch.
- Do not call it repeatedly. Only call it when the recommendation is useful enough to interrupt the turn.
- Recommend only an exact model ID from the list below for the current provider.

Current provider: ${provider}
Current model: ${currentModel}
Available model IDs:
${modelLines}
`;
}
