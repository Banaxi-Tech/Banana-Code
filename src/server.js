// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import http from 'http';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DEFAULT_IMAGEGEN_BASE_URL, listImageGenModels, loadConfig, normalizeImageGenBaseUrl, saveConfig, copyBananaSplitProviderConfig, getBananaSplitLocalConfig } from './config.js';
import { listSessions, loadSession, saveSession, generateSessionId } from './sessions.js';
import { getSessionPermissions, setYoloMode } from './permissions.js';
import { getContextBreakdown } from './utils/tokens.js';
import { TOOLS } from './tools/registry.js';
import { mcpManager } from './utils/mcp.js';
import { BrowserBridge } from './utils/browserBridge.js';
import { extractUltrathinkDirective, isUltrathinkMention, providerSupportsUltrathink } from './utils/ultrathink.js';
import { GROQ_WHISPER_MODELS, getVoiceConfig, mimeTypeFromFileName, transcribeWithGroq } from './voice.js';

const PROVIDER_REINIT_KEYS = new Set([
    'provider',
    'model',
    'apiKey',
    'betaTools',
    'usePatchFile',
    'useMemory',
    'bananaSplit',
    'imageGen',
    'browserUse',
    'planMode',
    'askMode',
    'securityMode',
    'deepReviewMode',
    'skillCreatorMode',
    'useExtendedCache',
    'claudeEffort',
    'openaiCodexEffort'
]);

const LOCAL_BANANA_SPLIT_PROVIDERS = new Set(['ollama', 'lmstudio']);
const REVIEWER_BANANA_SPLIT_PROVIDERS = new Set(['gemini', 'claude', 'openai', 'mistral', 'deepseek', 'kimi', 'openrouter', 'ollama_cloud']);
const IMAGE_EXTENSIONS = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.gif', 'image/gif']
]);
const AUDIO_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

function shouldReinitializeProvider(configUpdate = {}) {
    return Object.keys(configUpdate).some(key => PROVIDER_REINIT_KEYS.has(key));
}

function getActiveProviderId(config = {}) {
    return config?.bananaSplit?.enabled && config.bananaSplit.local?.provider
        ? config.bananaSplit.local.provider
        : config.provider;
}

function isPortableChatHistory(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    return messages.every(msg => {
        return msg && typeof msg === 'object' && !Object.prototype.hasOwnProperty.call(msg, 'parts');
    });
}

function shouldPreserveHistoryAcrossReinit(savedMessages, previousConfig, nextConfig) {
    if (savedMessages === undefined) return false;
    if (Array.isArray(savedMessages) && savedMessages.length === 0) return false;

    const previousProvider = getActiveProviderId(previousConfig);
    const nextProvider = getActiveProviderId(nextConfig);
    if (previousProvider && previousProvider === nextProvider) return true;

    return nextProvider !== 'gemini' && isPortableChatHistory(savedMessages);
}

function reinitializeProviderPreservingHistory(providerInstance, createProvider, previousConfig, nextConfig = previousConfig) {
    const savedMessages = providerInstance?.messages;
    const nextProvider = createProviderForConfig(createProvider, nextConfig);
    if (
        nextProvider?.messages !== undefined &&
        shouldPreserveHistoryAcrossReinit(savedMessages, previousConfig, nextConfig)
    ) {
        nextProvider.messages = savedMessages;
    }
    return nextProvider;
}

function createProviderForConfig(createProvider, config) {
    return createProvider(getBananaSplitLocalConfig(config));
}

function providerHasBrowserTools(providerInstance) {
    if (!Array.isArray(providerInstance?.tools)) return false;
    return providerInstance.tools.some(tool => {
        return tool?.name === 'browser_open'
            || tool?.function?.name === 'browser_open';
    });
}

async function refreshSystemPrompt(providerInstance, config) {
    if (providerInstance && typeof providerInstance.updateSystemPrompt === 'function') {
        const { getSystemPrompt } = await import('./prompt.js');
        providerInstance.updateSystemPrompt(getSystemPrompt(config));
    }
}

async function collectProviderMessages(providerInstance) {
    if (!providerInstance) return [];
    if (providerInstance.messages) return providerInstance.messages;
    if (typeof providerInstance.chat?.getHistory === 'function') return await providerInstance.chat.getHistory();
    return [];
}

async function buildContextInfo(providerInstance) {
    const messages = await collectProviderMessages(providerInstance);
    const breakdown = getContextBreakdown(messages);
    const payload = { breakdown };

    if (providerInstance && typeof providerInstance.calculateSessionCost === 'function') {
        payload.cost = providerInstance.calculateSessionCost();
    }

    return payload;
}

function resolveAttachmentPath(rawPath, workspace) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
        throw new Error('Attachment path must be a non-empty string.');
    }

    let cleaned = rawPath.trim();
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
    }

    if (cleaned.startsWith('~')) {
        cleaned = path.join(os.homedir(), cleaned.slice(1));
    }

    return path.resolve(path.isAbsolute(cleaned) ? cleaned : path.join(workspace, cleaned));
}

function extractInlineAttachmentMentions(text = '') {
    const mentions = [];
    const mentionRegex = /@@?("[^"]+"|'[^']+'|[^\s]+)/g;
    for (const match of text.matchAll(mentionRegex)) {
        if (isUltrathinkMention(match[0])) continue;
        mentions.push(match[1]);
    }
    return mentions;
}

