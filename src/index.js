// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import readline from 'readline';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import { confirmProjectLocalSettingsTrust, getBananaSplitLocalConfig, listLlamaCppModels, loadConfig, saveConfig, setupBananaSplit, setupImageGen, setupProvider } from './config.js';
import { runStartup } from './startup.js';
import { getSessionPermissions, setAutoAcceptEditsMode, setGoalsPermissionMode, setYoloMode } from './permissions.js';
import { cleanupTerminalSessions } from './tools/terminal.js';
import { getCreatedPlan, resetCreatedPlan } from './tools/createPlan.js';

import { GeminiProvider } from './providers/gemini.js';
import { ClaudeProvider } from './providers/claude.js';
import { OpenAIProvider } from './providers/openai.js';
import { LMStudioProvider } from './providers/lmstudio.js';
import { LlamaCppProvider } from './providers/llamacpp.js';
import { OllamaProvider } from './providers/ollama.js';
import { OllamaCloudProvider } from './providers/ollamaCloud.js';
import { MistralProvider } from './providers/mistral.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { KimiProvider } from './providers/kimi.js';
import { QwenProvider } from './providers/qwen.js';

import { loadSession, saveSession, generateSessionId, getLatestSessionId, listSessions } from './sessions.js';
import { getSystemPrompt } from './prompt.js';
import { printMarkdown } from './utils/markdown.js';
import { estimateConversationTokens } from './utils/tokens.js';
import { mcpManager } from './utils/mcp.js';
import { startApiServer } from './server.js';
import { loadPlugins, pluginRegistry, installPlugin, removePlugin, getConfiguredPlugins } from './utils/plugins.js';
import { REMOTE_IMAGE_LIMITS, connectRemoteTooling, disconnectRemoteTooling, finalizeTurn, publishRemoteCapabilities, redeemRemotePairingCode, resetRemoteAiResponseTracking, sendRemoteAiMessage, sendRemoteUserMessageError, sendRemoteUserMessageStatus } from './remote.js';
import { promptToMergeExternalAgentInstructions } from './utils/projectInstructions.js';
import { extractUltrathinkDirective, isUltrathinkMention, providerSupportsUltrathink, rainbowUltrathink, rainbowVoice, styleUltrathinkMentions, styleVoiceCommands } from './utils/ultrathink.js';
import { cleanupVoiceClip, getVoiceApiKey, getVoiceConfig, getVoiceProvider, getVoiceProviderLabel, hasUsableVoiceConfig, isSupportedVoiceFile, recordVoiceClip, setupVoiceConfig, transcribeVoice } from './voice.js';
import { setRuntimeModelOverride } from './utils/modelSwitch.js';
import { disconnectGitHubIntegration, setupGitHubIntegration, showGitHubStatus } from './github.js';
import { queueNewUiAssistantMarker } from './utils/newUi.js';
import { submitFeedback } from './feedback.js';

let config;
let providerInstance;
// Expose for Banana Guard cost tracking
Object.defineProperty(global, 'activeProviderInstance', {
    get() { return providerInstance; },
    set(val) { providerInstance = val; },
    configurable: true
});

let currentSessionId;
let currentSessionTitle = null;
const commandHistory = [];
let historyIndex = -1;
let currentInputSaved = '';
let activePromptInterrupt = null;
let lastAssistantMessageText = '';

function createProvider(overrideConfig = null) {
    const activeConfig = overrideConfig || getBananaSplitLocalConfig(config);
    
    // Check dynamic plugins first
    if (pluginRegistry.providers[activeConfig.provider]) {
        const ProviderClass = pluginRegistry.providers[activeConfig.provider].ProviderClass;
        return new ProviderClass(activeConfig);
    }

    switch (activeConfig.provider) {
        case 'gemini': return new GeminiProvider(activeConfig);
        case 'claude': return new ClaudeProvider(activeConfig);
        case 'openai': return new OpenAIProvider(activeConfig);
        case 'mistral': return new MistralProvider(activeConfig);
        case 'deepseek': return new DeepSeekProvider(activeConfig);
        case 'kimi': return new KimiProvider(activeConfig);
        case 'qwen': return new QwenProvider(activeConfig);
        case 'openrouter': return new OpenRouterProvider(activeConfig);
        case 'ollama_cloud': return new OllamaCloudProvider(activeConfig);
        case 'ollama': return new OllamaProvider(activeConfig);
        case 'lmstudio': return new LMStudioProvider(activeConfig);
        case 'llamacpp': return new LlamaCppProvider(activeConfig);
        default:
            console.log(chalk.red(`Unknown provider: ${activeConfig.provider}. Defaulting to Ollama.`));
            activeConfig.provider = 'ollama';
            return new OllamaProvider(activeConfig);
    }
}

function getActiveProviderId() {
    return config?.bananaSplit?.enabled && config.bananaSplit.local?.provider
        ? config.bananaSplit.local.provider
        : config.provider;
}

function isPortableChatHistory(messages) {
    return Array.isArray(messages) && messages.every(msg => {
        return msg && typeof msg === 'object' && !Object.prototype.hasOwnProperty.call(msg, 'parts');
    });
}

function replaceProviderForCurrentConfig({ preservePortableHistory = false } = {}) {
    const savedMessages = providerInstance?.messages;
    providerInstance = createProvider();

    if (
        preservePortableHistory &&
        providerInstance?.messages !== undefined &&
        getActiveProviderId() !== 'gemini' &&
        isPortableChatHistory(savedMessages)
    ) {
        providerInstance.messages = savedMessages;
    }
}

function textFromMessageContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content.map(part => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        if (Array.isArray(part.content)) return textFromMessageContent(part.content);
        return '';
    }).filter(Boolean).join('\n');
}

function textFromAssistantMessage(message) {
    if (!message || typeof message !== 'object') return '';
    if (Array.isArray(message.parts)) {
        return message.parts.map(part => part?.text || '').filter(Boolean).join('\n');
    }
    return textFromMessageContent(message.content);
}

function getLastAssistantMessageText(messages = providerInstance?.messages) {
    if (messages === providerInstance?.messages && lastAssistantMessageText.trim()) return lastAssistantMessageText;
    if (!Array.isArray(messages)) return '';

    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!['assistant', 'model', 'output_text'].includes(msg?.role)) continue;
        const text = textFromAssistantMessage(msg);
        if (text.trim()) return text;
    }
    return '';
}

function getClipboardCommands() {
    if (process.platform === 'darwin') {
        return [{ command: 'pbcopy', args: [] }];
    }
    if (process.platform === 'win32') {
        return [{ command: 'clip.exe', args: [] }];
    }
    return [
        { command: 'wl-copy', args: [] },
        { command: 'xclip', args: ['-selection', 'clipboard'] },
        { command: 'xsel', args: ['--clipboard', '--input'] },
        { command: 'clip.exe', args: [] }
    ];
}

function copyTextWithCommand(text, { command, args }) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            child.kill();
            if (!settled) {
                settled = true;
                reject(new Error(`${command} timed out`));
            }
        }, 5000);

        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });
        child.on('error', err => {
            clearTimeout(timeout);
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
        child.on('close', code => {
            clearTimeout(timeout);
            if (settled) return;
            settled = true;
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
        });
        child.stdin.end(text);
    });
}

async function copyTextToClipboard(text) {
    const errors = [];
    for (const clipboardCommand of getClipboardCommands()) {
        try {
            await copyTextWithCommand(text, clipboardCommand);
            return clipboardCommand.command;
        } catch (err) {
            errors.push(`${clipboardCommand.command}: ${err.message}`);
        }
    }
    throw new Error(errors.join('; '));
}

async function requestModelSwitchFromCli({ currentModel, recommendedModel, reason }) {
    const { select } = await import('@inquirer/prompts');
    const choice = await select({
        message: `The model recommends switching from ${currentModel} to ${recommendedModel}.${reason ? ` Reason: ${reason}` : ''}`,
        choices: [
            { name: `Switch to ${recommendedModel}`, value: 'switch' },
            { name: `Continue with ${currentModel}`, value: 'continue' }
        ],
        loop: false
    });

    if (choice !== 'switch') {
        return { accepted: false, model: currentModel };
    }

    setRuntimeModelOverride(providerInstance, recommendedModel);
    return { accepted: true, model: recommendedModel };
}

function attachRuntimeModelSwitchHandler(provider = providerInstance) {
    if (!provider?.config) return;
    provider.config.requestModelSwitch = requestModelSwitchFromCli;
}

function messageHasToolActivity(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.role === 'tool' || message.type === 'function_call_output') return true;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;

    const content = Array.isArray(message.content) ? message.content : [];
    if (content.some(part => part?.type === 'tool_use' || part?.type === 'tool_result')) return true;

    const parts = Array.isArray(message.parts) ? message.parts : [];
    return parts.some(part => part?.functionCall || part?.functionResponse);
}

function hasToolActivitySince(provider, startIndex) {
    const messages = provider?.messages;
    if (!Array.isArray(messages)) return false;
    return messages.slice(startIndex).some(messageHasToolActivity);
}

function isEmptyAssistantResponse(responseText) {
    return typeof responseText !== 'string' || responseText.trim().length === 0;
}

const EMPTY_TOOL_RESPONSE_CONTINUATION = `SYSTEM: Your previous turn used tools but ended without a final message.
Continue from the latest tool results and complete the user's request now. If the work is done, give a concise final answer. If another tool call is required, call it. Do not repeat completed tool calls unless the latest tool result shows that is necessary.`;

const IMAGE_ATTACHMENT_PROVIDERS = new Set([
    'gemini',
    'claude',
    'openai',
    'mistral',
    'deepseek',
    'kimi',
    'qwen',
    'openrouter',
    'ollama_cloud',
    'ollama',
    'lmstudio',
    'llamacpp'
]);

let userTurnQueue = Promise.resolve();

function enqueueCliTask(task) {
    const run = userTurnQueue
        .catch(() => {})
        .then(task);
    userTurnQueue = run.catch(() => {});
    return run;
}

function waitForQueuedCliWork() {
    return userTurnQueue.catch(() => {});
}

function getRemoteChatCapabilities() {
    const activeConfig = getBananaSplitLocalConfig(config || {});
    const provider = getActiveProviderId();
    return {
        imageAttachments: IMAGE_ATTACHMENT_PROVIDERS.has(provider),
        provider,
        model: providerInstance?.modelName || activeConfig.model || config?.model || '',
        maxImages: REMOTE_IMAGE_LIMITS.maxImages,
        maxImageBytes: REMOTE_IMAGE_LIMITS.maxImageBytes
    };
}

function publishCurrentRemoteCapabilities() {
    publishRemoteCapabilities(getRemoteChatCapabilities());
}

function connectCurrentRemoteTooling(credentials) {
    return connectRemoteTooling(credentials, {
        getCapabilities: getRemoteChatCapabilities,
        onUserMessage: handleRemoteUserMessage
    });
}

function interruptPromptForBackgroundTurn() {
    if (typeof activePromptInterrupt === 'function') {
        activePromptInterrupt();
    }
}

function decodedBase64Bytes(base64) {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
}

function normalizeRemoteImages(images = []) {
    if (!Array.isArray(images)) return [];
    if (images.length > REMOTE_IMAGE_LIMITS.maxImages) {
        throw new Error(`At most ${REMOTE_IMAGE_LIMITS.maxImages} images can be attached.`);
    }

    let totalBytes = 0;
    return images.map((img, index) => {
        const mimeType = String(img?.mimeType || img?.mediaType || '').toLowerCase();
        const base64 = typeof img?.base64 === 'string' ? img.base64.trim() : '';
        if (!REMOTE_IMAGE_LIMITS.mimeTypes.includes(mimeType)) {
            throw new Error(`Image ${index + 1} has an unsupported type.`);
        }
        if (!base64) {
            throw new Error(`Image ${index + 1} is empty.`);
        }

        const bytes = decodedBase64Bytes(base64);
        if (!Number.isFinite(bytes) || bytes <= 0) {
            throw new Error(`Image ${index + 1} is not valid base64.`);
        }
        if (bytes > REMOTE_IMAGE_LIMITS.maxImageBytes) {
            throw new Error(`Image ${index + 1} is larger than 2 MB.`);
        }

        totalBytes += bytes;
        if (totalBytes > REMOTE_IMAGE_LIMITS.maxTotalImageBytes) {
            throw new Error('Attached images are larger than 8 MB total.');
        }

        return { base64, mimeType };
    });
}

async function prepareUserTurnInput(rawText, initialImages = []) {
    let finalInput = String(rawText || '');
    let attachedImages = [...initialImages];
    let ultrathinkEnabled = false;
    const activeProviderConfig = getBananaSplitLocalConfig(config);
    const ultrathinkDirective = extractUltrathinkDirective(finalInput);
    if (ultrathinkDirective.enabled) {
        finalInput = ultrathinkDirective.text;
        if (providerSupportsUltrathink(activeProviderConfig)) {
            ultrathinkEnabled = true;
            console.log(`${chalk.gray('(Using ')}${rainbowUltrathink()}${chalk.gray(' maximum reasoning for this message)')}`);
        }
    }

    const fileMentions = [];
    const mentionRegex = /@@?("[^"]+"|'[^']+'|[^\s]+)/g;
    let match;
    while ((match = mentionRegex.exec(finalInput)) !== null) {
        if (isUltrathinkMention(match[0])) continue;
        fileMentions.push(match[0]);
    }

    if (fileMentions.length > 0) {
        let addedFiles = 0;
        let addedImages = 0;
        const fsSync = await import('fs');
        const path = await import('path');
        const os = await import('os');

        for (const mention of fileMentions) {
            const isDouble = mention.startsWith('@@');
            let rawPath = isDouble ? mention.substring(2) : mention.substring(1);
            if ((rawPath.startsWith('"') && rawPath.endsWith('"')) || (rawPath.startsWith("'") && rawPath.endsWith("'"))) {
                rawPath = rawPath.substring(1, rawPath.length - 1);
            }

            let filepath;
            if (rawPath.startsWith('~')) {
                rawPath = path.join(os.homedir(), rawPath.substring(1));
            }

            if (path.isAbsolute(rawPath) || rawPath.startsWith('/') || rawPath.startsWith('\\')) {
                filepath = rawPath;
            } else {
                filepath = path.resolve(process.cwd(), rawPath);
            }

            try {
                if (!fsSync.existsSync(filepath)) {
                    throw new Error('File does not exist');
                }

                const stat = fsSync.statSync(filepath);
                if (!stat.isFile()) continue;

                const lower = filepath.toLowerCase();
                const isImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif');
                if (isImage) {
                    const buffer = fsSync.readFileSync(filepath);
                    const base64 = buffer.toString('base64');
                    let mimeType = 'image/png';
                    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
                    else if (lower.endsWith('.webp')) mimeType = 'image/webp';
                    else if (lower.endsWith('.gif')) mimeType = 'image/gif';

                    attachedImages.push({ base64, mimeType, path: filepath });
                    addedImages++;
                } else {
                    const content = fsSync.readFileSync(filepath, 'utf8');
                    finalInput += `\n\n--- File Context: ${filepath} ---\n${content}\n--- End of ${filepath} ---`;
                    addedFiles++;
                }
            } catch (e) {
                console.log(chalk.yellow(`Warning: Could not read file for mention ${mention} (Resolved path: ${filepath})`));
            }
        }

        if (addedFiles > 0 || addedImages > 0) {
            const fileMsg = addedFiles > 0 ? `${addedFiles} file(s)` : '';
            const imgMsg = addedImages > 0 ? `${addedImages} image(s)` : '';
            const separator = (addedFiles > 0 && addedImages > 0) ? ' and ' : '';
            console.log(chalk.gray(`(Attached ${fileMsg}${separator}${imgMsg} to context)`));
        }
    }

    return { finalInput, attachedImages, ultrathinkEnabled };
}

