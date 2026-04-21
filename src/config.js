import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { select, input } from '@inquirer/prompts';
import { execSync } from 'child_process';
import fsSync from 'fs';
import chalk from 'chalk';

import { GEMINI_MODELS, CLAUDE_MODELS, OPENAI_MODELS, CODEX_MODELS, OLLAMA_CLOUD_MODELS, MISTRAL_MODELS } from './constants.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'banana-code');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function loadConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return await runSetupWizard();
        }
        throw error;
    }
}

export async function saveConfig(config) {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        console.error(chalk.red("Failed to save config:"), error);
    }
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