function formatBrowserElementContext(browserElements = [], workspace = process.cwd()) {
    if (!Array.isArray(browserElements) || browserElements.length === 0) return '';

    const sections = browserElements.map((element, index) => {
        const ancestry = Array.isArray(element?.ancestry)
            ? JSON.stringify(element.ancestry, null, 2)
            : '[]';
        const sourceHints = Array.isArray(element?.sourceHints)
            ? JSON.stringify(element.sourceHints, null, 2)
            : '[]';
        const attributes = element?.attributes && typeof element.attributes === 'object'
            ? JSON.stringify(element.attributes, null, 2)
            : '{}';
        const computed = element?.computed && typeof element.computed === 'object'
            ? JSON.stringify(element.computed, null, 2)
            : '{}';
        const rect = element?.rect && typeof element.rect === 'object'
            ? JSON.stringify(element.rect)
            : '{}';
        return `--- Browser Element ${index + 1} ---
Page URL: ${element?.url || ''}
Page title: ${element?.title || ''}
Tag: ${element?.tag || ''}
Role: ${element?.role || ''}
Selector: ${element?.selector || ''}
XPath: ${element?.xpath || ''}
Element id: ${element?.id || ''}
Class: ${element?.className || ''}
ARIA label: ${element?.ariaLabel || ''}
Viewport rect: ${rect}
Visible text:
${element?.text || ''}

Input/value text:
${element?.value || ''}

Attributes:
${attributes}

DOM ancestry:
${ancestry}

Framework/source hints:
${sourceHints}

Computed style excerpt:
${computed}

Outer HTML:
${element?.outerHTML || ''}

Parent HTML:
${element?.parentHTML || ''}
--- End Browser Element ${index + 1} ---`;
    }).join('\n\n');

    return `\n\n--- Browser Element Context ---
The user selected the following exact element(s) in the visible Studio browser using "Edit using AI".
Current local workspace: ${workspace}

Use this DOM context to identify the corresponding local source files when the workspace contains the website/app code. Search the local project for matching text, selectors, ids, classes, or component structure, then make the requested local code changes with file-editing tools. If the current workspace does not contain the source code for this page, explain that you cannot edit it locally and say what code/project would be needed.

${sections}
--- End Browser Element Context ---`;
}

async function prepareChatInput(text = '', attachments = [], workspace = process.cwd(), browserElements = []) {
    const seenPaths = new Set();
    const originalPromptText = String(text || '');
    let promptText = originalPromptText + formatBrowserElementContext(browserElements, workspace);
    const images = [];
    const dropped = [];
    const requestedPaths = [
        ...extractInlineAttachmentMentions(originalPromptText),
        ...attachments.map(attachment => typeof attachment === 'string' ? attachment : attachment?.path).filter(Boolean)
    ];

    for (const rawPath of requestedPaths) {
        let resolvedPath;
        try {
            resolvedPath = resolveAttachmentPath(rawPath, workspace);
            if (seenPaths.has(resolvedPath)) continue;
            seenPaths.add(resolvedPath);

            const stat = await fs.stat(resolvedPath);
            if (!stat.isFile()) {
                dropped.push({ rawPath, resolvedPath, reason: 'Not a regular file' });
                continue;
            }

            const ext = path.extname(resolvedPath).toLowerCase();
            const mimeType = IMAGE_EXTENSIONS.get(ext);
            if (mimeType) {
                const buffer = await fs.readFile(resolvedPath);
                images.push({ base64: buffer.toString('base64'), mimeType, path: resolvedPath });
            } else {
                const content = await fs.readFile(resolvedPath, 'utf8');
                promptText += `\n\n--- File Context: ${resolvedPath} ---\n${content}\n--- End of ${resolvedPath} ---`;
            }
        } catch (error) {
            const resolvedSuffix = resolvedPath ? ` (${resolvedPath})` : '';
            console.log(chalk.yellow(`[API] Warning: Could not read attachment ${rawPath}${resolvedSuffix}: ${error.message}`));
            dropped.push({ rawPath, resolvedPath, reason: error.message });
        }
    }

    return { text: promptText, images, dropped };
}

function normalizeBananaSplitConfig(input = {}, currentConfig = {}) {
    const enabled = input.enabled !== false;
    if (!enabled) {
        return {
            ...(currentConfig.bananaSplit || {}),
            enabled: false
        };
    }

    const existing = currentConfig.bananaSplit || {};
    const localInput = input.local ?? existing.local;
    const reviewerInput = input.reviewer ?? existing.reviewer;
    const localProvider = localInput?.provider;
    const reviewerProvider = reviewerInput?.provider;
    if (!LOCAL_BANANA_SPLIT_PROVIDERS.has(localProvider)) {
        throw new Error('BananaSplit local provider must be ollama or lmstudio.');
    }
    if (!REVIEWER_BANANA_SPLIT_PROVIDERS.has(reviewerProvider)) {
        throw new Error('BananaSplit reviewer provider must be one of gemini, claude, openai, mistral, deepseek, kimi, openrouter, ollama_cloud.');
    }

    return {
        enabled: true,
        local: copyBananaSplitProviderConfig(localProvider, localInput),
        reviewer: copyBananaSplitProviderConfig(reviewerProvider, reviewerInput)
    };
}

