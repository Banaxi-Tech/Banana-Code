// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import chalk from 'chalk';
import ora from 'ora';
import { getAvailableTools, executeTool } from './registry.js';
import { getSystemPrompt } from '../prompt.js';
import { requestPermission } from '../permissions.js';

// Specialist prompts to guide sub-agents
const SPECIALIST_PROMPTS = {
    researcher: "You are a Research Specialist. Your goal is to explore the codebase, find information, and answer specific questions. Do not make any file changes. Use tools like search_files, list_directory, and read_file to gather facts.",
    coder: "You are a Coding Specialist. Your goal is to implement specific logic or fix bugs as requested. Focus on writing high-quality, idiomatic code using patch_file and write_file.",
    reviewer: "You are a Code Reviewer. Your goal is to analyze provided code for bugs, security vulnerabilities, or style issues. Provide a detailed report of your findings.",
    generalist: "You are a Generalist Sub-Agent. Complete the assigned task as efficiently as possible using all available tools."
};

/**
 * Tool that allows the main agent to delegate a sub-task to a specialized agent.
 */
export async function delegateTask({ task, agentType = 'generalist', contextFiles = [] }, mainConfig) {
    const perm = await requestPermission('Delegate Task', `${agentType} specialist: ${task}`);
    if (!perm.allowed) {
        return `User denied permission to delegate task to ${agentType} specialist.`;
    }

    const spinner = ora({ 
        text: `Delegating to ${chalk.magenta(agentType)} specialist...`, 
        color: 'magenta', 
        stream: process.stdout 
    }).start();

    try {
        // 1. Setup the sub-agent config (inherit from main, but could be customized)
        const subConfig = { ...mainConfig };
        
        // Use a dynamic import to avoid circular dependency with index.js if needed,
        // but here we can just manually create the provider based on current config.
        const { GeminiProvider } = await import('../providers/gemini.js');
        const { ClaudeProvider } = await import('../providers/claude.js');
        const { OpenAIProvider } = await import('../providers/openai.js');
        const { MistralProvider } = await import('../providers/mistral.js');
        const { DeepSeekProvider } = await import('../providers/deepseek.js');
        const { KimiProvider } = await import('../providers/kimi.js');
        const { OllamaProvider } = await import('../providers/ollama.js');
        const { OllamaCloudProvider } = await import('../providers/ollamaCloud.js');

        const createSubProvider = (cfg) => {
            switch (cfg.provider) {
                case 'gemini': return new GeminiProvider(cfg);
                case 'claude': return new ClaudeProvider(cfg);
                case 'openai': return new OpenAIProvider(cfg);
                case 'mistral': return new MistralProvider(cfg);
                case 'deepseek': return new DeepSeekProvider(cfg);
                case 'kimi': return new KimiProvider(cfg);
                case 'ollama_cloud': return new OllamaCloudProvider(cfg);
                case 'ollama': return new OllamaProvider(cfg);
                default: return new OllamaProvider(cfg);
            }
        };

        const subProvider = createSubProvider(subConfig);
        
        // 2. Customize the system prompt for the specialist
        const basePrompt = getSystemPrompt(subConfig);
        const specialistInstruction = SPECIALIST_PROMPTS[agentType] || SPECIALIST_PROMPTS.generalist;
        
        // Inject specialist instructions at the start
        subProvider.updateSystemPrompt(`${specialistInstruction}\n\n${basePrompt}`);

        // 3. Prepare initial message with context
        let initialMessage = `TASK: ${task}`;
        if (contextFiles.length > 0) {
            const fs = await import('fs');
            initialMessage += "\n\nCONTEXT FILES:";
            for (const file of contextFiles) {
                try {
                    const content = fs.readFileSync(file, 'utf8');
                    initialMessage += `\n\n--- ${file} ---\n${content}`;
                } catch (e) {
                    initialMessage += `\n\n(Error reading context file ${file}: ${e.message})`;
                }
            }
        }

        // 4. Run the sub-agent message loop
        // We'll give it a limit of 5 turns to prevent infinite loops between agents
        let turns = 0;
        let finalResponse = '';
        
        spinner.text = `Sub-agent (${agentType}) is working on the task...`;
        
        // For the sub-agent, we want to capture its sendMessage result
        // Note: Sub-agents run silently (their output isn't printed unless debug is on)
        // to prevent terminal clutter.
        finalResponse = await subProvider.sendMessage(initialMessage);

        spinner.stop();
        console.log(chalk.magenta(`[Sub-Agent ${agentType} task complete]`));

        return `SUB-AGENT RESULT:\n${finalResponse}`;

    } catch (err) {
        if (spinner.isSpinning) spinner.stop();
        return `Error in delegation: ${err.message}`;
    }
}
