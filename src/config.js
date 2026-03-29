import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { select, input } from '@inquirer/prompts';
import { execSync } from 'child_process';
import fsSync from 'fs';
import chalk from 'chalk';

import { GEMINI_MODELS, CLAUDE_MODELS, OPENAI_MODELS, CODEX_MODELS, OLLAMA_CLOUD_MODELS } from './constants.js';

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

    if (provider === 'gemini') {
        config.apiKey = await input({
            message: 'Enter your GEMINI_API_KEY:',
            default: config.apiKey
        });
        config.model = await select({
            message: 'Select a Gemini model:',
            choices: GEMINI_MODELS
        });
    } else if (provider === 'ollama_cloud') {
            config.apiKey = await input({
                message: 'Enter your OLLAMA_API_KEY (from ollama.com):',
                default: config.apiKey
            });

            const choices = [...OLLAMA_CLOUD_MODELS, { name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' }];
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
            choices: CLAUDE_MODELS
        });
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
                    choices: OPENAI_MODELS
                });
            } else {
                console.log(chalk.green("OAuth token found!"));
                config.model = await select({
                    message: 'Select a Codex model:',
                    choices: CODEX_MODELS
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
                choices: OPENAI_MODELS
            });
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
                    default: config.model
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
            { name: 'Ollama Cloud', value: 'ollama_cloud' },
            { name: 'Ollama (Local)', value: 'ollama' }
        ]
    });

    const config = await setupProvider(provider);

    await saveConfig(config);
    console.log(chalk.yellow.bold("\nYou're all peeled and ready. Type your first message!\n"));
    return config;
}
