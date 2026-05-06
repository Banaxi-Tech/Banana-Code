// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { select, input } from '@inquirer/prompts';
import { execSync } from 'child_process';
import fsSync from 'fs';
import chalk from 'chalk';

import { GEMINI_MODELS, CLAUDE_MODELS, OPENAI_MODELS, CODEX_MODELS, OLLAMA_CLOUD_MODELS, MISTRAL_MODELS, DEEPSEEK_MODELS, KIMI_MODELS } from './constants.js';
import { pluginRegistry } from './utils/plugins.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'banana-code');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PROJECT_LOCAL_SETTINGS_RELATIVE_PATH = path.join('.banana', 'settings.local.json');
const PROJECT_LOCAL_CONFIG_METADATA = Symbol('projectLocalConfigMetadata');
export const DEFAULT_IMAGEGEN_BASE_URL = 'http://127.0.0.1:8000';

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
}

function isEmptyPlainObject(value) {
    return isPlainObject(value) && Object.keys(value).length === 0;
}

function deepMergeConfig(base, override) {
    const merged = { ...base };

    for (const [key, value] of Object.entries(override)) {
        if (isPlainObject(value) && isPlainObject(base[key])) {
            merged[key] = deepMergeConfig(base[key], value);
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

function restoreProjectLocalValues(target, globalConfig, localSettings) {
    for (const [key, localValue] of Object.entries(localSettings)) {
        const globalHasKey = Object.prototype.hasOwnProperty.call(globalConfig || {}, key);
        const globalValue = isPlainObject(globalConfig) ? globalConfig[key] : undefined;

        if (isPlainObject(localValue) && isPlainObject(target[key]) && (!globalHasKey || isPlainObject(globalValue))) {
            restoreProjectLocalValues(target[key], globalValue, localValue);

            if (!globalHasKey && isEmptyPlainObject(target[key])) {
                delete target[key];
            }
            continue;
        }

        if (globalHasKey) {
            target[key] = globalValue;
        } else {
            delete target[key];
        }
    }
}

function markProjectLocalConfig(config, globalConfig, localSettings) {
    Object.defineProperty(config, PROJECT_LOCAL_CONFIG_METADATA, {
        value: {
            globalConfig: cloneConfig(globalConfig),
            localSettings: cloneConfig(localSettings)
        },
        enumerable: false,
        configurable: true
    });

    return config;
}

function getPersistentConfig(config) {
    const {
        isApiMode,
        onChunk,
        onToolStart,
        onToolEnd,
        onImageGenProgress,
        onImageGenResult,
        browserController,
        ...persistentConfig
    } = config;
    const metadata = config[PROJECT_LOCAL_CONFIG_METADATA];

    if (!metadata) {
        return persistentConfig;
    }

    restoreProjectLocalValues(persistentConfig, metadata.globalConfig, metadata.localSettings);

    return persistentConfig;
}

export function getProjectLocalSettingsPath(cwd = process.cwd()) {
    return path.join(cwd, PROJECT_LOCAL_SETTINGS_RELATIVE_PATH);
}

export async function hasProjectLocalSettings(cwd = process.cwd()) {
    try {
        await fs.access(getProjectLocalSettingsPath(cwd));
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

export async function confirmProjectLocalSettingsTrust(cwd = process.cwd()) {
    const settingsPath = getProjectLocalSettingsPath(cwd);

    if (!await hasProjectLocalSettings(cwd)) {
        return true;
    }

    console.log(chalk.yellow.bold('\nAccessing workspace:\n'));
    console.log(` ${cwd}\n`);
    console.log(chalk.yellow(` Quick safety check: Is this a project you created or one you trust? Banana Code found a Project Specific settings file which could enable bypass permissions or other settings. If not then you should look at the ${PROJECT_LOCAL_SETTINGS_RELATIVE_PATH} to see what it changes and if it's safe.\n`));

    try {
        return await select({
            message: `Trust ${settingsPath}?`,
            choices: [
                { name: 'Yes, I trust this folder', value: true },
                { name: 'No, exit', value: false }
            ]
        });
    } catch (error) {
        if (error.name === 'ExitPromptError') {
            return false;
        }
        throw error;
    }
}

export async function applyProjectLocalSettings(config, cwd = process.cwd()) {
    const settingsPath = getProjectLocalSettingsPath(cwd);

    try {
        const data = await fs.readFile(settingsPath, 'utf-8');
        const localSettings = JSON.parse(data);

        if (!isPlainObject(localSettings)) {
            throw new Error(`${settingsPath} must contain a JSON object.`);
        }

        const globalConfig = cloneConfig(config);
        const mergedConfig = deepMergeConfig(globalConfig, localSettings);
        return markProjectLocalConfig(mergedConfig, globalConfig, localSettings);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return config;
        }
        if (error instanceof SyntaxError) {
            throw new Error(`Failed to parse ${settingsPath}: ${error.message}`);
        }
        throw error;
    }
}

export async function loadConfig(options = {}) {
    const { includeProjectLocal = false, cwd = process.cwd() } = options;
    let config;

    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        config = JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            if (process.argv.includes('--api')) {
                config = { provider: null, model: null, isInitialApiSetup: true };
            } else {
                config = await runSetupWizard();
            }
        } else {
            throw error;
        }
    }

    if (includeProjectLocal) {
        return await applyProjectLocalSettings(config, cwd);
    }

    return config;
}

export async function saveConfig(config) {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        const persistentConfig = getPersistentConfig(config);
        await fs.writeFile(CONFIG_FILE, JSON.stringify(persistentConfig, null, 2), 'utf-8');
    } catch (error) {
        console.error(chalk.red("Failed to save config:"), error);
    }
}

export function copyBananaSplitProviderConfig(provider, providerConfig) {
    const result = {
        provider,
        model: providerConfig.model
    };

    if (provider === 'lmstudio') {
        result.lmStudioBaseUrl = providerConfig.lmStudioBaseUrl;
    }

    if (providerConfig.apiKey) {
        result.apiKey = providerConfig.apiKey;
    }

    if (provider === 'openai') {
        result.authType = providerConfig.authType || 'api_key';
        if (result.authType === 'oauth') {
            result.openaiCodexEffort = providerConfig.openaiCodexEffort || 'medium';
        }
    }

    if (provider === 'claude') {
        result.useExtendedCache = providerConfig.useExtendedCache;
        result.claudeEffort = providerConfig.claudeEffort;
    }

    return result;
}

export function getBananaSplitLocalConfig(config) {
    const local = config?.bananaSplit?.local;
    if (!config?.bananaSplit?.enabled || !local?.provider) {
        return config;
    }

    return {
        ...config,
        ...local,
        provider: local.provider,
        model: local.model
    };
}

export function getBananaSplitReviewerConfig(config) {
    const reviewer = config?.bananaSplit?.reviewer;
    if (!reviewer?.provider) {
        return null;
    }

    return {
        ...config,
        ...reviewer,
        provider: reviewer.provider,
        model: reviewer.model,
        bananaSplit: {
            ...config.bananaSplit,
            enabled: false
        },
        bananaSplitReviewerMode: true,
        isApiMode: true,
        useMarkedTerminal: false,
        debug: false
    };
}

export function normalizeImageGenBaseUrl(baseUrl = DEFAULT_IMAGEGEN_BASE_URL) {
    const trimmed = String(baseUrl || DEFAULT_IMAGEGEN_BASE_URL).trim();
    return trimmed.replace(/\/+$/, '');
}

export async function listImageGenModels(baseUrl = DEFAULT_IMAGEGEN_BASE_URL) {
    const normalizedBaseUrl = normalizeImageGenBaseUrl(baseUrl);
    const response = await fetch(`${normalizedBaseUrl}/v1/models`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data.error?.message || data.error || response.statusText;
        throw new Error(`ImageGen model discovery failed at ${normalizedBaseUrl}: ${message}`);
    }

    const models = Array.isArray(data.data)
        ? data.data.map(model => model?.id).filter(Boolean)
        : [];

    return { baseUrl: normalizedBaseUrl, models };
}

export async function setupImageGen(config = {}) {
    const existing = config.imageGen || {};

    console.log(chalk.cyan('\nImageGen uses an OpenAI-compatible Stable Diffusion image API.'));

    const baseUrl = normalizeImageGenBaseUrl(await input({
        message: 'Enter your ImageGen API base URL:',
        default: existing.baseUrl || DEFAULT_IMAGEGEN_BASE_URL,
        validate: (value) => String(value || '').trim().length > 0 || 'Base URL cannot be empty'
    }));

    let choices = [];
    try {
        console.log(chalk.cyan(`Detecting ImageGen models at ${baseUrl}...`));
        const discovery = await listImageGenModels(baseUrl);
        choices = discovery.models.map(model => ({ name: model, value: model }));
    } catch (error) {
        console.log(chalk.yellow(error.message));
    }

    let model;
    if (choices.length > 0) {
        model = await select({
            message: 'Select an ImageGen model:',
            choices,
            default: existing.model && choices.some(choice => choice.value === existing.model) ? existing.model : undefined,
            loop: false
        });
    } else {
        model = await input({
            message: 'Enter ImageGen model ID:',
            default: existing.model || 'sd35_medium',
            validate: (value) => String(value || '').trim().length > 0 || 'Model ID cannot be empty'
        });
    }

    config.imageGen = {
        enabled: true,
        baseUrl,
        model: model.trim(),
        realtimeProgress: existing.realtimeProgress !== false
    };

    return config;
}

export async function setupBananaSplit(config = {}) {
    const existing = config.bananaSplit || {};

    console.log(chalk.cyan('\nBananaSplit pairs a local coding model with a cloud review model.'));

    const localProvider = await select({
        message: 'Select the local model provider BananaSplit should use for coding:',
        choices: [
            { name: 'Ollama (Local)', value: 'ollama' },
            { name: 'LM Studio (Local)', value: 'lmstudio' }
        ],
        default: existing.local?.provider || 'ollama',
        loop: false
    });

    const localSetup = await setupProvider(localProvider, {
        provider: localProvider,
        model: existing.local?.model,
        lmStudioBaseUrl: existing.local?.lmStudioBaseUrl || config.lmStudioBaseUrl
    });

    const reviewerChoices = [
        { name: 'Google Gemini', value: 'gemini' },
        { name: 'Anthropic Claude', value: 'claude' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Mistral AI', value: 'mistral' },
        { name: 'DeepSeek', value: 'deepseek' },
        { name: 'Kimi AI (Moonshot)', value: 'kimi' },
        { name: 'OpenRouter (Any Model)', value: 'openrouter' },
        { name: 'Ollama Cloud', value: 'ollama_cloud' }
    ];
    const reviewerDefault = reviewerChoices.some(choice => choice.value === existing.reviewer?.provider)
        ? existing.reviewer.provider
        : 'gemini';
    const reviewerProvider = await select({
        message: 'Select the cloud provider BananaSplit should use for review:',
        choices: reviewerChoices,
        default: reviewerDefault,
        loop: false
    });

    const reviewerSetup = await setupProvider(reviewerProvider, {
        provider: reviewerProvider,
        model: existing.reviewer?.model,
        apiKey: existing.reviewer?.apiKey || (config.provider === reviewerProvider ? config.apiKey : undefined),
        authType: existing.reviewer?.authType || (config.provider === reviewerProvider ? config.authType : undefined),
        openaiCodexEffort: existing.reviewer?.openaiCodexEffort || (config.provider === reviewerProvider ? config.openaiCodexEffort : undefined),
        useExtendedCache: existing.reviewer?.useExtendedCache ?? (config.provider === reviewerProvider ? config.useExtendedCache : undefined),
        claudeEffort: existing.reviewer?.claudeEffort ?? (config.provider === reviewerProvider ? config.claudeEffort : undefined)
    });

    if (reviewerProvider === 'openai' && reviewerSetup.authType === 'oauth') {
        reviewerSetup.openaiCodexEffort = await select({
            message: 'Select OpenAI Codex reasoning effort for BananaSplit review/fix:',
            choices: [
                { name: 'Low (faster and cheaper)', value: 'low' },
                { name: 'Medium (balanced default)', value: 'medium' },
                { name: 'High (hard reasoning and complex fixes)', value: 'high' },
                { name: 'Extra-High (deepest reasoning, highest cost/latency)', value: 'xhigh' }
            ],
            default: reviewerSetup.openaiCodexEffort || 'medium',
            loop: false
        });
    }

    config.bananaSplit = {
        enabled: true,
        local: copyBananaSplitProviderConfig(localProvider, localSetup),
        reviewer: copyBananaSplitProviderConfig(reviewerProvider, reviewerSetup)
    };

    return config;
}

export async function setupProvider(provider, config = {}) {
    config.provider = provider;

    const AUTO_CHOICE = { name: chalk.cyan('⚡ Auto Mode') + chalk.gray(' (AI picks the best model per prompt)'), value: 'auto' };

    if (provider === 'gemini') {
        config.apiKey = await input({
            message: 'Enter your GEMINI_API_KEY:',
            default: config.apiKey
        });
        config.model = await select({
            message: 'Select a Gemini model:',
            choices: [AUTO_CHOICE, ...GEMINI_MODELS]
        });
    } else if (provider === 'ollama_cloud') {
            config.apiKey = await input({
                message: 'Enter your OLLAMA_API_KEY (from ollama.com):',
                default: config.apiKey
            });

            const choices = [AUTO_CHOICE, ...OLLAMA_CLOUD_MODELS, { name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' }];
            let selectedModel = await select({
                message: 'Select an Ollama Cloud model:',
                choices,
                loop: false,
                pageSize: Math.max(choices.length, 15)
            });

            if (selectedModel === 'CUSTOM_ID') {
                selectedModel = await input({
                    message: 'Enter the exact model ID (e.g., gemma3:27b-cloud):',
                    validate: (v) => v.trim().length > 0 || 'Model ID cannot be empty'
                });
            }
            config.model = selectedModel;
        } else if (provider === 'claude') {
        config.apiKey = await input({
            message: 'Enter your ANTHROPIC_API_KEY:',
            default: config.apiKey
        });
        config.model = await select({
            message: 'Select a Claude model:',
            choices: [AUTO_CHOICE, ...CLAUDE_MODELS]
        });
        
        config.useExtendedCache = await select({
            message: 'Select Prompt Caching duration:',
            choices: [
                { name: '5 Minutes (Default - Cheaper to write)', value: false },
                { name: '1 Hour (Better for long coding sessions - Costs 2x more to write)', value: true }
            ],
            default: false
        });
    } else if (provider === 'mistral') {
        config.apiKey = await input({
            message: 'Enter your MISTRAL_API_KEY (from console.mistral.ai):',
            default: config.apiKey
        });
        
        const choices = [AUTO_CHOICE, ...MISTRAL_MODELS, { name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' }];
        let selectedModel = await select({
            message: 'Select a Mistral model:',
            choices,
            loop: false,
            pageSize: 10
        });

        if (selectedModel === 'CUSTOM_ID') {
            selectedModel = await input({
                message: 'Enter the exact Mistral model ID (e.g., mistral-large-latest):',
                validate: (v) => v.trim().length > 0 || 'Model ID cannot be empty'
            });
        }
        config.model = selectedModel;
    } else if (provider === 'deepseek') {
        config.apiKey = await input({
            message: 'Enter your DEEPSEEK_API_KEY (from platform.deepseek.com):',
            default: config.apiKey
        });

        const choices = [AUTO_CHOICE, ...DEEPSEEK_MODELS, { name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' }];
        let selectedModel = await select({
            message: 'Select a DeepSeek model:',
            choices,
            loop: false,
            pageSize: 10
        });

        if (selectedModel === 'CUSTOM_ID') {
            selectedModel = await input({
                message: 'Enter the exact DeepSeek model ID (e.g., deepseek-v4-flash):',
                validate: (v) => v.trim().length > 0 || 'Model ID cannot be empty'
            });
        }
        config.model = selectedModel;
    } else if (provider === 'kimi') {
        config.apiKey = await input({
            message: 'Enter your MOONSHOT_API_KEY (from platform.kimi.ai):',
            default: config.apiKey
        });

        const choices = [AUTO_CHOICE, ...KIMI_MODELS, { name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' }];
        let selectedModel = await select({
            message: 'Select a Kimi model:',
            choices,
            loop: false,
            pageSize: 12
        });

        if (selectedModel === 'CUSTOM_ID') {
            selectedModel = await input({
                message: 'Enter the exact Kimi model ID (e.g., kimi-k2.6):',
                validate: (v) => v.trim().length > 0 || 'Model ID cannot be empty'
            });
        }
        config.model = selectedModel;
    } else if (provider === 'openai') {
        const authMethod = await select({
            message: 'How would you like to authenticate with OpenAI?',
            choices: [
                { name: 'API Key (Paid, Stable)', value: 'api_key' },
                { name: 'Sign in with ChatGPT (Free/Plus via Codex OAuth)', value: 'oauth' }
            ],
            default: config.authType || 'api_key'
        });

        config.authType = authMethod;

        if (authMethod === 'oauth') {
            console.log(chalk.cyan("\nChecking official OpenAI Codex login..."));
            const authFile = path.join(os.homedir(), '.codex', 'auth.json');
            if (!fsSync.existsSync(authFile)) {
                console.log(chalk.yellow("Could not find ~/.codex/auth.json. Launching login..."));
                try {
                    execSync('npx -y @openai/codex login', { stdio: 'inherit' });
                } catch (e) { }
            }

            if (!fsSync.existsSync(authFile)) {
                console.log(chalk.yellow("Login failed. Reverting to manual API key."));
                config.authType = 'api_key';
                config.apiKey = await input({
                    message: 'Enter your OPENAI_API_KEY:',
                    default: config.apiKey
                });
                config.model = await select({
                    message: 'Select a model:',
                    choices: [AUTO_CHOICE, ...OPENAI_MODELS]
                });
            } else {
                console.log(chalk.green("OAuth token found!"));
                config.model = await select({
                    message: 'Select a Codex model:',
                    choices: [AUTO_CHOICE, ...CODEX_MODELS]
                });
            }
        } else {
            // Standard API Key flow
            config.apiKey = await input({
                message: 'Enter your OPENAI_API_KEY:',
                default: config.apiKey
            });
            config.model = await select({
                message: 'Select a model:',
                choices: [AUTO_CHOICE, ...OPENAI_MODELS]
            });
        }
    } else if (provider === 'openrouter') {
        config.apiKey = await input({
            message: 'Enter your OPENROUTER_API_KEY (from openrouter.ai/keys):',
            default: config.apiKey
        });

        let modelAccepted = false;
        while (!modelAccepted) {
            const modelId = await input({
                message: 'Enter the OpenRouter model ID (e.g., nvidia/nemotron-3-super-120b-a12b:free):',
                default: config.model || '',
                validate: (v) => v.trim().length > 0 || 'Model ID cannot be empty'
            });

            console.log(chalk.cyan(`\nValidating model "${modelId}" on OpenRouter...`));
            try {
                const res = await fetch('https://openrouter.ai/api/v1/models');
                const data = await res.json();
                const found = data.data?.find(m => m.id === modelId.trim());

                if (!found) {
                    console.log(chalk.red(`Model "${modelId}" was not found on OpenRouter.`));
                    console.log(chalk.yellow('Browse available models at: https://openrouter.ai/models'));
                    const retry = await input({ message: 'Try a different model ID? (y/n):', default: 'y' });
                    if (retry.toLowerCase() !== 'y') {
                        config.model = modelId.trim();
                        modelAccepted = true;
                        console.log(chalk.yellow('Proceeding anyway — tool calling may not work.'));
                    }
                    continue;
                }

                const supported = found.supported_parameters || [];
                const hasToolCalling = supported.includes('tools') || supported.includes('tool_choice');

                if (hasToolCalling) {
                    console.log(chalk.green(`✔ "${modelId}" supports tool calling. Good to go!`));
                    config.model = modelId.trim();
                    modelAccepted = true;
                } else {
                    console.log(chalk.red(`✘ "${modelId}" does NOT support tool calling.`));
                    console.log(chalk.gray(`   Supported parameters: ${supported.join(', ') || 'none listed'}`));
                    console.log(chalk.yellow('Banana Code requires tool calling to function correctly.'));
                    const retry = await input({ message: 'Choose a different model? (y/n):', default: 'y' });
                    if (retry.toLowerCase() !== 'y') {
                        config.model = modelId.trim();
                        modelAccepted = true;
                        console.log(chalk.yellow('Proceeding anyway — tool calling will likely fail.'));
                    }
                }
            } catch (err) {
                console.log(chalk.red(`Could not reach OpenRouter API: ${err.message}`));
                console.log(chalk.yellow('Skipping validation and using the model ID as-is.'));
                config.model = modelId.trim();
                modelAccepted = true;
            }
        }
    } else if (provider === 'lmstudio') {
        config.lmStudioBaseUrl = await input({
            message: 'Enter your LM Studio base URL:',
            default: config.lmStudioBaseUrl || 'http://localhost:1234/v1'
        });

        console.log(chalk.cyan("Detecting running LM Studio models..."));
        try {
            const response = await fetch(`${config.lmStudioBaseUrl}/models`);
            const data = await response.json();
            const models = data.data.map(m => m.id);
            if (models.length > 0) {
                config.model = await select({
                    message: 'Select a model:',
                    choices: models.map(m => ({ name: m, value: m })),
                    default: config.model && config.model !== 'auto' ? config.model : undefined
                });
            } else {
                console.log(chalk.yellow("No models found. Please load a model in LM Studio first."));
                config.model = await input({ message: 'Fallback model name to configure:', default: config.model || 'model-identifier' });
            }
        } catch (error) {
            console.log(chalk.red(`Could not connect to LM Studio at ${config.lmStudioBaseUrl}.`));
            config.model = await input({ message: 'Fallback model name to configure:', default: config.model || 'model-identifier' });
        }
    } else if (provider === 'ollama') {
        console.log(chalk.cyan("Detecting running Ollama models..."));
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            const data = await response.json();
            const models = data.models.map(m => m.name);
            if (models.length > 0) {
                config.model = await select({
                    message: 'Select a model:',
                    choices: models.map(m => ({ name: m, value: m })),
                    default: config.model && config.model !== 'auto' ? config.model : undefined
                });
            } else {
                console.log(chalk.yellow("No models found. Please pull a model using `ollama pull <model>` later."));
                config.model = await input({ message: 'Fallback model name to configure:', default: config.model || 'llama3' });
            }
        } catch (error) {
            console.log(chalk.red("Could not connect to Ollama at localhost:11434."));
            config.model = await input({ message: 'Fallback model name to configure:', default: config.model || 'llama3' });
        }
    } else if (pluginRegistry.providers[provider]) {
        const ProvClass = pluginRegistry.providers[provider].ProviderClass;
        // If the plugin implements a custom setup wizard, let it take over
        if (typeof ProvClass.setup === 'function') {
            config = await ProvClass.setup(config);
        } else if (typeof ProvClass.getModels === 'function') {
            // Otherwise just prompt for a model if it provides a list of models
            try {
                const choices = await ProvClass.getModels(config);
                if (choices && choices.length > 0) {
                    config.model = await select({
                        message: `Select a model for ${pluginRegistry.providers[provider].name}:`,
                        choices,
                        default: config.model
                    });
                }
            } catch (e) {
                console.log(chalk.red(`Failed to fetch models for plugin provider: ${e.message}`));
            }
        }
    }
    return config;
}

async function runSetupWizard() {
    console.log(chalk.yellow("\nWelcome to 🍌 Banana Code! Let's get you set up.\n"));

    const provider = await select({
        message: 'Which AI provider would you like to use as default?',
        choices: [
            { name: 'Google Gemini', value: 'gemini' },
            { name: 'Anthropic Claude', value: 'claude' },
            { name: 'OpenAI', value: 'openai' },
            { name: 'Mistral AI', value: 'mistral' },
            { name: 'DeepSeek', value: 'deepseek' },
            { name: 'Kimi AI (Moonshot)', value: 'kimi' },
            { name: 'OpenRouter (Any Model)', value: 'openrouter' },
            { name: 'Ollama Cloud', value: 'ollama_cloud' },
            { name: 'Ollama (Local)', value: 'ollama' },
            { name: 'LM Studio (Local)', value: 'lmstudio' }
        ],
        loop: false,
        pageSize: 10
    });

    const config = await setupProvider(provider);
    config.useMemory = true;

    console.log(chalk.cyan('\n🛡️  Banana Guard (AI Auto-Approve)'));
    console.log(chalk.gray('This feature uses a smart model to automatically approve safe shell commands (like ls, git status, etc) so you don\'t have to click "Allow" constantly.'));
    
    const { select: guardSelect } = await import('@inquirer/prompts');
    const guardChoice = await guardSelect({
        message: 'Would you like to enable Banana Guard?',
        choices: [
            { name: 'Yes (Smarter & Faster Workflow - Recommended)', value: true },
            { name: 'No (Manually approve every command)', value: false }
        ],
        default: true
    });
    config.useBananaGuard = guardChoice;

    await saveConfig(config);
    console.log(chalk.yellow.bold("\nYou're all peeled and ready. Type your first message!\n"));
    return config;
}