async function normalizeImageGenConfig(input = {}, currentConfig = {}) {
    const existing = currentConfig.imageGen || {};
    const baseUrl = normalizeImageGenBaseUrl(input.baseUrl || existing.baseUrl || DEFAULT_IMAGEGEN_BASE_URL);
    const model = typeof input.model === 'string' ? input.model.trim() : existing.model;
    const realtimeProgress = input.realtimeProgress !== undefined
        ? input.realtimeProgress !== false
        : existing.realtimeProgress !== false;
    const enabled = input.enabled !== false;
    if (!enabled) {
        return {
            ...existing,
            baseUrl,
            model,
            realtimeProgress,
            enabled: false
        };
    }

    let resolvedModel = model;

    if (!resolvedModel) {
        const discovery = await listImageGenModels(baseUrl);
        resolvedModel = discovery.models[0];
    }

    if (!resolvedModel) {
        throw new Error('ImageGen model is required. Call list_imagegen_models or provide config.model.');
    }

    return {
        enabled: true,
        baseUrl,
        model: resolvedModel,
        realtimeProgress
    };
}

async function syncBetaFeatureSideEffects(previousBetaTools = [], nextBetaTools = []) {
    const hadMcp = previousBetaTools.includes('mcp_support');
    const hasMcp = nextBetaTools.includes('mcp_support');
    if (hasMcp && !hadMcp) {
        await mcpManager.init();
    } else if (!hasMcp && hadMcp) {
        await mcpManager.cleanup();
    }
}

