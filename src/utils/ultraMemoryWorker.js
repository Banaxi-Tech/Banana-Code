// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { GeminiProvider } from '../providers/gemini.js';
import { ClaudeProvider } from '../providers/claude.js';
import { OpenAIProvider } from '../providers/openai.js';
import { OllamaProvider } from '../providers/ollama.js';
import { OllamaCloudProvider } from '../providers/ollamaCloud.js';
import { MistralProvider } from '../providers/mistral.js';
import { OpenRouterProvider } from '../providers/openrouter.js';
import { DeepSeekProvider } from '../providers/deepseek.js';
import { KimiProvider } from '../providers/kimi.js';

import fs from 'fs';

// This worker runs as a completely separate Node.js process.
// It receives data on stdin and outputs the extracted facts to stdout.
// Since it's a separate process, its stdout and stderr are NOT connected
// to your terminal, so it CANNOT mess with your UI.

async function run() {
    let inputData = '';
    
    // Read payload from stdin
    for await (const chunk of process.stdin) {
        inputData += chunk;
    }

    if (!inputData) process.exit(1);

    const { config, currentMemories, conversationText } = JSON.parse(inputData);

    // Completely mute stdout and stderr during execution so providers cannot 
    // leak status messages (like "Thinking...") into the result stream.
    const realStdoutWrite = process.stdout.write.bind(process.stdout);
    const realStderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = () => true;
    process.stderr.write = () => true;

    // Mute console within this process just in case
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    function createProvider(overConfig = config) {
        // Force API mode and disable UI features
        const silentConfig = { 
            ...overConfig, 
            isApiMode: true, 
            useMarkedTerminal: false, 
            debug: false 
        };
        
        switch (silentConfig.provider) {
            case 'gemini': return new GeminiProvider(silentConfig);
            case 'claude': return new ClaudeProvider(silentConfig);
            case 'openai': return new OpenAIProvider(silentConfig);
            case 'mistral': return new MistralProvider(silentConfig);
            case 'deepseek': return new DeepSeekProvider(silentConfig);
            case 'kimi': return new KimiProvider(silentConfig);
            case 'openrouter': return new OpenRouterProvider(silentConfig);
            case 'ollama_cloud': return new OllamaCloudProvider(silentConfig);
            case 'ollama': return new OllamaProvider(silentConfig);
            default: return new OllamaProvider(silentConfig);
        }
    }

    const extractionPrompt = `SYSTEM: You are a memory extractor. Analyze the following conversation and identify NEW, DURABLE facts about the user's preferences, project details, or common tasks.

Current known memories (CRITICAL: DO NOT EXTRACT THESE AGAIN):
${currentMemories.map(m => "- " + m.fact).join('\n')}

Rules:
1. ONLY include facts that are useful in FUTURE sessions (e.g., "User prefers Vanilla CSS", "Project uses Express").
2. DO NOT include transient facts or tool execution details.
3. CRITICAL: Review the "Current known memories" list above. If a fact is already listed there (even in different words), DO NOT include it in your response.
4. Format each fact as a simple, independent, and concise sentence.
5. If no new durable facts are found, reply with exactly "NONE".
6. Reply ONLY with the facts (one per line) or "NONE".

Conversation:
${conversationText}`;

    try {
        const extractor = createProvider();
        const result = await extractor.sendMessage(extractionPrompt);
        
        // Restore stdout and send ONLY the final result
        process.stdout.write = realStdoutWrite;
        process.stdout.write(result || "NONE");
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
}

run();