async function processUserTurn({
    text,
    attachedImages = [],
    source = 'cli',
    remoteMessageId = null,
    titleSource = text
} = {}) {
    if (!currentSessionId) currentSessionId = generateSessionId();
    if (!providerInstance) providerInstance = createProvider();

    if (source === 'remote') {
        sendRemoteUserMessageStatus(remoteMessageId, 'running');
        const imageLabel = attachedImages.length > 0
            ? ` (${attachedImages.length} image${attachedImages.length === 1 ? '' : 's'})`
            : '';
        console.log(chalk.blue(`\n[Remote Chat] Phone message${imageLabel}:`));
        if (String(text || '').trim()) {
            console.log(chalk.white(String(text)));
        }
    }

    const prepared = await prepareUserTurnInput(text, attachedImages);
    return await sendPromptToAi(prepared.finalInput, {
        attachedImages: prepared.attachedImages,
        ultrathinkEnabled: prepared.ultrathinkEnabled,
        titleSource
    });
}

function enqueueUserTurn(options) {
    return enqueueCliTask(() => processUserTurn(options));
}

function enqueueRemoteUserTurn(options) {
    return enqueueCliTask(() => {
        const capabilities = getRemoteChatCapabilities();
        if (options.attachedImages?.length > 0 && !capabilities.imageAttachments) {
            throw new Error(`The active provider (${capabilities.provider}) does not support image attachments.`);
        }

        return processUserTurn(options);
    });
}

function handleRemoteUserMessage(data = {}) {
    const id = typeof data.id === 'string' ? data.id : '';
    try {
        if (!id) {
            throw new Error('Remote message id is required.');
        }

        const text = typeof data.text === 'string' ? data.text : '';
        const images = normalizeRemoteImages(data.images || []);
        if (!text.trim() && images.length === 0) {
            throw new Error('Message text or an image attachment is required.');
        }

        interruptPromptForBackgroundTurn();
        sendRemoteUserMessageStatus(id, 'queued');
        enqueueRemoteUserTurn({
            text,
            attachedImages: images,
            source: 'remote',
            remoteMessageId: id,
            titleSource: text.trim() || 'Phone image message'
        })
            .then(() => sendRemoteUserMessageStatus(id, 'done'))
            .catch((err) => {
                const message = err?.message || 'Phone message failed.';
                sendRemoteUserMessageError(id, message);
                sendRemoteUserMessageStatus(id, 'failed', message);
                console.log(chalk.red(`[Remote Chat] Message failed: ${message}`));
            });
    } catch (err) {
        const message = err?.message || 'Invalid phone message.';
        if (id) {
            sendRemoteUserMessageError(id, message);
            sendRemoteUserMessageStatus(id, 'failed', message);
        }
        console.log(chalk.red(`[Remote Chat] Rejected message: ${message}`));
    }
}