export async function startApiServer(port = 3000, createProvider, host = '127.0.0.1', noAuth = false, initialConfig = null) {
    if (noAuth) {
        console.log(chalk.bgRed.white.bold(`\n ⚠️ WARNING: --no-auth is DEPRECATED and UNSECURE! `));
        console.log(chalk.yellow(`Your API is completely open. Anyone on your network can execute arbitrary commands on your machine.\n`));
    }

    // Token generation/loading logic
    const CONFIG_DIR = path.join(os.homedir(), '.config', 'banana-code');
    const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');
    let apiToken;

    try {
        const tokenData = await fs.readFile(TOKEN_FILE, 'utf-8');
        apiToken = JSON.parse(tokenData).token;
    } catch (err) {
        if (err.code === 'ENOENT') {
            apiToken = crypto.randomBytes(32).toString('hex');
            await fs.mkdir(CONFIG_DIR, { recursive: true });
            await fs.writeFile(TOKEN_FILE, JSON.stringify({ token: apiToken }, null, 2), 'utf-8');
            console.log(chalk.green.bold(`\n=================================================`));
            console.log(chalk.green.bold(`🔑 FIRST START: API Token Generated!`));
            console.log(chalk.green.bold(`Your API Token is: `) + chalk.cyan.bold(apiToken));
            console.log(chalk.yellow(`Save this token. You must pass it after connecting via WebSocket:`));
            console.log(chalk.yellow(`ws://${host}:${port}`));
            console.log(chalk.yellow(`And send JSON: { "type": "auth", "token": "${apiToken}" }`));
            console.log(chalk.green.bold(`=================================================\n`));
        } else {
            console.error(chalk.red(`Failed to read token file: ${err.message}`));
            process.exit(1);
        }
    }

    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: AUDIO_UPLOAD_LIMIT_BYTES }
    });

    app.use(cors());
    app.use(express.json());

    // Protect HTTP endpoints with the token
    app.use((req, res, next) => {
        if (noAuth) return next();
        const token = req.query.token || req.headers['authorization']?.replace('Bearer ', '');
        if (token !== apiToken) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' });
        }
        next();
    });

    let config = initialConfig || await loadConfig({ includeProjectLocal: true });
    let providerInstance = null;
    let httpVoiceSessionId = null;
    let ultraMemoryInterval = null;
    global.bananaConfig = config;

    const parseVoiceUpload = (req, res, next) => {
        if (req.is('multipart/form-data')) {
            upload.single('file')(req, res, next);
            return;
        }

        express.raw({
            type: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'application/octet-stream'],
            limit: AUDIO_UPLOAD_LIMIT_BYTES
        })(req, res, next);
    };

    async function sendApiChatMessage(text, workspace = process.cwd()) {
        if (!providerInstance) {
            providerInstance = createProviderForConfig(createProvider, config);
        }

        providerInstance.config.isApiMode = true;
        providerInstance.onChunk = null;
        providerInstance.onToolStart = null;
        providerInstance.onToolEnd = null;
        providerInstance.config.onImageGenProgress = null;
        providerInstance.config.onImageGenResult = null;

        const preparedInput = await prepareChatInput(text, [], workspace);
        const providerInput = preparedInput.images.length > 0
            ? { text: preparedInput.text, images: preparedInput.images }
            : preparedInput.text;
        const response = await providerInstance.sendMessage(providerInput);

        if (!httpVoiceSessionId) httpVoiceSessionId = generateSessionId();
        const titleSource = String(text || '').trim() || 'Voice message';
        await saveSession(httpVoiceSessionId, {
            messages: providerInstance.messages,
            provider: config.provider,
            model: config.model,
            title: titleSource.substring(0, 50) + (titleSource.length > 50 ? '...' : '')
        });

        let usage = null;
        if (typeof providerInstance.calculateSessionCost === 'function') {
            usage = providerInstance.calculateSessionCost();
        }

        return { response, usage, sessionId: httpVoiceSessionId };
    }

    const updateUltraMemoryBackground = async (wasEnabled, isEnabled) => {
        if (wasEnabled && !isEnabled && ultraMemoryInterval) {
            clearInterval(ultraMemoryInterval);
            ultraMemoryInterval = null;
        }

        if (isEnabled && !ultraMemoryInterval) {
            const { runUltraMemoryBackground } = await import('./utils/ultraMemory.js');
            ultraMemoryInterval = setInterval(() => runUltraMemoryBackground(config, createProvider), 60000);
            await runUltraMemoryBackground(config, createProvider);
        }
    };

    if (config.useUltraMemory) {
        await updateUltraMemoryBackground(false, true);
    }

    const stopUltraMemoryBackground = () => {
        if (ultraMemoryInterval) {
            clearInterval(ultraMemoryInterval);
            ultraMemoryInterval = null;
        }
    };

    const handleProcessExit = () => {
        stopUltraMemoryBackground();
    };
    process.once('SIGINT', handleProcessExit);
    process.once('SIGTERM', handleProcessExit);
    process.once('beforeExit', handleProcessExit);

    wss.on('close', stopUltraMemoryBackground);
    server.on('close', stopUltraMemoryBackground);

    // WebSocket connection handling
    wss.on('connection', (ws, req) => {
        let isAuthenticated = noAuth;

        console.log(chalk.cyan(`[API] GUI Client connected via WebSocket ${noAuth ? '(UNSECURE - no-auth)' : '(Pending Authentication)'}`));

        const activeTickets = new Set();
        let currentWorkspace = process.cwd();
        let currentSessionId = null;
        const browserBridge = new BrowserBridge(ws);

        const getApiRuntimeConfig = () => ({
            ...config,
            isApiMode: true,
            browserController: browserBridge
        });

        const shouldRecreateProviderForBrowser = () => {
            if (!providerInstance) return false;
            const hadBrowser = providerHasBrowserTools(providerInstance);
            const hasBrowser = browserBridge.available === true
                && config.browserUse?.enabled !== false;
            return hadBrowser !== hasBrowser;
        };

        // Setup session-scoped permission handler for API mode
        const sessionPermissionHandler = (ticketId, actionType, details) => {
            return new Promise((resolve) => {
                const requestPayload = JSON.stringify({
                    type: 'permission_requested',
                    ticketId,
                    action: actionType,
                    details
                });
                
                if (ws.readyState === ws.OPEN) {
                    activeTickets.add(ticketId);
                    ws.send(requestPayload);
                    console.log(chalk.gray(`[API] Sent permission request: ${ticketId}`));
                } else {
                    console.log(chalk.red(`[API] WebSocket closed, denying permission automatically.`));
                    resolve({ allowed: false });
                    return;
                }

                // Temporary listener to catch the GUI's response for this specific ticket
                const responseHandler = (msg) => {
                    try {
                        const data = JSON.parse(msg);
                        if (data.type === 'permission_response' && data.ticketId === ticketId) {
                            console.log(chalk.gray(`[API] Received permission response for ${ticketId}: ${data.allowed}`));
                            activeTickets.delete(ticketId);
                            ws.removeListener('message', responseHandler); // clean up
                            resolve({ allowed: data.allowed, remember: data.session });
                        }
                    } catch (e) {}
                };
                
                ws.on('message', responseHandler);
            });
        };

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'browser_response') {
                    console.log(chalk.gray(`[API] Received message: browser_response ${data.requestId} ok=${data.ok}`));
                } else if (data.type === 'browser_state') {
                    console.log(chalk.gray(`[API] Received message: browser_state`));
                } else {
                    console.log(chalk.gray(`[API] Received message: ${message}`));
                }
                
                if (!isAuthenticated) {
                    if (data.type === 'auth' && data.token === apiToken) {
                        isAuthenticated = true;
                        console.log(chalk.green(`[API] WebSocket client authenticated successfully`));
                        ws.send(JSON.stringify({ type: 'auth_success' }));
                    } else {
                        console.log(chalk.red(`[API] WebSocket authentication failed: Invalid token`));
                        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Invalid token' }));
                        ws.close(1008, 'Unauthorized');
                    }
                    return;
                }

                // Ignore valid permission responses here, they are handled by the specific ticket listeners
                if (data.type === 'permission_response') {
                    if (!activeTickets.has(data.ticketId)) {
                        console.log(chalk.red(`[API] Invalid ticket ID received: ${data.ticketId}`));
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                message: `Permission Denied: Ticket ID '${data.ticketId}' does not match any active requests.` 
                            }));
                        }
                    }
                    return;
                }

                if (data.type === 'browser_bridge_ready') {
                    browserBridge.markReady();
                    if (shouldRecreateProviderForBrowser()) {
                        const previousConfig = providerInstance.config || config;
                        providerInstance = reinitializeProviderPreservingHistory(providerInstance, createProvider, previousConfig, getApiRuntimeConfig());
                        await refreshSystemPrompt(providerInstance, getApiRuntimeConfig());
                    }
                    console.log(chalk.cyan(`[API] Studio browser bridge ready.`));
                    return;
                }

                if (data.type === 'browser_response') {
                    if (!browserBridge.handleResponse(data)) {
                        console.log(chalk.yellow(`[API] Ignored browser response for unknown request: ${data.requestId}`));
                    }
                    return;
                }

                if (data.type === 'browser_state') {
                    browserBridge.updateState(data.state || data);
                    return;
                }

                if (data.type === 'set_workspace') {
                    const newPath = path.resolve(data.path);
                    try {
                        await fs.access(newPath);
                        process.chdir(newPath);
                        currentWorkspace = newPath;
                        console.log(chalk.green(`[API] Workspace changed to: ${newPath}`));
                        ws.send(JSON.stringify({ type: 'workspace_updated', path: newPath }));
                        
                        // Force provider re-init if it exists to pick up new workspace context
                        if (providerInstance) {
                            providerInstance = createProviderForConfig(createProvider, getApiRuntimeConfig());
                        }
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'error', message: `Invalid workspace path: ${err.message}` }));
                    }
                    return;
                }

                if (data.type === 'update_config') {
                    const previousConfig = config;
                    const previousBetaTools = config.betaTools || [];
                    const previousUltraMemory = config.useUltraMemory;

                    config = { ...config, ...data.config };
                    global.bananaConfig = config;

                    if (data.config.betaTools !== undefined) {
                        await syncBetaFeatureSideEffects(previousBetaTools, config.betaTools || []);
                    }

                    if (data.config.useUltraMemory !== undefined && data.config.useUltraMemory && !previousUltraMemory && !config.ultraMemoryEnabledAt) {
                        config.ultraMemoryEnabledAt = new Date().toISOString();
                    }

                    if (providerInstance && shouldReinitializeProvider(data.config)) {
                        providerInstance = reinitializeProviderPreservingHistory(providerInstance, createProvider, previousConfig, getApiRuntimeConfig());
                    } else if (providerInstance) {
                        providerInstance.config = { ...providerInstance.config, ...getApiRuntimeConfig(), ...data.config };
                    }

                    // Always refresh the system prompt to reflect potential style/emoji/mode changes
                    await refreshSystemPrompt(providerInstance, getApiRuntimeConfig());

                    if (data.save) {
                        await saveConfig(config);
                        console.log(chalk.cyan(`[API] Configuration updated and saved to disk.`));
                    } else {
                        console.log(chalk.cyan(`[API] Configuration updated (in-memory only).`));
                    }

                    // Sync global YOLO state if changed
                    if (data.config.yolo !== undefined) {
                        setYoloMode(data.config.yolo);
                        console.log(chalk.bgRed.white.bold(data.config.yolo ? '\n [API] YOLO MODE ENABLED - Auto-accepting all permissions! \n' : '\n [API] YOLO mode disabled.\n'));
                    }

                    if (data.config.useUltraMemory !== undefined) {
                        await updateUltraMemoryBackground(previousUltraMemory, config.useUltraMemory);
                    }

                    ws.send(JSON.stringify({ type: 'config_updated', config }));
                    return;
                }

                if (data.type === 'get_context') {
                    ws.send(JSON.stringify({ type: 'context_info', ...(await buildContextInfo(providerInstance)) }));
                    return;
                }

                if (data.type === 'list_permissions') {
                    ws.send(JSON.stringify({ type: 'permissions_list', permissions: getSessionPermissions() }));
                    return;
                }

                if (data.type === 'list_beta_features') {
                    const enabled = config.betaTools || [];
                    const features = [
                        ...TOOLS.filter(t => t.beta).map(t => ({
                            name: t.name,
                            label: t.label || t.name,
                            description: t.description || '',
                            enabled: enabled.includes(t.name),
                            beta: true
                        })),
                        {
                            name: 'clean_command',
                            label: '/clean command',
                            description: 'Context compression command.',
                            enabled: enabled.includes('clean_command'),
                            beta: true
                        },
                        {
                            name: 'mcp_support',
                            label: 'MCP Support',
                            description: 'Connect external Model Context Protocol servers.',
                            enabled: enabled.includes('mcp_support'),
                            beta: true
                        }
                    ];
                    ws.send(JSON.stringify({ type: 'beta_features', features, enabled }));
                    return;
                }

                if (data.type === 'set_beta_features') {
                    const previousConfig = config;
                    const previousBetaTools = config.betaTools || [];
                    const nextBetaTools = Array.isArray(data.features) ? [...new Set(data.features)] : [];
                    await syncBetaFeatureSideEffects(previousBetaTools, nextBetaTools);
                    config = { ...config, betaTools: nextBetaTools };
                    global.bananaConfig = config;
                    if (providerInstance) {
                        providerInstance = reinitializeProviderPreservingHistory(providerInstance, createProvider, previousConfig, getApiRuntimeConfig());
                        await refreshSystemPrompt(providerInstance, getApiRuntimeConfig());
                    }
                    await saveConfig(config);
                    ws.send(JSON.stringify({ type: 'config_updated', config }));
                    return;
                }

                if (data.type === 'set_banana_split') {
                    const previousConfig = config;
                    config = {
                        ...config,
                        bananaSplit: normalizeBananaSplitConfig(data.config || data.bananaSplit || {}, config)
                    };
                    global.bananaConfig = config;
                    if (providerInstance) {
                        providerInstance = reinitializeProviderPreservingHistory(providerInstance, createProvider, previousConfig, getApiRuntimeConfig());
                        await refreshSystemPrompt(providerInstance, getApiRuntimeConfig());
                    }
                    await saveConfig(config);
                    ws.send(JSON.stringify({ type: 'config_updated', config }));
                    return;
                }

                if (data.type === 'list_imagegen_models') {
                    const baseUrl = normalizeImageGenBaseUrl(data.baseUrl || config.imageGen?.baseUrl || DEFAULT_IMAGEGEN_BASE_URL);
                    try {
                        const discovery = await listImageGenModels(baseUrl);
                        ws.send(JSON.stringify({ type: 'imagegen_models', ...discovery }));
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'error', message: err.message }));
                    }
                    return;
                }

                if (data.type === 'set_imagegen') {
                    const previousConfig = config;
                    config = {
                        ...config,
                        imageGen: await normalizeImageGenConfig(data.config || data.imageGen || {}, config)
                    };
                    global.bananaConfig = config;
                    if (providerInstance) {
                        providerInstance = reinitializeProviderPreservingHistory(providerInstance, createProvider, previousConfig, getApiRuntimeConfig());
                        await refreshSystemPrompt(providerInstance, getApiRuntimeConfig());
                    }
                    await saveConfig(config);
                    ws.send(JSON.stringify({ type: 'config_updated', config }));
                    return;
                }

                if (data.type === 'list_sessions') {
                    const allSessions = await listSessions();
                    // Strip out full messages to keep the list small
                    const sessions = allSessions.map(s => ({
                        uuid: s.uuid,
                        title: s.title,
                        updatedAt: s.updatedAt,
                        provider: s.provider,
                        model: s.model
                    }));
                    ws.send(JSON.stringify({ type: 'sessions_list', sessions }));
                    return;
                }

                if (data.type === 'load_session') {
                    const session = await loadSession(data.sessionId);
                    if (!session) {
                        ws.send(JSON.stringify({ type: 'error', message: `Session ${data.sessionId} not found.` }));
                        return;
                    }

                    // Re-init provider with the session's config and history
                    config.provider = session.provider || config.provider;
                    config.model = session.model || config.model;
                    
                    providerInstance = createProviderForConfig(createProvider, getApiRuntimeConfig());
                    providerInstance.messages = session.messages || [];
                    currentSessionId = data.sessionId;
                    
                    console.log(chalk.cyan(`[API] Loaded session: ${session.title || data.sessionId}`));
                    ws.send(JSON.stringify({ 
                        type: 'session_loaded', 
                        sessionId: data.sessionId,
                        title: session.title,
                        messages: session.messages 
                    }));
                    return;
                }

                if (data.type === 'list_memories') {
                    const { loadMemory } = await import('./utils/memory.js');
                    const memories = await loadMemory();
                    ws.send(JSON.stringify({ type: 'memories_list', memories }));
                    return;
                }

                if (data.type === 'add_memory') {
                    const { addMemory } = await import('./utils/memory.js');
                    const id = await addMemory(data.fact);
                    console.log(chalk.magenta(`[API] Manual memory added: ${id}`));
                    ws.send(JSON.stringify({ type: 'memory_added', id, fact: data.fact }));
                    return;
                }

                if (data.type === 'delete_memory') {
                    const { removeMemory } = await import('./utils/memory.js');
                    const success = await removeMemory(data.id);
                    if (success) {
                        console.log(chalk.magenta(`[API] Manual memory deleted: ${data.id}`));
                        ws.send(JSON.stringify({ type: 'memory_deleted', id: data.id }));
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: `Memory ID ${data.id} not found.` }));
                    }
                    return;
                }

                if (data.type === 'clear_history') {
                    if (providerInstance) {
                        providerInstance.messages = [{ role: 'system', content: providerInstance.systemPrompt }];
                        console.log(chalk.cyan(`[API] Conversation history cleared.`));
                        ws.send(JSON.stringify({ type: 'history_cleared' }));
                    }
                    return;
                }

                if (data.type === 'init') {
                    console.log(chalk.cyan(`[API] Generating project summary for BANANA.md...`));
                    try {
                        const { getWorkspaceTree } = await import('./utils/workspace.js');
                        const tree = await getWorkspaceTree();

                        const initProvider = createProviderForConfig(createProvider, config);
                        initProvider.messages = [];

                        let initPrompt = "SYSTEM: You are a project summarizer. Review the following project file tree and briefly describe what this project is, what technologies it uses, and any obvious conventions. Keep it under 2 paragraphs. Output ONLY the summary text.";
                        initPrompt += `\n\n--- Project Tree ---\n${tree}`;

                        const summary = await initProvider.sendMessage(initPrompt);

                        const fsModule = await import('fs/promises');
                        const pathModule = await import('path');
                        const bananaPath = pathModule.join(process.cwd(), 'BANANA.md');
                        await fsModule.writeFile(bananaPath, summary, 'utf8');

                        console.log(chalk.green(`[API] Successfully created BANANA.md!`));

                        // Re-init current provider so it picks up the new BANANA.md
                        providerInstance = createProviderForConfig(createProvider, getApiRuntimeConfig());
                        
                        ws.send(JSON.stringify({ type: 'init_complete', summary }));
                    } catch (err) {
                        console.log(chalk.red(`[API] Failed to initialize project: ${err.message}`));
                        ws.send(JSON.stringify({ type: 'error', message: `Failed to initialize project: ${err.message}` }));
                    }
                    return;
                }

                if (data.type === 'clean') {
                    if (!providerInstance || !providerInstance.messages || providerInstance.messages.length <= 2) {
                        console.log(chalk.yellow(`[API] Not enough history to summarize.`));
                        ws.send(JSON.stringify({ type: 'error', message: "Not enough history to summarize." }));
                        return;
                    }

                    console.log(chalk.cyan(`[API] Summarizing context to save tokens...`));
                    try {
                        const summaryPrompt = "SYSTEM INSTRUCTION: Please provide a highly concise summary of our entire conversation so far. Focus ONLY on the overall goal, the current state of the project, any important decisions made, and what we were about to do next. Do not include pleasantries. This summary will be used as your memory going forward.";
                        
                        // Prevent sending chunk events back to the GUI for the summary request
                        const originalOnChunk = providerInstance.onChunk;
                        providerInstance.onChunk = null;
                        
                        const summary = await providerInstance.sendMessage(summaryPrompt);
                        
                        // Restore original onChunk
                        providerInstance.onChunk = originalOnChunk;

                        providerInstance.messages = [
                            { role: 'system', content: providerInstance.systemPrompt },
                            { role: 'user', content: `We are resuming a conversation. Here is the summary of what has happened so far:\n\n${summary}\n\nLet's continue from here.` },
                            { role: 'assistant', content: "Understood. I have the context and am ready to proceed." }
                        ];

                        console.log(chalk.green(`[API] History compressed successfully.`));
                        
                        // Save the compressed session to disk
                        if (currentSessionId) {
                            await saveSession(currentSessionId, {
                                messages: providerInstance.messages,
                                provider: config.provider,
                                model: config.model,
                                title: "Compressed Session" // or keep existing
                            });
                        }

                        ws.send(JSON.stringify({ type: 'clean_complete', summary, messages: providerInstance.messages }));
                    } catch (err) {
                        console.error(chalk.red(`[API] Failed to compress history: ${err.message}`));
                        ws.send(JSON.stringify({ type: 'error', message: `Failed to compress history: ${err.message}` }));
                    }
                    return;
                }

                if (data.type === 'trigger_codex_login') {
                    const { spawn } = await import('child_process');
                    console.log(chalk.cyan(`[API] Triggering Codex OAuth login...`));
                    
                    // Use spawn instead of exec to allow the browser to open and the process to persist
                    const loginProcess = spawn('npx', ['-y', '@openai/codex', 'login'], {
                        stdio: 'inherit',
                        detached: true
                    });

                    loginProcess.on('close', (code) => {
                        if (code !== 0) {
                            console.error(chalk.red(`[API] Codex login process exited with code ${code}`));
                            ws.send(JSON.stringify({ type: 'codex_login_finished', success: false, error: `Process exited with code ${code}` }));
                        } else {
                            const authFile = path.join(os.homedir(), '.codex', 'auth.json');
                            // Check if file exists using fs.access
                            fs.access(authFile).then(() => {
                                console.log(chalk.green(`[API] Codex login successful.`));
                                ws.send(JSON.stringify({ type: 'codex_login_finished', success: true }));
                            }).catch(() => {
                                ws.send(JSON.stringify({ type: 'codex_login_finished', success: false, error: 'Auth file not created.' }));
                            });
                        }
                    });
                    
                    ws.send(JSON.stringify({ type: 'codex_login_started', message: 'Please check your terminal to complete the OpenAI login.' }));
                    return;
                }

                if (data.type === 'terminal_input') {
                    const { sendToTerminal } = await import('./tools/terminal.js');
                    console.log(chalk.gray(`[API] Sending terminal input to session: ${data.sessionId}`));
                    const result = await sendToTerminal({ sessionId: data.sessionId, input: data.input });
                    ws.send(JSON.stringify({ type: 'terminal_output', sessionId: data.sessionId, result }));
                    return;
                }
                
                if (data.type === 'chat') {
                    // Set the global handler just before sending a message to ensure it's routed to THIS socket
                    global.apiPermissionHandler = sessionPermissionHandler;
                    const originalUserText = String(data.text || '');
                    let effectiveUserText = originalUserText;
                    let ultrathinkEnabled = false;

                    if (shouldRecreateProviderForBrowser()) {
                        const previousConfig = providerInstance.config || config;
                        providerInstance = reinitializeProviderPreservingHistory(providerInstance, createProvider, previousConfig, getApiRuntimeConfig());
                        await refreshSystemPrompt(providerInstance, getApiRuntimeConfig());
                    }

                    if (!providerInstance) {
                        console.log(chalk.gray(`[API] Creating provider instance...`));
                        providerInstance = createProviderForConfig(createProvider, getApiRuntimeConfig());
                    }

                    const activeProviderConfig = getBananaSplitLocalConfig(getApiRuntimeConfig());
                    const ultrathinkDirective = extractUltrathinkDirective(effectiveUserText);
                    if (ultrathinkDirective.enabled) {
                        effectiveUserText = ultrathinkDirective.text;
                        if (providerSupportsUltrathink(activeProviderConfig)) {
                            ultrathinkEnabled = true;
                        }
                    }

                    // Attach a temporary listener for this specific request
                    providerInstance.config = {
                        ...providerInstance.config,
                        ...getApiRuntimeConfig()
                    };
                    providerInstance.onChunk = (chunk) => {
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'chunk', content: chunk }));
                        }
                    };
                    providerInstance.onToolStart = (tool) => {
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'tool_start', tool }));
                        }
                    };
                    providerInstance.onToolEnd = (result) => {
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'tool_end', result }));
                        }
                    };
                    const generatedImages = [];
                    providerInstance.config.onImageGenProgress = (payload) => {
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'image_generation_progress', ...payload }));
                        }
                    };
                    providerInstance.config.onImageGenResult = (payload) => {
                        if (Array.isArray(payload?.images)) {
                            generatedImages.push(...payload.images);
                        }
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'image_generation_result', ...payload }));
                        }
                    };

                    console.log(chalk.gray(`[API] Sending message to AI...`));
                    const preparedInput = await prepareChatInput(effectiveUserText, data.attachments || [], currentWorkspace, data.browserElements || []);
                    if (preparedInput.dropped.length > 0 && ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'attachments_dropped',
                            attachments: preparedInput.dropped.map(({ rawPath, resolvedPath, reason }) => ({
                                path: rawPath,
                                resolvedPath: resolvedPath || null,
                                reason
                            }))
                        }));
                    }
                    const providerInput = { text: preparedInput.text, images: preparedInput.images, ultrathink: ultrathinkEnabled };
                    const response = await providerInstance.sendMessage(preparedInput.images.length > 0 || ultrathinkEnabled ? providerInput : preparedInput.text);
                    console.log(chalk.gray(`[API] AI response complete.`));
                    
                    // Save the session to disk
                    if (!currentSessionId) currentSessionId = generateSessionId();
                    const titleSource = originalUserText.trim() || (Array.isArray(data.browserElements) && data.browserElements.length > 0 ? 'Browser element edit' : (preparedInput.images.length > 0 ? 'Image attachment' : 'File attachment'));
                    
                    await saveSession(currentSessionId, {
                        messages: providerInstance.messages,
                        provider: config.provider,
                        model: config.model,
                        title: titleSource.substring(0, 50) + (titleSource.length > 50 ? '...' : '')
                    });

                    let financial = null;
                    if (typeof providerInstance.calculateSessionCost === 'function') {
                        financial = providerInstance.calculateSessionCost();
                    }

                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ 
                            type: 'done', 
                            finalResponse: response,
                            usage: financial,
                            generatedImages
                        }));
                    }
                }
            } catch (err) {
                console.error(chalk.red(`[API] Error: ${err.message}`));
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
        });

        ws.on('close', () => {
            browserBridge.closeAll('Studio browser disconnected.');
            console.log(chalk.gray(`[API] GUI Client disconnected`));
        });

    });

    // HTTP Endpoints
    app.get('/api/sessions', async (req, res) => {
        const sessions = await listSessions();
        res.json(sessions);
    });

    app.get('/api/config', (req, res) => {
        res.json(config);
    });

    app.get('/api/docs', async (req, res) => {
        const { getBananaDocs } = await import('./tools/getBananaDocs.js');
        const docs = await getBananaDocs();
        res.json({ docs });
    });

    app.get('/api/status', (req, res) => {
        res.json({ status: 'running', provider: config.provider, model: config.model });
    });

    app.post('/api/voice', parseVoiceUpload, async (req, res) => {
        try {
            const configuredVoice = getVoiceConfig(config);
            const groqApiKey = req.headers['x-groq-api-key']
                || req.body?.groqApiKey
                || req.query.groqApiKey
                || configuredVoice.groqApiKey;
            const model = req.body?.model
                || req.query.model
                || configuredVoice.model
                || 'whisper-large-v3-turbo';

            if (!groqApiKey) {
                res.status(400).json({ error: 'Missing Groq API key. Send x-groq-api-key, groqApiKey, or configure voice.groqApiKey.' });
                return;
            }

            if (!GROQ_WHISPER_MODELS.some(choice => choice.value === model)) {
                res.status(400).json({ error: 'Unsupported Groq Whisper model. Use whisper-large-v3-turbo or whisper-large-v3.' });
                return;
            }

            const fileBuffer = req.file?.buffer || (Buffer.isBuffer(req.body) ? req.body : null);
            if (!fileBuffer || fileBuffer.length === 0) {
                res.status(400).json({ error: 'Missing audio file. Upload multipart field "file" or send a raw .mp3/.wav body.' });
                return;
            }

            const rawMimeType = String(req.headers['content-type'] || '').split(';')[0];
            const defaultFileName = rawMimeType === 'audio/mpeg' || rawMimeType === 'audio/mp3' ? 'voice.mp3' : 'voice.wav';
            const fileName = req.file?.originalname || req.query.filename || defaultFileName;
            const mimeType = req.file?.mimetype || req.headers['content-type'] || mimeTypeFromFileName(fileName);
            const supportedMime = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'application/octet-stream'].includes(String(mimeType).split(';')[0]);
            const supportedName = ['.mp3', '.wav'].includes(path.extname(String(fileName)).toLowerCase());
            if (!supportedMime && !supportedName) {
                res.status(400).json({ error: 'Only .mp3 and .wav audio uploads are supported.' });
                return;
            }

            const transcript = await transcribeWithGroq({
                apiKey: groqApiKey,
                model,
                fileBuffer,
                fileName,
                mimeType
            });

            const prefix = typeof req.body?.text === 'string'
                ? req.body.text
                : (typeof req.query.text === 'string' ? req.query.text : '');
            const messageText = prefix.trim()
                ? `${prefix.trim()}\n\nVoice transcript:\n${transcript}`
                : transcript;
            const chatResult = await sendApiChatMessage(messageText);

            res.json({
                type: 'voice_done',
                transcript,
                finalResponse: chatResult.response,
                usage: chatResult.usage,
                sessionId: chatResult.sessionId
            });
        } catch (err) {
            console.error(chalk.red(`[API] Voice error: ${err.message}`));
            res.status(500).json({ error: err.message });
        }
    });

    server.listen(port, host, () => {
        console.log(chalk.green.bold(`\n🍌 Banana Code API Server running at http://${host}:${port}`));
        console.log(chalk.gray(`WebSocket streaming enabled on the same port.\n`));
    });
}