async function sendPromptToAi(finalInput, { attachedImages = [], ultrathinkEnabled = false, titleSource = finalInput } = {}) {
    if (config.autoFeedWorkspace) {
        const { getWorkspaceTree } = await import('./utils/workspace.js');
        const tree = await getWorkspaceTree();
        const { getSystemPrompt } = await import('./prompt.js');
        let newSysPrompt = getSystemPrompt(config);
        newSysPrompt += `\n\n--- Workspace File Tree ---\n${tree}\n--- End of Tree ---`;
        if (typeof providerInstance.updateSystemPrompt === 'function') {
            providerInstance.updateSystemPrompt(newSysPrompt);
        }
    }

    attachRuntimeModelSwitchHandler();

    let modifiedInput = finalInput;
    for (const hook of pluginRegistry.lifecycleHooks.onBeforeMessage) {
        try {
            const res = await hook({ text: modifiedInput, images: attachedImages }, config);
            if (res !== undefined) {
                if (typeof res === 'object' && res !== null) {
                    if (res.text !== undefined) modifiedInput = res.text;
                    if (res.images !== undefined) attachedImages = res.images;
                } else {
                    modifiedInput = String(res);
                }
            }
        } catch (e) {
            console.log(chalk.yellow(`Warning: Plugin onBeforeMessage hook failed: ${e.message}`));
        }
    }

    if (isNewUiEnabled()) {
        queueNewUiAssistantMarker(config);
    } else {
        process.stdout.write(chalk.cyan('✦ '));
    }
    global.isAiSpeaking = true;
    let responseText;
    const messageCountBeforeResponse = Array.isArray(providerInstance.messages) ? providerInstance.messages.length : 0;
    resetRemoteAiResponseTracking();
    try {
        responseText = await providerInstance.sendMessage({ text: modifiedInput, images: attachedImages, ultrathink: ultrathinkEnabled });
    } finally {
        global.isAiSpeaking = false;
    }

    if (
        isEmptyAssistantResponse(responseText) &&
        hasToolActivitySince(providerInstance, messageCountBeforeResponse)
    ) {
        console.log(chalk.gray('\n(Model returned no final message after tool use; asking it to continue...)'));
        global.isAiSpeaking = true;
        try {
            responseText = await providerInstance.sendMessage(EMPTY_TOOL_RESPONSE_CONTINUATION);
        } finally {
            global.isAiSpeaking = false;
        }
    }

    for (const hook of pluginRegistry.lifecycleHooks.onAfterMessage) {
        try {
            const res = await hook(responseText, config);
            if (res !== undefined) responseText = res;
        } catch (e) {
            console.log(chalk.yellow(`Warning: Plugin onAfterMessage hook failed: ${e.message}`));
        }
    }

    if (typeof responseText === 'string' && responseText.trim()) {
        lastAssistantMessageText = responseText;
    } else {
        lastAssistantMessageText = getLastAssistantMessageText();
    }

    sendRemoteAiMessage(responseText);
    finalizeTurn();
    resetRemoteAiResponseTracking();

    console.log();

    const msgLen = providerInstance.messages ? providerInstance.messages.length : 0;
    if (!currentSessionTitle && msgLen >= 3 || msgLen > 0 && msgLen % 10 === 0) {
        const titleSpinner = ora({ text: 'Generating chat title...', color: 'gray', stream: process.stdout }).start();
        try {
            const originalUseMarked = config.useMarkedTerminal;
            const originalDebug = config.debug;
            config.useMarkedTerminal = false;
            config.debug = false;

            const titlePrompt = "SYSTEM: You are a title generator. Based on this conversation, provide a VERY SHORT (2-5 words) title. Reply ONLY with the title string, no quotes or formatting.";

            const { AUTO_ROUTER_MODELS } = await import('./utils/autoModel.js');
            const titleBaseConfig = getBananaSplitLocalConfig(config);
            let titleModel = titleBaseConfig.model;

            let providerKey = titleBaseConfig.provider;
            if (providerKey === 'openai' && titleBaseConfig.authType === 'oauth') {
                providerKey = 'openai_oauth';
            }

            if (AUTO_ROUTER_MODELS[providerKey]) {
                titleModel = AUTO_ROUTER_MODELS[providerKey];
            }

            const titleConfig = {
                ...titleBaseConfig,
                bananaSplit: {
                    ...titleBaseConfig.bananaSplit,
                    enabled: false
                },
                isApiMode: true,
                model: titleModel
            };
            const titleProvider = createProvider(titleConfig);

            if (providerInstance.messages) {
                titleProvider.messages = JSON.parse(JSON.stringify(providerInstance.messages));
            }

            const title = await titleProvider.sendMessage(titlePrompt);
            currentSessionTitle = title.replace(/['"]/g, '').trim();

            config.useMarkedTerminal = originalUseMarked;
            config.debug = originalDebug;
        } catch (e) {
            // ignore title gen errors
        }
        titleSpinner.stop();
    }

    await saveSession(currentSessionId, {
        provider: getActiveProviderId(),
        model: providerInstance.modelName || config.model,
        messages: providerInstance.messages,
        title: currentSessionTitle || String(titleSource || '').trim().substring(0, 50)
    });

    if (config.useUltraMemory) {
        const { runUltraMemoryBackground } = await import('./utils/ultraMemory.js');
        runUltraMemoryBackground(config, createProvider);
    }

    return responseText;
}

function enqueueSlashCommand(command) {
    return enqueueCliTask(async () => {
        try {
            await handleSlashCommand(command, { runUserTurn: processUserTurn });
        } finally {
            publishCurrentRemoteCapabilities();
        }
    });
}

function snapshotBehaviorModes() {
    return {
        planMode: config.planMode,
        askMode: config.askMode,
        securityMode: config.securityMode,
        skillCreatorMode: config.skillCreatorMode,
        deepReviewMode: config.deepReviewMode,
        goalsPlanningMode: config.goalsPlanningMode,
        autoAcceptEditsMode: config.autoAcceptEditsMode
    };
}

function restoreBehaviorModes(snapshot) {
    config.planMode = snapshot.planMode;
    config.askMode = snapshot.askMode;
    config.securityMode = snapshot.securityMode;
    config.skillCreatorMode = snapshot.skillCreatorMode;
    config.deepReviewMode = snapshot.deepReviewMode;
    config.goalsPlanningMode = snapshot.goalsPlanningMode;
    config.autoAcceptEditsMode = snapshot.autoAcceptEditsMode;
    setAutoAcceptEditsMode(config.autoAcceptEditsMode === true);
}

function refreshProviderRuntime() {
    const savedMessages = providerInstance?.messages;
    providerInstance = createProvider();
    if (savedMessages && providerInstance?.messages !== undefined) {
        providerInstance.messages = savedMessages;
    }
    if (typeof providerInstance?.updateSystemPrompt === 'function') {
        providerInstance.updateSystemPrompt(getSystemPrompt(config));
    }
    attachRuntimeModelSwitchHandler();
    global.bananaConfig = config;
}

function applyGoalsPlanningRuntime() {
    config.goalsPlanningMode = true;
    config.askMode = false;
    config.securityMode = false;
    config.skillCreatorMode = false;
    config.deepReviewMode = false;
    refreshProviderRuntime();
}

function applyGoalsImplementationRuntime() {
    config.goalsPlanningMode = false;
    config.askMode = false;
    config.planMode = false;
    config.securityMode = false;
    config.skillCreatorMode = false;
    config.deepReviewMode = false;
    refreshProviderRuntime();
}

function printGoalsPlan(planText) {
    const width = getTermWidth();
    const separator = chalk.gray('─'.repeat(width));
    console.log(chalk.cyan.bold('\nReady to code?\n'));
    console.log(chalk.cyan(`Here is Banana Code's plan:`));
    console.log(separator);
    if (config.useMarkedTerminal) {
        printMarkdown(planText || '(No plan text was returned.)');
    } else {
        console.log(planText || '(No plan text was returned.)');
    }
    console.log(separator);
}

async function promptGoalsApproval(planText) {
    const { select } = await import('@inquirer/prompts');
    printGoalsPlan(planText);
    return await select({
        message: 'Banana Code has made a plan and is ready to execute. Would you like to proceed?',
        choices: [
            {
                name: 'Implement Plan (auto-accept edits, file reads, web fetches, and searches)',
                value: 'edits'
            },
            {
                name: 'Implement Plan (also auto-accept commands)',
                value: 'all'
            },
            {
                name: 'Tell Banana Code what to change',
                value: 'revise'
            }
        ],
        loop: false
    });
}

function normalizePromptInputText(text) {
    return String(text || '')
        .replace(/\r\n/g, ' ')
        .replace(/[\r\n]/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

async function promptGoalsText(message) {
    while (true) {
        console.log(chalk.cyan(message));
        const value = await promptUser();
        if (value === REPROMPT_SIGNAL) {
            continue;
        }

        const normalized = normalizePromptInputText(value).trim();
        if (normalized) return normalized;
        console.log(chalk.yellow('Input cannot be empty.'));
    }
}

async function runGoals(initialGoal, { runUserTurn }) {
    let goal = normalizePromptInputText(initialGoal).trim();
    if (!goal) {
        goal = await promptGoalsText('What goal should Banana Code plan?');
    }

    const originalModes = snapshotBehaviorModes();
    let latestPlan = '';

    try {
        while (true) {
            applyGoalsPlanningRuntime();
            resetCreatedPlan();
            const planningPrompt = `GOALS MODE: Analyze the user's goal like a normal Banana Code request, but do not implement it yet.

Your job in this phase:
1. Inspect the codebase or documentation if needed using read/search/fetch tools. Do not narrate this inspection to the user.
2. If any decision would materially affect implementation, call ask_user_questions and ask all foreseeable blocking questions in one batch. Do not ask questions whose answers can be inferred from the codebase or a safe default.
3. After the user answers, call create_plan with the final plan text. The plan argument must contain only the implementation plan: scope, files/areas to change, ordered steps, validation commands, and assumptions.
4. Do not print the implementation plan as normal chat text. Do not ask "Shall I implement this plan?" or any equivalent approval question. Banana Code will show its own approval menu after create_plan.
5. Do not write files, patch files, rename files, create files, or run shell commands in this phase.

User goal:
${goal}`;

            const planningResponse = await runUserTurn({
                text: planningPrompt,
                source: 'goals',
                titleSource: `/goals ${goal}`
            });
            let createdPlan = getCreatedPlan();
            if (!createdPlan?.plan) {
                console.log(chalk.yellow('Goals planning did not receive a create_plan call. Asking the model to submit the plan through the tool...'));
                const retryResponse = await runUserTurn({
                    text: `GOALS MODE SYSTEM CORRECTION: You must call create_plan now with the implementation plan only. Do not include conversational preamble, prior analysis, or "Shall I implement this plan?" in the plan text.`,
                    source: 'goals',
                    titleSource: `/goals ${goal}`
                });
                createdPlan = getCreatedPlan();
                latestPlan = createdPlan?.plan || retryResponse || planningResponse;
            } else {
                latestPlan = createdPlan.plan;
            }

            const decision = await promptGoalsApproval(latestPlan);
            if (decision === 'revise') {
                const revision = await promptGoalsText('What should change in the plan?');
                goal = `${goal}\n\nThe user reviewed the previous plan and requested this change:\n${revision}\n\nRevise the plan accordingly.`;
                continue;
            }

            applyGoalsImplementationRuntime();
            setGoalsPermissionMode(decision);
            const permissionSummary = decision === 'all'
                ? 'Goals permission profile: auto-accept file/web/search actions and shell commands for this approved implementation run.'
                : 'Goals permission profile: auto-accept file reads, file edits, web fetches, and searches. Shell commands still require explicit user approval.';
            const implementationPrompt = `GOALS IMPLEMENTATION: The user approved the plan below. Implement it now from start to finish.

${permissionSummary}

Work autonomously: continue through implementation, validation, and reasonable fixes without asking follow-up questions unless a new blocker appears that could not have been asked during planning. Use the approved plan as the source of truth, but adapt if codebase facts require it. Give a concise final summary when done.

Approved plan:
${latestPlan}

Original goal:
${initialGoal || goal}`;

            await runUserTurn({
                text: implementationPrompt,
                source: 'goals',
                titleSource: `/goals ${initialGoal || goal}`
            });
            break;
        }
    } finally {
        setGoalsPermissionMode(null);
        restoreBehaviorModes(originalModes);
        refreshProviderRuntime();
    }
}

async function handleSlashCommand(command, { runUserTurn = enqueueUserTurn } = {}) {
    const [cmd, ...args] = command.split(' ');

    if (pluginRegistry.commands[cmd]) {
        try {
            await pluginRegistry.commands[cmd].handler(args, config, providerInstance);
        } catch (e) {
            console.log(chalk.red(`Plugin command ${cmd} failed: ${e.message}`));
        }
        return;
    }

    switch (cmd) {
        case '/provider':
            let newProv = args[0];
            if (!newProv) {
                const { select } = await import('@inquirer/prompts');
                const defaultChoices = [
                    { name: 'Google Gemini', value: 'gemini' },
                    { name: 'Anthropic Claude', value: 'claude' },
                    { name: 'OpenAI', value: 'openai' },
                    { name: 'Mistral AI', value: 'mistral' },
                    { name: 'DeepSeek', value: 'deepseek' },
                    { name: 'Kimi AI (Moonshot)', value: 'kimi' },
                    { name: 'Qwen (Alibaba Cloud)', value: 'qwen' },
                    { name: 'OpenRouter (Any Model)', value: 'openrouter' },
                    { name: 'Ollama Cloud', value: 'ollama_cloud' },
                    { name: 'Ollama (Local)', value: 'ollama' },
                    { name: 'LM Studio (Local)', value: 'lmstudio' },
                    { name: 'llama.cpp Server (Local)', value: 'llamacpp' }
                ];
                
                // Add dynamic plugin providers
                for (const [id, prov] of Object.entries(pluginRegistry.providers)) {
                    defaultChoices.push({ name: `${prov.name} (Plugin)`, value: id });
                }

                newProv = await select({
                    message: 'Select an AI provider:',
                    choices: defaultChoices,
                    loop: false,
                    pageSize: 15
                });
            }

            const isDefaultProv = ['gemini', 'claude', 'openai', 'mistral', 'deepseek', 'kimi', 'qwen', 'openrouter', 'ollama_cloud', 'ollama', 'lmstudio', 'llamacpp'].includes(newProv);
            const isPluginProv = pluginRegistry.providers[newProv] !== undefined;

            if (isDefaultProv || isPluginProv) {
                // Use the shared setup logic to get keys/models
                config = await setupProvider(newProv, config);
                await saveConfig(config);
                providerInstance = createProvider();
                lastAssistantMessageText = '';
                console.log(chalk.green(`Switched provider to ${newProv} (${config.model}).`));
            } else {
                console.log(chalk.yellow(`Usage: /provider <gemini|claude|openai|mistral|deepseek|kimi|qwen|openrouter|ollama_cloud|ollama|lmstudio|llamacpp>`));
            }
            break;
        case '/copy': {
            const text = getLastAssistantMessageText();
            if (!text.trim()) {
                console.log(chalk.yellow('No Banana Code message found to copy yet.'));
                break;
            }

            try {
                const commandUsed = await copyTextToClipboard(text);
                console.log(chalk.green(`Copied Banana Code's last message to the clipboard.`) + chalk.gray(` (${commandUsed})`));
            } catch (err) {
                console.log(chalk.red(`Failed to copy to clipboard: ${err.message}`));
                console.log(chalk.gray('Install a clipboard tool such as wl-copy, xclip, or xsel, then try /copy again.'));
            }
            break;
        }
        case '/feedback': {
            let feedbackText = args.join(' ').trim();

            if (!feedbackText) {
                const { input } = await import('@inquirer/prompts');
                feedbackText = await input({
                    message: 'What feedback should Banana Code send?',
                    validate: (value) => String(value || '').trim().length > 0 || 'Feedback cannot be empty'
                });
            }

            const spinner = ora({ text: 'Sending feedback...', color: 'yellow', stream: process.stdout }).start();
            try {
                const result = await submitFeedback(feedbackText, config);
                spinner.stop();
                console.log(chalk.green(`Feedback sent. Thank you.`) + chalk.gray(result.id ? ` (${result.id})` : ''));
            } catch (err) {
                spinner.stop();
                console.log(chalk.red(`Feedback failed: ${err.message}`));
                console.log(chalk.gray('You can set FEEDBACK_API_URL to test against another backend.'));
            }
            break;
        }
        case '/model':
            let newModel = args[0];
            const isBananaSplitModelChange = config.bananaSplit?.enabled && config.bananaSplit.local?.provider;
            const modelConfig = isBananaSplitModelChange ? getBananaSplitLocalConfig(config) : config;
            const activeModelProvider = modelConfig.provider;
            if (!newModel) {
                // Interactive selection
                const { select } = await import('@inquirer/prompts');
                const { GEMINI_MODELS, CLAUDE_MODELS, OPENAI_MODELS, CODEX_MODELS, OLLAMA_CLOUD_MODELS, MISTRAL_MODELS, DEEPSEEK_MODELS, KIMI_MODELS, QWEN_MODELS } = await import('./constants.js');

                const AUTO_CHOICE = { name: chalk.cyan('⚡ Auto Mode') + chalk.gray(' (AI picks the best model per prompt)'), value: 'auto' };
                let choices = [];
                if (activeModelProvider === 'gemini') choices = [AUTO_CHOICE, ...GEMINI_MODELS];
                else if (activeModelProvider === 'claude') choices = [AUTO_CHOICE, ...CLAUDE_MODELS];
                else if (activeModelProvider === 'openai') {
                    const base = modelConfig.authType === 'oauth' ? CODEX_MODELS : OPENAI_MODELS;
                    choices = [AUTO_CHOICE, ...base];
                } else if (activeModelProvider === 'mistral') {
                    choices = [AUTO_CHOICE, ...MISTRAL_MODELS];
                } else if (activeModelProvider === 'deepseek') {
                    choices = [AUTO_CHOICE, ...DEEPSEEK_MODELS];
                } else if (activeModelProvider === 'kimi') {
                    choices = [AUTO_CHOICE, ...KIMI_MODELS];
                } else if (activeModelProvider === 'qwen') {
                    choices = [AUTO_CHOICE, ...QWEN_MODELS];
                } else if (activeModelProvider === 'openrouter') {
                    // Re-run setup flow so the user gets full validation
                    config = await setupProvider('openrouter', config);
                    await saveConfig(config);
                    providerInstance = createProvider();
                    console.log(chalk.green(`Switched OpenRouter model to ${config.model}.`));
                    break;
                } else if (activeModelProvider === 'ollama_cloud') {
                    choices = [AUTO_CHOICE, ...OLLAMA_CLOUD_MODELS];
                } else if (activeModelProvider === 'ollama') {
                    try {
                        const response = await fetch('http://localhost:11434/api/tags');
                        const data = await response.json();
                        choices = data.models.map(m => ({ name: m.name, value: m.name }));
                    } catch (e) {
                        console.log(chalk.red("Could not connect to Ollama."));
                        return;
                    }
                } else if (activeModelProvider === 'lmstudio') {
                    try {
                        const baseUrl = modelConfig.lmStudioBaseUrl || 'http://localhost:1234/v1';
                        const response = await fetch(`${baseUrl}/models`);
                        const data = await response.json();
                        choices = data.data.map(m => ({ name: m.id, value: m.id }));
                    } catch (e) {
                        console.log(chalk.red("Could not connect to LM Studio."));
                        return;
                    }
                } else if (activeModelProvider === 'llamacpp') {
                    try {
                        const discovery = await listLlamaCppModels(modelConfig.llamaCppBaseUrl);
                        choices = discovery.models.length > 0
                            ? discovery.models.map(m => ({ name: m, value: m }))
                            : [{ name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' }];
                    } catch (e) {
                        console.log(chalk.red(`Could not connect to llama.cpp: ${e.message}`));
                        choices = [{ name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' }];
                    }
                } else if (pluginRegistry.providers[activeModelProvider] && pluginRegistry.providers[activeModelProvider].ProviderClass) {
                    // Check if provider class has a static getModels method
                    const ProvClass = pluginRegistry.providers[activeModelProvider].ProviderClass;
                    if (typeof ProvClass.getModels === 'function') {
                        try {
                            choices = await ProvClass.getModels(modelConfig);
                        } catch (e) {
                            console.log(chalk.red(`Could not fetch models for plugin provider ${activeModelProvider}: ${e.message}`));
                        }
                    } else {
                        choices = [{ name: 'Default Model', value: 'default' }];
                    }
                }

                if (choices.length > 0) {
                    const finalChoices = [...choices];
                    if (
                        (activeModelProvider === 'ollama_cloud' || activeModelProvider === 'mistral' || activeModelProvider === 'deepseek' || activeModelProvider === 'kimi' || activeModelProvider === 'qwen' || activeModelProvider === 'llamacpp') &&
                        !finalChoices.some(choice => choice.value === 'CUSTOM_ID')
                    ) {
                        finalChoices.push({ name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' });
                    }

                    newModel = await select({
                        message: 'Select a model:',
                        choices: finalChoices,
                        loop: false,
                        pageSize: activeModelProvider === 'qwen' ? 15 : 10
                    });

                    if (newModel === 'CUSTOM_ID') {
                        const { input } = await import('@inquirer/prompts');
                        const exampleModel = activeModelProvider === 'deepseek'
                            ? 'deepseek-v4-flash'
                            : activeModelProvider === 'llamacpp'
                                ? 'default'
                                : activeModelProvider === 'mistral'
                                ? 'mistral-large-latest'
                                : activeModelProvider === 'kimi'
                                    ? 'kimi-k2.6'
                                    : activeModelProvider === 'qwen'
                                        ? 'qwen3.6-plus'
                                        : 'gemma3:27b-cloud';
                        newModel = await input({
                            message: `Enter the exact model ID (e.g., ${exampleModel}):`,
                            validate: (v) => v.trim().length > 0 || 'Model ID cannot be empty'
                        });
                    }
                }
            }

            if (newModel) {
                if (activeModelProvider === 'openrouter') {
                    // Validate tool calling support before switching
                    console.log(chalk.cyan(`Validating "${newModel}" on OpenRouter...`));
                    try {
                        const res = await fetch('https://openrouter.ai/api/v1/models');
                        const data = await res.json();
                        const found = data.data?.find(m => m.id === newModel);
                        if (!found) {
                            console.log(chalk.yellow(`Model "${newModel}" not found on OpenRouter — proceeding anyway.`));
                        } else {
                            const supported = found.supported_parameters || [];
                            const hasToolCalling = supported.includes('tools') || supported.includes('tool_choice');
                            const inputModalities = found.architecture?.input_modalities || [];
                            const hasImageInput = inputModalities.includes('image');
                            if (hasToolCalling) {
                                const imageStatus = hasImageInput ? ' and image input' : '';
                                console.log(chalk.green(`✔ "${newModel}" supports tool calling${imageStatus}.`));
                                if (!hasImageInput) {
                                    console.log(chalk.yellow(`   Note: OpenRouter does not list image input for this model.`));
                                }
                            } else {
                                console.log(chalk.red(`✘ "${newModel}" does NOT support tool calling. Banana Code may not work correctly.`));
                                console.log(chalk.gray(`   Supported parameters: ${supported.join(', ') || 'none listed'}`));
                            }
                        }
                    } catch (err) {
                        console.log(chalk.yellow(`Could not validate on OpenRouter: ${err.message}`));
                    }
                }
                if (newModel.endsWith('-fast')) {
                    console.log(chalk.red.bold('\n⚠️  FAST MODE WARNING:'));
                    console.log(chalk.yellow('This model uses significantly more compute power and costs 6x more than standard Opus.'));
                    console.log(chalk.yellow('It provides 2.5x faster output speeds but will consume your API credits much faster.\n'));
                }

                if (isBananaSplitModelChange) {
                    config.bananaSplit.local.model = newModel;
                } else {
                    config.model = newModel;
                }
                await saveConfig(config);
                if (providerInstance) {
                    providerInstance.modelName = newModel;
                    providerInstance.config.model = newModel;
                } else {
                    providerInstance = createProvider();
                }
                const scope = isBananaSplitModelChange ? 'BananaSplit local model' : 'model';
                console.log(chalk.green(`Switched ${scope} to ${newModel}.`));
            } else {
                console.log(chalk.yellow(`Usage: /model <model_name> (or just /model for selection)`));
            }
            break;
        case '/remotetooling':
            if (args[0] === 'disconnect') {
                disconnectRemoteTooling();
                delete config.remoteUuid;
                delete config.remoteDeviceToken;
                delete config.remoteDeviceType;
                await saveConfig(config);
                console.log(chalk.green('Remote tooling disconnected. Using normal CLI permissions.'));
                break;
            }

            const { input: promptInput } = await import('@inquirer/prompts');
            const isMigration = args[0] === 'migrate';
            const pairingCode = await promptInput({
                message: isMigration
                    ? 'Enter the new secure pairing code from your Mobile App:'
                    : 'Enter the pairing code from your Mobile App:',
                validate: (v) => v.trim().length > 0 || 'Input cannot be empty'
            });
            const redeemed = await redeemRemotePairingCode(pairingCode);
            if (!redeemed) break;

            const result = await connectCurrentRemoteTooling(redeemed);
            if (result && result.uuid) {
                config.remoteUuid = result.uuid;
                config.remoteDeviceToken = result.token;
                config.remoteDeviceType = result.deviceType;
                await saveConfig(config);
                console.log(chalk.cyan(`Remote tooling securely paired with account: ${result.uuid}`));
            }
            break;
        case '/github': {
            const action = String(args[0] || '').toLowerCase();
            try {
                if (action === 'disconnect' || action === 'logout') {
                    config = await disconnectGitHubIntegration(config);
                    await saveConfig(config);
                    refreshProviderRuntime();
                    break;
                }

                if (action === 'status') {
                    await showGitHubStatus(config);
                    break;
                }

                if (action && !['setup', 'connect', 'reconnect'].includes(action)) {
                    console.log(chalk.yellow('Usage: /github [connect|reconnect|status|disconnect]'));
                    break;
                }

                config = await setupGitHubIntegration(config);
                await saveConfig(config);
                refreshProviderRuntime();
                console.log(chalk.cyan('GitHub tools are now available to the AI in this session.'));
            } catch (err) {
                console.log(chalk.red(`GitHub setup failed: ${err.message}`));
            }
            break;
        }
        case '/voice': {
            if (args[0] === 'setup' || !hasUsableVoiceConfig(config)) {
                config = await setupVoiceConfig(config);
                await saveConfig(config);
                if (args[0] === 'setup') {
                    console.log(chalk.green(`Voice input configured for ${getVoiceProviderLabel(getVoiceProvider(config.voice))} ${config.voice.model}.`));
                    break;
                }
            }

            let audioPath = null;
            let shouldCleanupAudio = false;
            const requestedAudioPath = args.join(' ').trim();

            try {
                if (requestedAudioPath) {
                    const path = await import('path');
                    const os = await import('os');
                    let cleanedPath = requestedAudioPath;
                    if ((cleanedPath.startsWith('"') && cleanedPath.endsWith('"')) || (cleanedPath.startsWith("'") && cleanedPath.endsWith("'"))) {
                        cleanedPath = cleanedPath.slice(1, -1);
                    }
                    if (cleanedPath.startsWith('~')) {
                        cleanedPath = path.join(os.homedir(), cleanedPath.slice(1));
                    }
                    audioPath = path.resolve(path.isAbsolute(cleanedPath) ? cleanedPath : path.join(process.cwd(), cleanedPath));
                    if (!isSupportedVoiceFile(audioPath)) {
                        console.log(chalk.yellow('Voice input accepts .mp3, .wav, .m4a, .flac, .ogg, .webm, or .aac files.'));
                        break;
                    }
                } else {
                    console.log(chalk.cyan('Starting voice recording...'));
                    audioPath = await recordVoiceClip();
                    shouldCleanupAudio = true;
                }

                const voice = getVoiceConfig(config);
                const provider = getVoiceProvider(voice);
                const providerLabel = getVoiceProviderLabel(provider);
                const spinner = ora({ text: `Transcribing with ${providerLabel} ${voice.model}...`, color: 'yellow', stream: process.stdout }).start();
                let transcript;
                try {
                    transcript = await transcribeVoice({
                        provider,
                        apiKey: getVoiceApiKey(voice),
                        model: voice.model,
                        filePath: audioPath
                    });
                    spinner.stop();
                } catch (err) {
                    spinner.stop();
                    throw err;
                }

                console.log(chalk.gray(`Transcribed: ${transcript}`));
                await runUserTurn({ text: transcript, source: 'voice', titleSource: transcript });
            } catch (err) {
                console.log(chalk.red(`Voice input failed: ${err.message}`));
            } finally {
                if (shouldCleanupAudio) await cleanupVoiceClip(audioPath);
            }
            break;
        }
        case '/clear':
            providerInstance = createProvider(); // fresh instance = clear history
            lastAssistantMessageText = '';
            console.log(chalk.green('Chat history cleared.'));
            break;
        case '/clean':
            if (!config.betaTools || !config.betaTools.includes('clean_command')) {
                console.log(chalk.yellow("The /clean command is a beta feature. You need to enable it in the /beta menu first."));
                break;
            }
            const msgCount = providerInstance.messages ? providerInstance.messages.length : 0;
            if (msgCount <= 2) {
                console.log(chalk.yellow("Not enough history to summarize."));
                break;
            }

            console.log(chalk.cyan("Summarizing context to save tokens..."));
            const summarySpinner = ora({ text: 'Compressing history...', color: 'yellow', stream: process.stdout }).start();

            try {
                // Temporarily disable terminal formatting for the summary request
                const originalUseMarked = config.useMarkedTerminal;
                config.useMarkedTerminal = false;

                // Create a temporary prompt asking for a summary
                const summaryPrompt = "SYSTEM INSTRUCTION: Please provide a highly concise summary of our entire conversation so far. Focus ONLY on the overall goal, the current state of the project, any important decisions made, and what we were about to do next. Do not include pleasantries. This summary will be used as your memory going forward.";

                // Ask the AI to summarize
                const summary = await providerInstance.sendMessage(summaryPrompt);

                // Restore settings
                config.useMarkedTerminal = originalUseMarked;
                summarySpinner.stop();

                // Re-initialize the provider to wipe old history
                providerInstance = createProvider();

                // Inject the summary as the first message after the system prompt
                const summaryMemory = `[PREVIOUS CONVERSATION SUMMARY]\n${summary}`;

                if (config.provider === 'gemini') {
                    providerInstance.messages.push({ role: 'user', parts: [{ text: summaryMemory }] });
                    providerInstance.messages.push({ role: 'model', parts: [{ text: "I have stored the summary of our previous conversation in my memory." }] });
                } else if (config.provider === 'claude') {
                    providerInstance.messages.push({ role: 'user', content: summaryMemory });
                    providerInstance.messages.push({ role: 'assistant', content: "I have stored the summary of our previous conversation in my memory." });
                } else {
                    providerInstance.messages.push({ role: 'user', content: summaryMemory });
                    providerInstance.messages.push({ role: 'assistant', content: "I have stored the summary of our previous conversation in my memory." });
                }

                console.log(chalk.green(`\nContext successfully compressed!`));
                if (config.debug) {
                    console.log(chalk.gray(`\n[Saved Summary]:\n${summary}\n`));
                }

                await saveSession(currentSessionId, {
                    provider: config.provider,
                    model: config.model || providerInstance.modelName,
                    messages: providerInstance.messages
                });

            } catch (err) {
                summarySpinner.stop();
                console.log(chalk.red(`Failed to compress context: ${err.message}`));
            }
            break;
        case '/context':
            let messagesForEstimation = [];

            if (providerInstance.messages) {
                messagesForEstimation = providerInstance.messages;
            } else if (providerInstance.chat) {
                messagesForEstimation = await providerInstance.chat.getHistory();
            }

            const { getContextBreakdown } = await import('./utils/tokens.js');
            const breakdown = getContextBreakdown(messagesForEstimation);

            console.log(chalk.cyan.bold(`\nContext Breakdown:`));
            console.log(chalk.cyan(`- Total Messages:   ${messagesForEstimation.length}`));
            console.log(chalk.cyan(`- Estimated Tokens: ~${breakdown.total.toLocaleString()}\n`));

            console.log(chalk.yellow.bold(`Usage by Category:`));
            console.log(chalk.gray(`  System Prompt: `) + chalk.green(`${breakdown.system.toLocaleString()} tokens `) + chalk.blue(`(${breakdown.percentages.system}%)`));
            console.log(chalk.gray(`  Chat History:  `) + chalk.green(`${breakdown.chat.toLocaleString()} tokens `) + chalk.blue(`(${breakdown.percentages.chat}%)`));
            console.log(chalk.gray(`  Tool Usage:    `) + chalk.green(`${breakdown.tools.toLocaleString()} tokens `) + chalk.blue(`(${breakdown.percentages.tools}%)`));
            if (breakdown.other > 0) {
                console.log(chalk.gray(`  Other Data:    `) + chalk.green(`${breakdown.other.toLocaleString()} tokens `) + chalk.blue(`(${breakdown.percentages.other}%)`));
            }

            // Real cost calculation from provider (if supported)
            if (providerInstance && typeof providerInstance.calculateSessionCost === 'function') {
                const { cost, savings } = providerInstance.calculateSessionCost();
                console.log(chalk.yellow.bold(`\nFinancial Summary:`));
                console.log(chalk.green(`  Session Cost:   $${cost}`));
                if (parseFloat(savings) > 0) {
                    console.log(chalk.cyan(`  Total Savings:  $${savings} (via Prompt Caching) 🍌`));
                }
            }
            console.log();
            break;
        case '/permissions':
            const perms = getSessionPermissions();
            if (perms.length === 0) {
                console.log(chalk.magenta('No session permissions granted.'));
            } else {
                console.log(chalk.magenta('Active session permissions:\n- ' + perms.join('\n- ')));
            }
            break;
        case '/beta':
            const { checkbox } = await import('@inquirer/prompts');
            const { TOOLS } = await import('./tools/registry.js');
            const betaTools = TOOLS.filter(t => t.beta);

            let choices = betaTools.map(t => ({
                name: t.label || t.name,
                value: t.name,
                checked: (config.betaTools || []).includes(t.name)
            }));

            // Add beta commands that aren't tools
            choices.push({
                name: '/clean command (Context Compression)',
                value: 'clean_command',
                checked: (config.betaTools || []).includes('clean_command')
            });

            choices.push({
                name: 'MCP Support (Model Context Protocol)',
                value: 'mcp_support',
                checked: (config.betaTools || []).includes('mcp_support')
            });

            if (choices.length === 0) {
                console.log(chalk.yellow("No beta features available."));
                break;
            }

            const enabledBetaTools = await checkbox({
                message: 'Select beta features to activate (Space to toggle, Enter to confirm):',
                choices: choices
            });

            if (enabledBetaTools.includes('duck_duck_go_scrape') && !(config.betaTools || []).includes('duck_duck_go_scrape')) {
                console.log(chalk.red.bold('\nNotice: This feature retrieves search results by scraping the DuckDuckGo HTML site.'));
                console.log(chalk.yellow('This tool is not an official API.'));
                console.log(chalk.yellow("Usage may violate DuckDuckGo's Terms of Service."));
                console.log(chalk.yellow('Your IP address may be blocked if you use this too frequently.'));
                console.log(chalk.yellow('You agree to use this only for personal, non-commercial research.\n'));

                const { confirm } = await import('@inquirer/prompts');
                const agreed = await confirm({ message: 'Do you agree to these terms?' });
                if (!agreed) {
                    // Remove it from the list if they don't agree
                    const idx = enabledBetaTools.indexOf('duck_duck_go_scrape');
                    if (idx > -1) enabledBetaTools.splice(idx, 1);
                    console.log(chalk.yellow('DuckDuckGo Scrape was not enabled.'));
                }
            }

            if (enabledBetaTools.includes('mcp_support') && !(config.betaTools || []).includes('mcp_support')) {
                await mcpManager.init();
            } else if (!enabledBetaTools.includes('mcp_support') && (config.betaTools || []).includes('mcp_support')) {
                await mcpManager.cleanup();
            }

            config.betaTools = enabledBetaTools;
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider(); // Re-init to update tools
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.green(`Beta tools updated: ${enabledBetaTools.join(', ') || 'none'}`));
            break;
        case '/settings':
            const { checkbox: settingsCheckbox, confirm: settingsConfirm } = await import('@inquirer/prompts');
            const enabledSettings = await settingsCheckbox({
                message: 'Select features to enable (Space to toggle, Enter to confirm):',
                choices: [
                    {
                        name: 'Auto-feed workspace files to AI (uses .bananacodeignore / .gitignore)',
                        value: 'autoFeedWorkspace',
                        checked: config.autoFeedWorkspace || false
                    },
                    {
                        name: 'Use syntax highlighting for AI output (requires waiting for full response)',
                        value: 'useMarkedTerminal',
                        checked: config.useMarkedTerminal || false
                    },
                    {
                        name: 'Enable Surgical File Patching (patch_file tool)',
                        value: 'usePatchFile',
                        checked: config.usePatchFile !== false
                    },
                    {
                        name: 'Always show current token count in status bar',
                        value: 'showTokenCount',
                        checked: config.showTokenCount || false
                    },
                    {
                        name: 'Enable Global AI Memory (Allows AI to save facts persistently)',
                        value: 'useMemory',
                        checked: config.useMemory !== false
                    },
                    {
                        name: 'Enable Banana Guard (AI-Powered Auto-Approve for safe commands)',
                        value: 'useBananaGuard',
                        checked: config.useBananaGuard !== false
                    },
                    {
                        name: 'Enable Claude 1-Hour Prompt Cache (2x write cost, longer session life)',
                        value: 'useExtendedCache',
                        checked: config.useExtendedCache || false
                    },
                    {
                        name: 'Enable UltraMemory (Scans chats in background, HIGH API USAGE)',
                        value: 'useUltraMemory',
                        checked: config.useUltraMemory || false
                    },
                    {
                        name: 'Use Puppeteer for fetch_url (renders JavaScript; downloads browser on first use)',
                        value: 'usePuppeteerFetch',
                        checked: config.usePuppeteerFetch || false
                    }
                ],
                loop: false,
                pageSize: 20
            });

            if (enabledSettings.includes('useUltraMemory') && !config.useUltraMemory) {
                console.log(chalk.red.bold('\n⚠️  WARNING: UltraMemory will scan your chats in the background using AI.'));
                console.log(chalk.yellow('This can SIGNIFICANTLY increase your API quota usage and costs.'));
                console.log(chalk.yellow('It will only scan chats created or updated AFTER this feature is enabled.'));

                const agreed = await settingsConfirm({ message: 'Are you sure you want to enable UltraMemory?' });
                if (!agreed) {
                    const idx = enabledSettings.indexOf('useUltraMemory');
                    if (idx > -1) enabledSettings.splice(idx, 1);
                    console.log(chalk.yellow('UltraMemory was not enabled.'));
                } else {
                    config.ultraMemoryEnabledAt = new Date().toISOString();
                }
            }

            if (enabledSettings.includes('usePuppeteerFetch') && !config.usePuppeteerFetch) {
                console.log(chalk.yellow('\nPuppeteer fetch renders JavaScript pages by installing Puppeteer into your Banana Code config directory on first use.'));
                console.log(chalk.yellow('This can download a Chromium browser and use additional disk space and network bandwidth.'));

                const agreed = await settingsConfirm({ message: 'Enable Puppeteer for fetch_url?' });
                if (!agreed) {
                    const idx = enabledSettings.indexOf('usePuppeteerFetch');
                    if (idx > -1) enabledSettings.splice(idx, 1);
                    console.log(chalk.yellow('Puppeteer fetch was not enabled.'));
                }
            }

            config.autoFeedWorkspace = enabledSettings.includes('autoFeedWorkspace');
            config.useMarkedTerminal = enabledSettings.includes('useMarkedTerminal');
            config.usePatchFile = enabledSettings.includes('usePatchFile');
            config.showTokenCount = enabledSettings.includes('showTokenCount');
            config.useMemory = enabledSettings.includes('useMemory');
            config.useBananaGuard = enabledSettings.includes('useBananaGuard');
            config.useExtendedCache = enabledSettings.includes('useExtendedCache');
            config.useUltraMemory = enabledSettings.includes('useUltraMemory');
            config.usePuppeteerFetch = enabledSettings.includes('usePuppeteerFetch');

            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider(); // Re-init to update tools/config
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }

            if (config.useUltraMemory) {
                const { runUltraMemoryBackground } = await import('./utils/ultraMemory.js');
                runUltraMemoryBackground(config, createProvider);
            }

            console.log(chalk.green(`Settings updated.`));
            break;
        case '/debug':
            config.debug = !config.debug;
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider(); // Re-init to pass debug flag
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.magenta(`Debug mode ${config.debug ? 'enabled' : 'disabled'}.`));
            break;
        case '/skills':
            const { getAvailableSkills, getBundledSkills, isBundledSkillEnabled, BUNDLED_SKILLS_DIR, USER_SKILLS_DIR } = await import('./utils/skills.js');

            if ((args[0] || '').toLowerCase() === 'defaults') {
                const bundledSkills = getBundledSkills();

                if (bundledSkills.length === 0) {
                    console.log(chalk.yellow("No bundled default skills found."));
                    console.log(chalk.gray(`Bundled skills can be shipped in ${BUNDLED_SKILLS_DIR}`));
                    break;
                }

                const { checkbox } = await import('@inquirer/prompts');
                const selectedSkillIds = await checkbox({
                    message: 'Select bundled default skills to make available to the AI:',
                    choices: bundledSkills.map(skill => ({
                        name: `${skill.id}${skill.defaultAutoLoad === false ? ' (default off)' : ''} - ${skill.description}`,
                        value: skill.id,
                        checked: isBundledSkillEnabled(skill, config)
                    })),
                    loop: false,
                    pageSize: Math.min(Math.max(bundledSkills.length, 8), 20)
                });

                const selected = new Set(selectedSkillIds);
                const enabled = [];
                const disabled = [];

                for (const skill of bundledSkills) {
                    const isSelected = selected.has(skill.id);
                    if (isSelected && skill.defaultAutoLoad === false) {
                        enabled.push(skill.id);
                    } else if (!isSelected && skill.defaultAutoLoad !== false) {
                        disabled.push(skill.id);
                    }
                }

                config.defaultSkills = { enabled, disabled };
                await saveConfig(config);

                if (providerInstance && typeof providerInstance.updateSystemPrompt === 'function') {
                    providerInstance.updateSystemPrompt(getSystemPrompt(config));
                }

                console.log(chalk.green(`Default skills updated. Enabled: ${selectedSkillIds.join(', ') || 'none'}`));
                break;
            }

            const skills = getAvailableSkills({ config });
            if (skills.length === 0) {
                console.log(chalk.yellow("No skills found."));
                console.log(chalk.gray(`Create skill directories with a SKILL.md file in ${USER_SKILLS_DIR}`));
                console.log(chalk.gray(`Bundled skills can also be shipped in ${BUNDLED_SKILLS_DIR}`));
                console.log(chalk.gray(`Run /skills defaults to enable or disable bundled default skills.`));
            } else {
                console.log(chalk.cyan.bold("\nLoaded Skills:"));
                skills.forEach(skill => {
                    console.log(chalk.green(`- ${skill.id}`) + `: ${skill.description}`);
                });
                console.log(chalk.gray("\nRun /skills defaults to enable or disable bundled default skills."));
            }
            break;
        case '/goals':
            await runGoals(args.join(' '), { runUserTurn });
            break;
        case '/plan':
            config.planMode = true;
            config.askMode = false;
            config.securityMode = false;
            config.skillCreatorMode = false;
            config.autoAcceptEditsMode = false;
            setAutoAcceptEditsMode(false);
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.magenta(`Plan mode enabled. For significant changes, the AI will now propose an implementation plan before writing code.`));
            break;
        case '/ask':
            config.askMode = true;
            config.planMode = false;
            config.securityMode = false;
            config.autoAcceptEditsMode = false;
            setAutoAcceptEditsMode(false);
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.blue(`Ask mode enabled. The AI will only answer questions and cannot edit files.`));
            break;
        case '/security':
            config.securityMode = true;
            config.askMode = false;
            config.planMode = false;
            config.autoAcceptEditsMode = false;
            setAutoAcceptEditsMode(false);
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.red(`Security mode enabled. The AI will look for and help fix vulnerabilities.`));
            console.log(chalk.yellow(`Disclaimer: Please only use this mode for defensive purposes to secure your own code, and do not use the identified vulnerabilities maliciously.`));
            break;
        case '/deepreview': {
            const { select: reviewSelect } = await import('@inquirer/prompts');
            const reviewMode = await reviewSelect({
                message: '🔍 DeepReview — What should I review?',
                choices: [
                    {
                        name: 'Full Review  — Audit the entire current codebase',
                        value: 'full'
                    },
                    {
                        name: 'Diff Review  — Review only staged/unstaged changes (git status + diff)',
                        value: 'diff'
                    }
                ],
                loop: false
            });

            config.deepReviewMode = reviewMode; // 'full' | 'diff'
            config.planMode = false;
            config.askMode = false;
            config.securityMode = false;
            config.skillCreatorMode = false;
            config.autoAcceptEditsMode = false;
            setAutoAcceptEditsMode(false);
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
                const newSysPrompt = getSystemPrompt(config);
                if (typeof providerInstance.updateSystemPrompt === 'function') {
                    providerInstance.updateSystemPrompt(newSysPrompt);
                }
            } else {
                providerInstance = createProvider();
            }

            if (reviewMode === 'diff') {
                console.log(chalk.blueBright(`\n🔍 DeepReview (Diff) enabled.`));
                console.log(chalk.gray(`I will run git status and git diff, then review only what has changed.`));
                console.log(chalk.gray(`No files will be modified. Use /agent to return to normal mode.\n`));
            } else {
                console.log(chalk.blueBright(`\n🔍 DeepReview (Full) enabled.`));
                console.log(chalk.gray(`I will audit the entire codebase for bugs, logic errors, performance issues, and style.`));
                console.log(chalk.gray(`No files will be modified. Use /agent to return to normal mode.\n`));
            }
            break;
        }
        case '/yolo':
            config.yolo = !config.yolo;
            setYoloMode(config.yolo);
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(config.yolo ? chalk.bgRed.white.bold('\n ⚠️ YOLO MODE ENABLED - All permission requests will be auto-accepted! \n') : chalk.green('\nYOLO mode disabled.\n'));
            break;
        case '/guard':
            config.useBananaGuard = !config.useBananaGuard;
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.green(`🛡️  Banana Guard ${config.useBananaGuard ? 'enabled. AI will auto-approve safe commands.' : 'disabled. All commands require manual approval.'}`));
            break;
        case '/bananasplit': {
            const subCmd = (args[0] || '').toLowerCase();

            if (subCmd === 'disable' || subCmd === 'off') {
                if (!config.bananaSplit?.enabled) {
                    console.log(chalk.yellow('BananaSplit is already disabled.'));
                    break;
                }

                config.bananaSplit.enabled = false;
                await saveConfig(config);
                global.bananaConfig = config;
                replaceProviderForCurrentConfig({ preservePortableHistory: true });
                console.log(chalk.green('BananaSplit disabled. Returning to your normal provider.'));
                break;
            }

            if (subCmd && !['setup', 'configure'].includes(subCmd)) {
                console.log(chalk.yellow('Usage: /bananasplit [disable|setup]'));
                break;
            }

            const shouldConfigure = !config.bananaSplit?.local ||
                !config.bananaSplit?.reviewer ||
                ['setup', 'configure'].includes(subCmd) ||
                (config.bananaSplit?.enabled && !subCmd);

            if (shouldConfigure) {
                config = await setupBananaSplit(config);
            } else {
                config.bananaSplit.enabled = true;
            }

            await saveConfig(config);
            global.bananaConfig = config;
            replaceProviderForCurrentConfig({ preservePortableHistory: true });

            const local = config.bananaSplit.local;
            const reviewer = config.bananaSplit.reviewer;
            console.log(chalk.green(`BananaSplit enabled. Local: ${local.provider}/${local.model}. Reviewer: ${reviewer.provider}/${reviewer.model}.`));
            break;
        }
        case '/imagegen': {
            const subCmd = (args[0] || '').toLowerCase();

            if (subCmd === 'disable' || subCmd === 'off') {
                if (!config.imageGen?.enabled) {
                    console.log(chalk.yellow('ImageGen is already disabled.'));
                    break;
                }

                config.imageGen = {
                    ...config.imageGen,
                    enabled: false
                };
                await saveConfig(config);
                global.bananaConfig = config;
                replaceProviderForCurrentConfig({ preservePortableHistory: true });
                console.log(chalk.green('ImageGen disabled. The generate_image tool is no longer available.'));
                break;
            }

            if (subCmd && !['setup', 'configure'].includes(subCmd)) {
                console.log(chalk.yellow('Usage: /imagegen [disable|setup]'));
                break;
            }

            const shouldConfigure = !config.imageGen?.baseUrl ||
                !config.imageGen?.model ||
                ['setup', 'configure'].includes(subCmd) ||
                (config.imageGen?.enabled && !subCmd);

            if (shouldConfigure) {
                config = await setupImageGen(config);
            } else {
                config.imageGen.enabled = true;
            }

            await saveConfig(config);
            global.bananaConfig = config;
            replaceProviderForCurrentConfig({ preservePortableHistory: true });

            console.log(chalk.green(`ImageGen enabled. Model: ${config.imageGen.model}. Base URL: ${config.imageGen.baseUrl}.`));
            break;
        }
        case '/style': {
            const { select: styleSelect } = await import('@inquirer/prompts');
            const selectedStyle = await styleSelect({
                message: 'Select a writing style for the AI:',
                choices: [
                    { name: 'Normal (Default)', value: 'normal' },
                    { name: 'Explanatory (Detailed & Educational)', value: 'explanatory' },
                    { name: 'Formal (Professional & Academic)', value: 'formal' },
                    { name: 'Concise (Terse & Code-First)', value: 'concise' }
                ],
                default: config.style || 'normal',
                loop: false
            });

            config.style = selectedStyle;
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;

                // Ensure the system prompt is updated in the message history if applicable
                const newSysPrompt = getSystemPrompt(config);
                if (typeof providerInstance.updateSystemPrompt === 'function') {
                    providerInstance.updateSystemPrompt(newSysPrompt);
                }
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.green(`AI style updated to: ${selectedStyle.charAt(0).toUpperCase() + selectedStyle.slice(1)}`));
            break;
        }
        case '/emoji': {
            const { select: emojiSelect } = await import('@inquirer/prompts');
            const selectedEmoji = await emojiSelect({
                message: 'Select an emoji mode for the AI:',
                choices: [
                    { name: 'Normal (Default)', value: 'normal' },
                    { name: 'Minimal (Fewer emojis)', value: 'minimal' },
                    { name: 'More (Lots of emojis)', value: 'more' }
                ],
                default: config.emojiMode || 'normal',
                loop: false
            });

            config.emojiMode = selectedEmoji;
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;

                // Ensure the system prompt is updated in the message history if applicable
                const newSysPrompt = getSystemPrompt(config);
                if (typeof providerInstance.updateSystemPrompt === 'function') {
                    providerInstance.updateSystemPrompt(newSysPrompt);
                }
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.green(`Emoji mode updated to: ${selectedEmoji.charAt(0).toUpperCase() + selectedEmoji.slice(1)}`));
            break;
        }
        case '/effort': {
            const { select: effortSelect } = await import('@inquirer/prompts');

            if (config.provider === 'openai' && config.authType === 'oauth') {
                const selectedEffort = await effortSelect({
                    message: `Select OpenAI Codex reasoning effort for ${config.model || 'current model'}:`,
                    choices: [
                        { name: 'Low (faster and cheaper)', value: 'low' },
                        { name: 'Medium (balanced default)', value: 'medium' },
                        { name: 'High (hard reasoning and complex coding)', value: 'high' },
                        { name: 'Extra-High (deepest reasoning, highest cost/latency)', value: 'xhigh' }
                    ],
                    default: config.openaiCodexEffort || 'medium',
                    loop: false
                });

                config.openaiCodexEffort = selectedEffort;
                await saveConfig(config);
                if (providerInstance) {
                    providerInstance.config.openaiCodexEffort = selectedEffort;
                }
                console.log(chalk.green(`OpenAI Codex reasoning effort updated to: ${selectedEffort.toUpperCase()}`));
                break;
            }

            if (config.provider !== 'claude') {
                console.log(chalk.yellow("The /effort command is currently only supported for Claude models and OpenAI Codex OAuth."));
                break;
            }

            const currentModel = providerInstance ? providerInstance.modelName : (config.model || '');
            const isAdvancedModel = currentModel.includes('opus-4') || currentModel.includes('sonnet-4');
            const isOpus47 = currentModel.includes('opus-4-7');

            const choices = [
                { name: 'Low (Fast, cheap, simple tasks)', value: 'low' },
                { name: 'Medium (Balanced)', value: 'medium' },
                { name: 'High (Standard, full capability)', value: 'high' }
            ];

            if (isAdvancedModel) {
                if (isOpus47) {
                    choices.push({ name: 'Extra-High (Deep reasoning, best for Opus 4.7)', value: 'xhigh' });
                }
                choices.push({ name: 'Max (No constraints, absolute maximum depth)', value: 'max' });
            }

            const selectedEffort = await effortSelect({
                message: `Select reasoning effort for ${currentModel}:`,
                choices,
                default: config.claudeEffort || 'high'
            });

            config.claudeEffort = selectedEffort;
            await saveConfig(config);
            if (providerInstance) {
                providerInstance.config.claudeEffort = selectedEffort;
            }
            console.log(chalk.green(`Claude reasoning effort updated to: ${selectedEffort.toUpperCase()}`));
            break;
        }
        case '/skill-creator':
            config.skillCreatorMode = true;
            config.planMode = false;
            config.askMode = false;
            config.securityMode = false;
            config.autoAcceptEditsMode = false;
            setAutoAcceptEditsMode(false);
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.cyan(`Skill Creator mode enabled. The AI will help you create custom Agent Skills.`));
            break;
        case '/agent':
            config.planMode = false;
            config.askMode = false;
            config.securityMode = false;
            config.skillCreatorMode = false;
            config.deepReviewMode = false;
            config.autoAcceptEditsMode = false;
            setAutoAcceptEditsMode(false);
            await saveConfig(config);
            if (providerInstance) {
                const savedMessages = providerInstance.messages;
                providerInstance = createProvider();
                providerInstance.messages = savedMessages;
            } else {
                providerInstance = createProvider();
            }
            console.log(chalk.green(`Agent mode enabled. The AI will make changes directly.`));
            break;
        case '/chats': {
            const sessions = await listSessions();
            if (sessions.length === 0) {
                console.log(chalk.yellow("No saved chat sessions found."));
            } else {
                const { select: chatSelect } = await import('@inquirer/prompts');
                const choices = sessions.map(s => {
                    const active = s.uuid === currentSessionId ? ' (active)' : '';
                    const date = new Date(s.updatedAt).toLocaleString();
                    const titleText = s.title ? `"${s.title}"` : s.uuid.slice(0, 8) + '...';
                    return {
                        name: `${titleText} - ${date} (${s.provider}/${s.model})${active}`,
                        value: s.uuid
                    };
                });

                const selectedSessionId = await chatSelect({
                    message: 'Select a chat session to resume:',
                    choices: choices,
                    pageSize: 10,
                    loop: false
                });

                if (selectedSessionId && selectedSessionId !== currentSessionId) {
                    const session = await loadSession(selectedSessionId);
                    if (session) {
                        currentSessionId = session.uuid;
                        currentSessionTitle = session.title || null;
                        config.provider = session.provider;
                        config.model = session.model;
                        providerInstance = createProvider();
                        if (providerInstance.messages !== undefined) {
                            providerInstance.messages = session.messages;
                        }
                        lastAssistantMessageText = getLastAssistantMessageText(session.messages);
                        playHistory(session);
                        console.log(chalk.green(`Resumed session: ${currentSessionTitle || currentSessionId} (${session.provider}/${session.model})\n`));
                    }
                }
            }
            break;
        }
        case '/memory': {
            if (config.useMemory === false) {
                console.log(chalk.yellow("Global AI Memory is disabled. Enable it in /settings first."));
                break;
            }
            const { select: memSelect, input: memInput } = await import('@inquirer/prompts');
            const { loadMemory, removeMemory, addMemory } = await import('./utils/memory.js');
            let memAction = await memSelect({
                message: 'Manage Global AI Memory:',
                choices: [
                    { name: 'View all memories', value: 'view' },
                    { name: 'Add a new memory manually', value: 'add' },
                    { name: 'Delete a memory', value: 'delete' }
                ],
                loop: false
            });

            if (memAction === 'view') {
                const mems = await loadMemory();
                if (mems.length === 0) {
                    console.log(chalk.yellow("No global memories saved yet."));
                } else {
                    console.log(chalk.cyan.bold("\nGlobal Memories:"));
                    mems.forEach(m => {
                        console.log(chalk.gray(`[${m.id}] `) + chalk.green(m.fact));
                    });
                }
            } else if (memAction === 'add') {
                const newFact = await memInput({
                    message: 'Enter the fact you want the AI to remember globally:',
                    validate: (v) => v.trim().length > 0 || 'Memory cannot be empty'
                });
                const id = await addMemory(newFact);
                console.log(chalk.green(`Memory saved with ID: ${id}`));
                providerInstance = createProvider(); // Reload provider to inject new memory
            } else if (memAction === 'delete') {
                const mems = await loadMemory();
                if (mems.length === 0) {
                    console.log(chalk.yellow("No memories to delete."));
                } else {
                    const idToDelete = await memSelect({
                        message: 'Select a memory to delete:',
                        choices: mems.map(m => ({ name: m.fact, value: m.id })),
                        loop: false,
                        pageSize: 10
                    });
                    const success = await removeMemory(idToDelete);
                    if (success) {
                        console.log(chalk.green(`Memory deleted.`));
                        providerInstance = createProvider(); // Reload provider
                    }
                }
            }
            break;
        }
        case '/init':
            console.log(chalk.cyan("Generating project summary for BANANA.md..."));
            const initSpinner = ora({ text: 'Analyzing project...', color: 'yellow', stream: process.stdout }).start();
            try {
                const { getWorkspaceTree } = await import('./utils/workspace.js');
                const tree = await getWorkspaceTree();

                const initProvider = createProvider();
                // We use a completely blank slate for this so it doesn't get confused
                initProvider.messages = [];

                let initPrompt = "SYSTEM: You are a project summarizer. Review the following project file tree and briefly describe what this project is, what technologies it uses, and any obvious conventions. Keep it under 2 paragraphs. Output ONLY the summary text.";
                initPrompt += `\n\n--- Project Tree ---\n${tree}`;

                const summary = await initProvider.sendMessage(initPrompt);

                const fs = await import('fs/promises');
                const path = await import('path');
                const bananaPath = path.join(process.cwd(), 'BANANA.md');
                await fs.writeFile(bananaPath, summary, 'utf8');

                initSpinner.stop();
                console.log(chalk.green(`Successfully created BANANA.md!`));

                // Re-init current provider so it picks up the new BANANA.md
                providerInstance = createProvider();
            } catch (err) {
                initSpinner.stop();
                console.log(chalk.red(`Failed to initialize project: ${err.message}`));
            }
            break;
        case '/import-instructions': {
            try {
                const result = await promptToMergeExternalAgentInstructions();
                if (result.status === 'no_pending') {
                    console.log(chalk.gray('No new external agent instructions to import (BANANA.md is already up to date).'));
                }
            } catch (err) {
                console.log(chalk.red(`Failed to import instructions: ${err.message}`));
            }
            break;
        }
        case '/plugin': {
            const subCmd = args[0];
            if (subCmd === 'add' || subCmd === 'install') {
                const pkg = args[1];
                if (!pkg) {
                    console.log(chalk.yellow("Usage: /plugin add <npm-package-name>"));
                    break;
                }
                const success = await installPlugin(pkg);
                if (success) {
                    console.log(chalk.green(`\nPlease restart Banana Code to fully load the new plugin.`));
                }
            } else if (subCmd === 'remove' || subCmd === 'uninstall') {
                const pkg = args[1];
                if (!pkg) {
                    console.log(chalk.yellow("Usage: /plugin remove <npm-package-name>"));
                    break;
                }
                const success = await removePlugin(pkg);
                if (success) {
                    console.log(chalk.green(`\nPlease restart Banana Code to complete removal.`));
                }
            } else if (subCmd === 'list') {
                const plugins = getConfiguredPlugins();
                if (plugins.length === 0) {
                    console.log(chalk.yellow("No plugins are currently installed."));
                } else {
                    console.log(chalk.cyan.bold("\nInstalled Plugins:"));
                    plugins.forEach(p => console.log(chalk.green(`- ${p}`)));
                }
            } else {
                console.log(chalk.yellow("Usage: /plugin <add|remove|list> [package-name]"));
            }
            break;
        }
        case '/help':
            console.log(chalk.yellow(`
Available commands:
  /provider <name> - Switch AI provider (gemini, claude, openai, mistral, deepseek, kimi, qwen, openrouter, ollama_cloud, ollama, lmstudio, llamacpp)
  /model [name]    - Switch model within current provider (opens menu if name omitted)
  /chats           - List persistent chat sessions
  /clear           - Clear chat history
  /clean           - Compress chat history into a summary to save tokens
  /copy            - Copy Banana Code's last message to your clipboard
  /feedback [text] - Send product feedback to Banana Code
  /voice           - Record speech, transcribe with the configured voice provider, then ask the AI
  /voice setup     - Configure Groq or OpenRouter transcription
  /voice <file>    - Transcribe an audio file and ask the AI
  /remotetooling   - Securely pair with Mobile App for remote approvals
  /remotetooling migrate - Replace old UUID-only pairing with secure pairing
  /remotetooling disconnect - Disconnect Mobile App remote approvals
  /github          - Connect a GitHub App installation and enable GitHub tools
  /github status   - Check the active GitHub connection
  /github disconnect - Disable GitHub tools and revoke the local integration token
  /context         - Show current context window size
  /permissions     - List session-approved permissions
  /beta            - Manage beta features and tools
  /settings        - Manage app settings (workspace auto-feed, etc)
  /skills          - List loaded agent skills
  /skills defaults - Enable or disable bundled default skills
  /memory          - Manage global AI memories
  /init            - Generate a BANANA.md project summary file
  /import-instructions - Merge AGENTS.md/CLAUDE.md/GEMINI.md into BANANA.md
  /goals [goal]    - Clarify, plan, then approve an autonomous implementation run
  /plan            - Enable Plan Mode (AI proposes a plan for big changes)
  /agent           - Enable Agent Mode (default, AI edits directly)
  /skill-creator   - Enable Skill Creator Mode (AI helps you create custom skills)
  /deepreview      - Enable DeepReview mode (Full codebase audit OR git diff review, no edits)
  /guard           - Toggle Banana Guard (AI auto-approve safe commands)
  /bananasplit     - Toggle BananaSplit local coding with cloud review (/bananasplit disable to turn off)
  /imagegen        - Configure Stable Diffusion image generation tool (/imagegen disable to turn off)
  /yolo            - Toggle YOLO mode (skip all permission requests)
  /style           - Change AI writing style (Formal, Explanatory, etc)
  /emoji           - Change AI emoji usage (Normal, Minimal, More)
  /effort          - Change Claude or OpenAI Codex OAuth reasoning effort
  /debug           - Toggle debug mode (show tool results)
  /plugin          - Manage plugins (add, remove, list)
  /help            - Show all commands
  /exit            - Quit Banana Code

Shortcut:
  Shift+Tab       - Cycle default mode, auto accept edits, and plan mode
  action@model   - Open the model menu before sending the current prompt
  action@effort  - Open the effort menu before sending the current prompt (Claude/OpenAI Codex OAuth)
`));
            if (Object.keys(pluginRegistry.commands).length > 0) {
                console.log(chalk.cyan(`\nPlugin Commands:`));
                for (const [cmdName, cmdInfo] of Object.entries(pluginRegistry.commands)) {
                    console.log(chalk.cyan(`  ${cmdName.padEnd(16)} - ${cmdInfo.description}`));
                }
            }
            break;
        case '/exit':
            console.log(chalk.yellow(`\nTo resume this session: node bin/banana.js --resume ${currentSessionId}`));
            console.log(chalk.yellow("🍌 Bye BananaCode. See ya!"));
            showFinalCost();
            cleanupTerminalSessions();
            process.exit(0);
            break;
        default:
            console.log(chalk.red(`Unknown command: ${cmd}. Type /help for a list of commands.`));
    }
}

let exitRequested = false;
const REPROMPT_SIGNAL = Symbol('REPROMPT');
const INLINE_PROMPT_ACTION_PATTERN = /\baction@(model|effort)\b/gi;

// Background colors for the chat UI
const userBg = chalk.bgRgb(30, 30, 46);       // Dark charcoal for user messages
const aiBg = chalk.bgRgb(42, 42, 62);         // Slightly lighter for AI responses

function getTermWidth() {
    return process.stdout.columns || 80;
}

function padLine(text, width) {
    const stripped = stripAnsi(text);
    const pad = Math.max(0, width - stripped.length);
    return text + ' '.repeat(pad);
}

let ultrathinkAnimationFrame = 0;

function stripAnsi(text) {
    return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function isNewUiEnabled() {
    return !process.argv.includes('--oldui');
}

function getPromptPrefix() {
    return isNewUiEnabled() ? '❯ ' : ' > ';
}

function getPromptPlaceholder() {
    return isNewUiEnabled() ? '' : 'Type your message or @path/to/file';
}

function getPromptFooterRows() {
    return isNewUiEnabled() ? 2 : 3;
}

function getPromptCycleMode() {
    if (config?.planMode) return 'plan';
    if (config?.autoAcceptEditsMode) return 'autoAcceptEdits';
    return 'default';
}

function updateCurrentProviderPrompt() {
    if (typeof providerInstance?.updateSystemPrompt === 'function') {
        providerInstance.updateSystemPrompt(getSystemPrompt(config));
    }
    if (providerInstance?.config) {
        providerInstance.config.planMode = config.planMode;
        providerInstance.config.askMode = config.askMode;
        providerInstance.config.securityMode = config.securityMode;
        providerInstance.config.skillCreatorMode = config.skillCreatorMode;
        providerInstance.config.deepReviewMode = config.deepReviewMode;
        providerInstance.config.autoAcceptEditsMode = config.autoAcceptEditsMode;
    }
    global.bananaConfig = config;
}

function getInlinePromptActions(text) {
    const actions = [];
    const seen = new Set();
    INLINE_PROMPT_ACTION_PATTERN.lastIndex = 0;
    for (const match of String(text || '').matchAll(INLINE_PROMPT_ACTION_PATTERN)) {
        const action = String(match[1] || '').toLowerCase();
        if (!seen.has(action)) {
            seen.add(action);
            actions.push(action);
        }
    }
    return actions;
}

function stripInlinePromptActions(text) {
    INLINE_PROMPT_ACTION_PATTERN.lastIndex = 0;
    return String(text || '')
        .replace(INLINE_PROMPT_ACTION_PATTERN, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim();
}

function activeProviderSupportsEffortAction() {
    const activeConfig = getBananaSplitLocalConfig(config || {});
    return activeConfig.provider === 'claude' ||
        (activeConfig.provider === 'openai' && activeConfig.authType === 'oauth');
}

async function applyInlinePromptActions(text) {
    const actions = getInlinePromptActions(text);
    if (actions.length === 0) return text;

    for (const action of actions) {
        if (action === 'model') {
            await handleSlashCommand('/model', { runUserTurn: processUserTurn });
            continue;
        }

        if (action === 'effort') {
            if (!activeProviderSupportsEffortAction()) {
                console.log(chalk.yellow('action@effort is only supported for Claude and OpenAI Codex OAuth.'));
                continue;
            }
            await handleSlashCommand('/effort', { runUserTurn: processUserTurn });
        }
    }

    return stripInlinePromptActions(text);
}

function enqueueInlinePromptTurn(text) {
    return enqueueCliTask(async () => {
        const cleanedText = await applyInlinePromptActions(text);
        if (!cleanedText.trim()) return null;
        return processUserTurn({ text: cleanedText, source: 'cli', titleSource: cleanedText });
    });
}

global.applyBananaConfigUpdate = async (updates = {}) => {
    Object.assign(config, updates);
    await saveConfig(config);
    global.bananaConfig = config;
    if (providerInstance?.config) {
        Object.assign(providerInstance.config, updates);
    }
};

function applyPromptCycleMode(mode) {
    const nextMode = ['default', 'autoAcceptEdits', 'plan'].includes(mode) ? mode : 'default';

    config.autoAcceptEditsMode = nextMode === 'autoAcceptEdits';
    config.planMode = nextMode === 'plan';

    if (nextMode !== 'plan') {
        config.goalsPlanningMode = false;
    }
    config.askMode = false;
    config.securityMode = false;
    config.skillCreatorMode = false;
    config.deepReviewMode = false;

    setAutoAcceptEditsMode(config.autoAcceptEditsMode);
    updateCurrentProviderPrompt();
}

function cyclePromptMode() {
    const modes = ['default', 'autoAcceptEdits', 'plan'];
    const currentIndex = modes.indexOf(getPromptCycleMode());
    const nextMode = modes[(currentIndex + 1) % modes.length];
    applyPromptCycleMode(nextMode);
}

function formatPromptCycleIndicator() {
    const suffix = chalk.gray(' (shift+tab to cycle)');
    const mode = getPromptCycleMode();
    if (mode === 'plan') {
        return rainbowVoice('● plan mode', ultrathinkAnimationFrame) + suffix;
    }
    if (mode === 'autoAcceptEdits') {
        const label = isNewUiEnabled() ? '● accept edits on' : '● auto accept edits on';
        return chalk.yellow(label) + suffix;
    }
    return chalk.cyan('● default mode') + suffix;
}

function formatPromptStatusLine(width) {
    const rawModel = providerInstance ? providerInstance.modelName : (config.model || 'unknown');
    const modelDisplay = rawModel === 'auto' ? chalk.cyan('[AUTO]') : rawModel;
    const providerDisplay = getActiveProviderId().toUpperCase();
    let modeDisplay = chalk.green('AGENT MODE');
    if (config.goalsPlanningMode) modeDisplay = chalk.cyan('GOALS');
    else if (config.askMode) modeDisplay = chalk.blue('ASK MODE');
    else if (config.securityMode) modeDisplay = chalk.red('SECURITY MODE');
    else if (config.planMode) modeDisplay = chalk.magenta('PLAN MODE');
    else if (config.skillCreatorMode) modeDisplay = chalk.cyan('SKILL CREATOR MODE');
    const bananaSplitDisplay = config.bananaSplit?.enabled ? ` / ${chalk.magenta('BananaSplit Active')}` : '';

    let tokenDisplay = '';
    if (config.showTokenCount && providerInstance) {
        let msgs = providerInstance.messages || [];
        // Support for Ollama chat history format if different
        if (!providerInstance.messages && typeof providerInstance.chat?.getHistory === 'function') {
            msgs = providerInstance.chat.getHistory(); // Note: this is async normally, but we use an approximation here or just skip it if it's strictly async. For now, assume providerInstance.messages is the standard.
        }
        const tokens = estimateConversationTokens(msgs);
        let color = chalk.green;
        if (tokens >= 128000) color = chalk.red;
        else if (tokens >= 86000) color = chalk.hex('#FFA500'); // Orange
        else if (tokens >= 64000) color = chalk.yellow;

        tokenDisplay = ` / Tokens: ${color(tokens.toLocaleString())}`;
    }

    let costDisplay = '';
    if (providerInstance && typeof providerInstance.calculateSessionCost === 'function') {
        const { cost } = providerInstance.calculateSessionCost();
        if (parseFloat(cost) > 0) {
            costDisplay = ` / Cost: ${chalk.green('$' + cost)}`;
        }
    }

    const yoloDisplay = config.yolo ? chalk.bgRed.white.bold(' YOLO ') : '';
    const leftText = ` Provider: ${chalk.cyan(providerDisplay)} / Model: ${chalk.yellow(modelDisplay)} / ${modeDisplay}${bananaSplitDisplay}${tokenDisplay}${costDisplay}${yoloDisplay ? ' / ' + yoloDisplay : ''}`;
    const rightText = chalk.gray('/help for shortcuts ');
    const leftStripped = stripAnsi(leftText);
    const rightStripped = stripAnsi(rightText);
    const midPad = Math.max(0, width - leftStripped.length - rightStripped.length);
    return chalk.gray(leftText + ' '.repeat(midPad) + rightText);
}

function getPromptFooterLines(width) {
    const separator = chalk.gray('─'.repeat(width));
    if (isNewUiEnabled()) {
        return [
            separator,
            padLine(`  ${formatPromptCycleIndicator()}`, width)
        ];
    }
    return [
        formatPromptStatusLine(width),
        padLine(` ${formatPromptCycleIndicator()}`, width),
        separator
    ];
}

function isUltrathinkRainbowEnabled() {
    try {
        return providerSupportsUltrathink(getBananaSplitLocalConfig(config));
    } catch (e) {
        return false;
    }
}

function stylePromptSegment(segment, isEmpty) {
    if (isEmpty) return chalk.gray(segment);
    if (!isUltrathinkRainbowEnabled()) {
        return styleVoiceCommands(segment, chalk.white, ultrathinkAnimationFrame);
    }
    return styleUltrathinkMentions(
        segment,
        value => styleVoiceCommands(value, chalk.white, ultrathinkAnimationFrame),
        ultrathinkAnimationFrame
    );
}

function playHistory(session) {
    process.stdout.write('\x1bc'); // Clear screen
    console.log(chalk.yellow.bold("🍌 Banana Code — Peeling the project..."));
    console.log(chalk.gray("-------------------------------------------"));
    for (const msg of session.messages) {
        if (msg.role === 'system') continue;

        if (session.provider === 'gemini') {
            if (msg.role === 'user') {
                if (msg.parts[0]?.text) console.log(`${chalk.yellow('🍌 >')} ${msg.parts[0].text}`);
                else if (msg.parts[0]?.functionResponse) {
                    console.log(chalk.yellow(`[Tool Result Received]`));
                }
            } else if (msg.role === 'model') {
                msg.parts.forEach(p => {
                    if (p.text) {
                        if (config.useMarkedTerminal) printMarkdown(p.text);
                        else process.stdout.write(chalk.cyan(p.text));
                    }
                    if (p.functionCall) console.log(chalk.yellow(`\n[Banana Calling Tool: ${p.functionCall.name}]`));
                });
                console.log();
            }
        } else if (session.provider === 'claude') {
            if (msg.role === 'user') {
                if (typeof msg.content === 'string') console.log(`${chalk.yellow('🍌 >')} ${msg.content}`);
                else {
                    msg.content.forEach(c => {
                        if (c.type === 'tool_result') console.log(chalk.yellow(`[Tool Result Received]`));
                    });
                }
            } else if (msg.role === 'assistant') {
                if (typeof msg.content === 'string') {
                    if (config.useMarkedTerminal) printMarkdown(msg.content);
                    else process.stdout.write(chalk.cyan(msg.content));
                } else {
                    msg.content.forEach(c => {
                        if (c.type === 'text') {
                            if (config.useMarkedTerminal) printMarkdown(c.text);
                            else process.stdout.write(chalk.cyan(c.text));
                        }
                        if (c.type === 'tool_use') console.log(chalk.yellow(`\n[Banana Calling Tool: ${c.name}]`));
                    });
                }
                console.log();
            }
        } else {
            // OpenAI, Ollama, Mistral
            if (msg.role === 'user') {
                console.log(`${chalk.yellow('🍌 >')} ${msg.content}`);
            } else if (msg.role === 'assistant' || msg.role === 'output_text') {
                if (msg.content) {
                    if (config.useMarkedTerminal) printMarkdown(msg.content);
                    else process.stdout.write(chalk.cyan(msg.content));
                }
                if (msg.tool_calls) {
                    msg.tool_calls.forEach(tc => {
                        const name = tc.function ? tc.function.name : tc.name;
                        console.log(chalk.yellow(`\n[Banana Calling Tool: ${name}]`));
                    });
                }
                console.log();
            } else if (msg.role === 'tool') {
                console.log(chalk.yellow(`[Tool Result Received]`));
            }
        }
    }
}

let lastPromptRows = 1;
// Tracks the cursor's offset within the prompt block at the END of the previous
// draw, so the next redraw knows how far up to go to reach row 0. Without this,
// using `lastPromptRows - 1` assumes the cursor sits on the bottom row, which
// isn't true when the user moves the cursor or when typing crosses a row
// boundary — leading to redraws landing above the prompt and leaving stale
// content (e.g. duplicate ' > ' lines).
let lastCursorRow = 0;

function drawPromptBox(inputText, cursorPos) {
    const width = getTermWidth();
    const placeholder = getPromptPlaceholder();
    const prefix = getPromptPrefix();

    const isEmpty = inputText.length === 0;
    const rawContent = isEmpty ? placeholder : inputText;
    const totalChars = prefix.length + rawContent.length;
    const cursorIndex = prefix.length + cursorPos;
    // Ensure we always have enough rows to host the cursor, even when input
    // exactly fills the last row (cursor sits at start of next line).
    const rows = Math.max(Math.ceil(totalChars / width) || 1, Math.floor(cursorIndex / width) + 1);

    // Move back to row 0 of the prompt block, then wipe everything below so the
    // redraw starts from a clean slate.
    if (lastCursorRow > 0) {
        process.stdout.write(`\x1b[${lastCursorRow}A`);
    }
    process.stdout.write(`\x1b[1G\x1b[J`);

    if (isNewUiEnabled()) {
        process.stdout.write(chalk.gray('─'.repeat(width)) + '\n');
    }

    // Draw each row: slice raw content, then color per-segment so ANSI escapes
    // never bleed across line boundaries.
    const firstRowChars = width - prefix.length;
    for (let i = 0; i < rows; i++) {
        let segment, lineText;
        if (i === 0) {
            segment = rawContent.substring(0, firstRowChars);
            lineText = prefix + stylePromptSegment(segment, isEmpty);
        } else {
            const offset = firstRowChars + (i - 1) * width;
            segment = rawContent.substring(offset, offset + width);
            lineText = stylePromptSegment(segment, isEmpty);
        }
        const outputLine = isNewUiEnabled() ? padLine(lineText, width) : userBg(padLine(lineText, width));
        process.stdout.write(outputLine + '\n');
    }

    const footerLines = getPromptFooterLines(width);
    footerLines.forEach((line, index) => {
        process.stdout.write(line + (index === footerLines.length - 1 ? '' : '\n'));
    });

    lastPromptRows = rows;

    // Position cursor: find row and col
    const targetRow = Math.floor(cursorIndex / width);
    const targetCol = (cursorIndex % width) + 1;

    // Move cursor back up (footer rows + N-1-targetRow for prompt rows)
    const moveUp = (rows - 1 - targetRow) + getPromptFooterRows();
    process.stdout.write(`\x1b[${moveUp}A\x1b[${targetCol}G`);

    lastCursorRow = isNewUiEnabled() ? targetRow + 1 : targetRow;
}

function drawPromptBoxInitial(inputText) {
    const width = getTermWidth();
    const placeholder = getPromptPlaceholder();
    const prefix = getPromptPrefix();

    const isEmpty = inputText.length === 0;
    const rawContent = isEmpty ? placeholder : inputText;
    const totalChars = prefix.length + rawContent.length;
    const cursorIndex = prefix.length + (inputText.length || 0);
    const rows = Math.max(Math.ceil(totalChars / width) || 1, Math.floor(cursorIndex / width) + 1);

    lastPromptRows = rows;

    if (isNewUiEnabled()) {
        process.stdout.write(chalk.gray('─'.repeat(width)) + '\n');
    }

    // Draw initial wrapped lines: slice raw content first, color per-segment.
    const firstRowChars = width - prefix.length;
    for (let i = 0; i < rows; i++) {
        let segment, lineText;
        if (i === 0) {
            segment = rawContent.substring(0, firstRowChars);
            lineText = prefix + stylePromptSegment(segment, isEmpty);
        } else {
            const offset = firstRowChars + (i - 1) * width;
            segment = rawContent.substring(offset, offset + width);
            lineText = stylePromptSegment(segment, isEmpty);
        }
        const outputLine = isNewUiEnabled() ? padLine(lineText, width) : userBg(padLine(lineText, width));
        process.stdout.write(outputLine + '\n');
    }

    const footerLines = getPromptFooterLines(width);
    footerLines.forEach((line, index) => {
        process.stdout.write(line + (index === footerLines.length - 1 ? '' : '\n'));
    });

    // Move cursor back up to content line (up footer rows + N-1 for wrapping)
    const targetRow = Math.floor(cursorIndex / width);
    const moveUp = (rows - 1 - targetRow) + getPromptFooterRows();
    const targetCol = (cursorIndex % width) + 1;

    process.stdout.write(`\x1b[${moveUp}A\x1b[${targetCol}G`);

    lastCursorRow = isNewUiEnabled() ? targetRow + 1 : targetRow;
}

function promptUser() {
    return new Promise((resolve) => {
        let inputBuffer = '';
        let cursorPos = 0;
        let resolveCalled = false;
        let onData;    // Declare early so resolve closure can reference it
        let onResize;  // Same for resize listener
        let ultrathinkAnimationTimer = null;
        const interruptThisPrompt = () => {
            if (resolveCalled) return;
            resolve(REPROMPT_SIGNAL);
        };

        const stopUltrathinkAnimation = () => {
            if (ultrathinkAnimationTimer) {
                clearInterval(ultrathinkAnimationTimer);
                ultrathinkAnimationTimer = null;
            }
        };

        const syncUltrathinkAnimation = () => {
            const shouldAnimateUltrathink = isUltrathinkRainbowEnabled() && /@ultrathink\b/i.test(inputBuffer);
            const shouldAnimateVoice = /(^|[\s([{])\/voice\b/i.test(inputBuffer);
            const shouldAnimatePromptMode = getPromptCycleMode() === 'plan';

            if (!shouldAnimateUltrathink && !shouldAnimateVoice && !shouldAnimatePromptMode) {
                stopUltrathinkAnimation();
                return;
            }

            if (!ultrathinkAnimationTimer) {
                ultrathinkAnimationTimer = setInterval(() => {
                    if (resolveCalled) {
                        stopUltrathinkAnimation();
                        return;
                    }
                    ultrathinkAnimationFrame = (ultrathinkAnimationFrame + 1) % 8;
                    drawPromptBox(inputBuffer, cursorPos);
                }, 140);
            }
        };

        const redrawPrompt = () => {
            drawPromptBox(inputBuffer, cursorPos);
            syncUltrathinkAnimation();
        };

        const originalResolve = resolve;
        resolve = (val) => {
            if (resolveCalled) return;
            resolveCalled = true;
            if (activePromptInterrupt === interruptThisPrompt) {
                activePromptInterrupt = null;
            }
            stopUltrathinkAnimation();
            process.stdout.write('\x1b[?2004l'); // disable bracketed paste mode
            if (onResize) process.stdout.removeListener('resize', onResize);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            if (onData) process.stdin.removeListener('data', onData);

            // Move cursor past the prompt lines + status + separator, clear them
            // We are currently on some row of the prompt.
            const width = getTermWidth();
            const cursorIndex = getPromptPrefix().length + cursorPos;
            const currentRow = Math.floor(cursorIndex / width);
            const moveDown = (lastPromptRows - 1 - currentRow) + 1;
            const footerRows = getPromptFooterRows();

            process.stdout.write(`\x1b[${moveDown}B`); // move to status line
            for (let i = 0; i < footerRows; i++) { // clear status rows and separator
                process.stdout.write(`\x1b[2K\x1b[1B`);
            }
            process.stdout.write(`\x1b[1G\n`);   // beginning of line + newline
            originalResolve(val);
        };

        const handleExit = async () => {
            if (!exitRequested) {
                exitRequested = true;
                const footerRows = getPromptFooterRows();
                const moveDown = lastPromptRows + footerRows - 1; // rough guess
                process.stdout.write(`\x1b[${moveDown}B`);
                for (let i = 0; i < footerRows; i++) {
                    process.stdout.write(`\x1b[2K\x1b[1B`);
                }
                process.stdout.write('\x1b[1G\n');
                process.stdout.write(chalk.yellow('(Press CTRL+C or CTRL+D again to exit)\n'));
                resolve(REPROMPT_SIGNAL);
            } else {
                const footerRows = getPromptFooterRows();
                const moveDown = lastPromptRows + footerRows - 1;
                process.stdout.write(`\x1b[${moveDown}B`);
                for (let i = 0; i < footerRows; i++) {
                    process.stdout.write(`\x1b[2K\x1b[1B`);
                }
                process.stdout.write('\x1b[1G\n');
                console.log(chalk.yellow(`\nTo resume this session: node bin/banana.js --resume ${currentSessionId}`));
                console.log(chalk.yellow("🍌 Bye BananaCode. See ya!"));
                await saveCurrentSession();
                showFinalCost();
                cleanupTerminalSessions();
                mcpManager.cleanup();
                process.exit(0);
            }
        };

        drawPromptBoxInitial('');
        activePromptInterrupt = interruptThisPrompt;

        if (!process.stdin.isTTY) {
            const rl = readline.createInterface({ input: process.stdin });
            rl.on('line', (line) => { resolve(line); rl.close(); });
            rl.on('close', () => { if (!resolveCalled) resolve(REPROMPT_SIGNAL); });
            return;
        }

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write('\x1b[?2004h'); // enable bracketed paste mode

        let isPasting = false;
        let pasteBuffer = '';

        onData = (key) => {
            let str = key.toString();

            // Bracketed paste: accumulate content between \x1b[200~ and \x1b[201~,
            // then insert it all at once with newlines normalized to spaces.
            if (str.includes('\x1b[200~') || isPasting) {
                if (str.includes('\x1b[200~')) {
                    isPasting = true;
                    str = str.slice(str.indexOf('\x1b[200~') + 6);
                }
                if (str.includes('\x1b[201~')) {
                    isPasting = false;
                    str = str.slice(0, str.indexOf('\x1b[201~'));
                    const fullPaste = normalizePromptInputText(pasteBuffer + str);
                    pasteBuffer = '';
                    if (fullPaste.length > 0) {
                        exitRequested = false;
                        inputBuffer = inputBuffer.slice(0, cursorPos) + fullPaste + inputBuffer.slice(cursorPos);
                        cursorPos += fullPaste.length;
                        redrawPrompt();
                    }
                } else {
                    pasteBuffer += str;
                }
                return;
            }

            if (str === '\x03') { handleExit(); return; }       // CTRL+C
            if (str === '\x04') { handleExit(); return; }       // CTRL+D

            if (str === '\r' || str === '\n') {                 // Enter
                exitRequested = false;
                if (inputBuffer.trim() && inputBuffer !== commandHistory[commandHistory.length - 1]) {
                    commandHistory.push(inputBuffer);
                }
                historyIndex = -1;
                resolve(inputBuffer);
                return;
            }

            if (str === '\x7f' || str === '\b') {               // Backspace
                exitRequested = false;
                if (cursorPos > 0) {
                    inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
                    cursorPos--;
                    redrawPrompt();
                }
                return;
            }

            if (str === '\x1b[3~') {                            // Delete
                exitRequested = false;
                if (cursorPos < inputBuffer.length) {
                    inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
                    redrawPrompt();
                }
                return;
            }

            if (str === '\x1b[D') {                             // Arrow Left
                if (cursorPos > 0) { cursorPos--; redrawPrompt(); }
                return;
            }

            if (str === '\x1b[C') {                             // Arrow Right
                if (cursorPos < inputBuffer.length) { cursorPos++; redrawPrompt(); }
                return;
            }

            if (str === '\x1b[A') {                             // Arrow Up
                if (historyIndex === -1) {
                    currentInputSaved = inputBuffer;
                }
                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    inputBuffer = commandHistory[commandHistory.length - 1 - historyIndex];
                    cursorPos = inputBuffer.length;
                    redrawPrompt();
                }
                return;
            }

            if (str === '\x1b[B') {                             // Arrow Down
                if (historyIndex > -1) {
                    historyIndex--;
                    if (historyIndex === -1) {
                        inputBuffer = currentInputSaved;
                    } else {
                        inputBuffer = commandHistory[commandHistory.length - 1 - historyIndex];
                    }
                    cursorPos = inputBuffer.length;
                    redrawPrompt();
                }
                return;
            }

            if (str === '\x1b[H' || str === '\x01') {           // Home / Ctrl+A
                cursorPos = 0; redrawPrompt();
                return;
            }

            if (str === '\x1b[F' || str === '\x05') {           // End / Ctrl+E
                cursorPos = inputBuffer.length; redrawPrompt();
                return;
            }

            if (str === '\x1b[Z') {                             // Shift+Tab
                exitRequested = false;
                cyclePromptMode();
                redrawPrompt();
                return;
            }

            if (str.startsWith('\x1b')) return;                 // Ignore other escapes

            // Regular character
            str = normalizePromptInputText(str);
            if (!str) return;
            exitRequested = false;
            inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
            cursorPos += str.length;
            redrawPrompt();
        };

        process.stdin.on('data', onData);

        // On terminal resize: reset tracking state, jump to the bottom of the
        // terminal so stale prompt rows scroll off, and redraw with new width.
        onResize = () => {
            lastCursorRow = 0;
            lastPromptRows = 1;
            process.stdout.write('\x1b[2J\x1b[H');
            redrawPrompt();
        };
        process.stdout.on('resize', onResize);
    });
}

async function main() {
    try {
        const trustedProjectSettings = await confirmProjectLocalSettingsTrust();
        if (!trustedProjectSettings) {
            console.log(chalk.yellow('Exiting. Review .banana/settings.local.json before running Banana Code here again.'));
            process.exit(0);
        }

        config = await loadConfig({ includeProjectLocal: true });
        config.newUi = isNewUiEnabled();
        if (config.newUi) {
            process.env.BANANA_CODE_NEWUI = '1';
        }

        // Default Banana Guard to true for existing users upgrading
        if (config.useBananaGuard === undefined) {
            config.useBananaGuard = true;
        }

        const isNonInteractiveEnv = Boolean(
            process.env.CI ||
            process.env.BANANA_NONINTERACTIVE ||
            process.env.GITHUB_ACTIONS ||
            process.env.BUILDKITE ||
            process.env.JENKINS_URL
        );

        if (!process.argv.includes('--api') && process.stdin.isTTY && process.stdout.isTTY && !isNonInteractiveEnv) {
            await promptToMergeExternalAgentInstructions();
        }

        // Global pointers for Banana Guard
        global.bananaConfig = config;
        global.createProvider = createProvider;

        if (config.remoteUuid && config.remoteDeviceToken) {
            connectCurrentRemoteTooling({
                uuid: config.remoteUuid,
                token: config.remoteDeviceToken,
                deviceType: config.remoteDeviceType || 'cli'
            });
        } else if (config.remoteUuid && !config.remoteDeviceToken) {
            console.log(chalk.yellow('Remote tooling uses an old pairing. Create/login on the phone, generate a code, then run /remotetooling migrate.'));
        }

        if (process.argv.includes('--yolo')) {
            config.yolo = true;
        }
        setYoloMode(config.yolo);
        setAutoAcceptEditsMode(config.autoAcceptEditsMode === true);

        if (config.newUi) {
            await loadPlugins();
            const startupConfig = getBananaSplitLocalConfig(config);
            await runStartup({
                newUi: true,
                cwd: process.cwd(),
                providerName: getActiveProviderId(),
                modelName: startupConfig.model || 'unknown',
                authType: startupConfig.authType || 'api_key'
            });
        } else {
            await runStartup();
            await loadPlugins();
        }

        if (config.betaTools && config.betaTools.includes('mcp_support')) {
            await mcpManager.init();
        }

        const apiIdx = process.argv.indexOf('--api');
        if (apiIdx !== -1) {
            const portStr = process.argv[apiIdx + 1];
            const port = portStr && !portStr.startsWith('-') ? parseInt(portStr) : 3000;

            let host = '127.0.0.1';
            const hostIdx = process.argv.indexOf('--host');
            if (hostIdx !== -1 && process.argv[hostIdx + 1] && !process.argv[hostIdx + 1].startsWith('-')) {
                host = process.argv[hostIdx + 1];
            } else if (process.argv.includes('--expose')) {
                host = '0.0.0.0';
            }

            const noAuth = process.argv.includes('--no-auth');

            await startApiServer(port, createProvider, host, noAuth, config);
            return;
        }

        const resumeIdx = process.argv.indexOf('--resume');
        if (resumeIdx !== -1) {
            let resumeId = process.argv[resumeIdx + 1];
            if (!resumeId || resumeId.startsWith('-')) {
                resumeId = await getLatestSessionId();
            }

            if (resumeId) {
                const session = await loadSession(resumeId);
                if (session) {
                    currentSessionId = session.uuid;
                    currentSessionTitle = session.title || null;
                    config.provider = session.provider;
                    config.model = session.model;
                    providerInstance = createProvider();
                    if (providerInstance.messages !== undefined) {
                        providerInstance.messages = session.messages;
                    }
                    lastAssistantMessageText = getLastAssistantMessageText(session.messages);
                    playHistory(session);
                    console.log(chalk.green(`Resumed session: ${currentSessionTitle || currentSessionId} (${session.provider}/${session.model})\n`));
                } else {
                    console.log(chalk.red(`Could not find session ${resumeId}. Starting fresh.`));
                }
            } else {
                console.log(chalk.yellow("No sessions available to resume. Starting fresh."));
            }
        }

        if (!currentSessionId) {
            currentSessionId = generateSessionId();
            providerInstance = createProvider();
        }
        publishCurrentRemoteCapabilities();

        let ultraMemoryInterval;
        if (config.useUltraMemory) {
            import('./utils/ultraMemory.js').then(({ runUltraMemoryBackground }) => {
                ultraMemoryInterval = setInterval(() => runUltraMemoryBackground(config, createProvider), 60000);
                runUltraMemoryBackground(config, createProvider);
            });
        }

        while (true) {
            const inputLine = await promptUser();

            if (inputLine === REPROMPT_SIGNAL) {
                await waitForQueuedCliWork();
                continue;
            }

            const trimmed = inputLine.trim();

            if (!trimmed) continue;

            if (trimmed.startsWith('/')) {
                await enqueueSlashCommand(trimmed);
                await waitForQueuedCliWork();
                publishCurrentRemoteCapabilities();
            } else {
                await enqueueInlinePromptTurn(trimmed);
                await waitForQueuedCliWork();
                publishCurrentRemoteCapabilities();
            }
        }
    } catch (error) {
        console.error(chalk.red(`Fatal error: ${error.message}`));
        process.exit(1);
    }
}

async function saveCurrentSession() {
    if (currentSessionId && providerInstance) {
        try {
            await saveSession(currentSessionId, {
                provider: config.provider,
                model: config.model || providerInstance.modelName,
                messages: providerInstance.messages,
                title: currentSessionTitle
            });
        } catch (e) {
            // silent fail on exit
        }
    }
}

function showFinalCost() {
    if (providerInstance && typeof providerInstance.calculateSessionCost === 'function') {
        const { cost, savings } = providerInstance.calculateSessionCost();
        if (parseFloat(cost) > 0) {
            console.log(chalk.yellow(`\nFinal Session Cost: $${cost}`));
            if (parseFloat(savings) > 0) {
                console.log(chalk.cyan(`You saved $${savings} this session thanks to Prompt Caching! 🍌`));
            }
        }
    }
}

main();

process.on('SIGINT', async () => {
    await saveCurrentSession();
    showFinalCost();
    cleanupTerminalSessions();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await saveCurrentSession();
    showFinalCost();
    cleanupTerminalSessions();
    process.exit(0);
});
process.on('uncaughtException', async (err) => {
    console.error(chalk.red('Uncaught Exception:'), err);
    await saveCurrentSession();
    showFinalCost();
    cleanupTerminalSessions();
    process.exit(1);
});
process.on('unhandledRejection', async (reason) => {
    console.error(chalk.red('Unhandled Rejection:'), reason);
    await saveCurrentSession();
    showFinalCost();
    cleanupTerminalSessions();
    process.exit(1);
});
