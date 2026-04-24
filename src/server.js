import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import http from 'http';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { loadConfig } from './config.js';
import { listSessions, loadSession, saveSession, generateSessionId } from './sessions.js';

export async function startApiServer(port = 3000, createProvider, host = '127.0.0.1', noAuth = false) {
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

    let config = await loadConfig();
    let providerInstance = null;

    // WebSocket connection handling
    wss.on('connection', (ws, req) => {
        let isAuthenticated = noAuth;

        console.log(chalk.cyan(`[API] GUI Client connected via WebSocket ${noAuth ? '(UNSECURE - no-auth)' : '(Pending Authentication)'}`));

        const activeTickets = new Set();
        let currentWorkspace = process.cwd();
        let currentSessionId = null;

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
            console.log(chalk.gray(`[API] Received message: ${message}`));
            try {
                const data = JSON.parse(message);
                
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
                            providerInstance = createProvider(config);
                        }
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'error', message: `Invalid workspace path: ${err.message}` }));
                    }
                    return;
                }

                if (data.type === 'update_config') {
                    const oldProvider = config.provider;
                    const oldModel = config.model;

                    config = { ...config, ...data.config };
                    
                    // If provider or model changed, force re-initialization of the provider instance
                    if (providerInstance && (data.config.provider || data.config.model)) {
                        const savedMessages = providerInstance.messages;
                        providerInstance = createProvider(config);
                        providerInstance.messages = savedMessages;
                    } else if (providerInstance) {
                        providerInstance.config = { ...providerInstance.config, ...data.config };
                    }

                    // Always refresh the system prompt to reflect potential style/emoji/mode changes
                    if (providerInstance && typeof providerInstance.updateSystemPrompt === 'function') {
                        const { getSystemPrompt } = await import('./prompt.js');
                        const newSysPrompt = getSystemPrompt(config);
                        providerInstance.updateSystemPrompt(newSysPrompt);
                    }

                    if (data.save) {
                        const { saveConfig } = await import('./config.js');
                        await saveConfig(config);
                        console.log(chalk.cyan(`[API] Configuration updated and saved to disk.`));
                    } else {
                        console.log(chalk.cyan(`[API] Configuration updated (in-memory only).`));
                    }

                    // Sync global YOLO state if changed
                    if (data.config.yolo !== undefined) {
                        const { setYoloMode } = await import('./permissions.js');
                        setYoloMode(data.config.yolo);
                        console.log(chalk.bgRed.white.bold(data.config.yolo ? '\n [API] YOLO MODE ENABLED - Auto-accepting all permissions! \n' : '\n [API] YOLO mode disabled.\n'));
                    }

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
                    
                    providerInstance = createProvider(config);
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

                        const initProvider = createProvider(config);
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
                        providerInstance = createProvider(config);
                        
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

                    if (!providerInstance) {
                        console.log(chalk.gray(`[API] Creating provider instance...`));
                        providerInstance = createProvider(config);
                    }

                    // Attach a temporary listener for this specific request
                    providerInstance.config.isApiMode = true;
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

                    console.log(chalk.gray(`[API] Sending message to AI...`));
                    const response = await providerInstance.sendMessage(data.text);
                    console.log(chalk.gray(`[API] AI response complete.`));
                    
                    // Save the session to disk
                    if (!currentSessionId) currentSessionId = generateSessionId();
                    
                    await saveSession(currentSessionId, {
                        messages: providerInstance.messages,
                        provider: config.provider,
                        model: config.model,
                        title: data.text.substring(0, 50) + (data.text.length > 50 ? '...' : '')
                    });

                    let financial = null;
                    if (typeof providerInstance.calculateSessionCost === 'function') {
                        financial = providerInstance.calculateSessionCost();
                    }

                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ 
                            type: 'done', 
                            finalResponse: response,
                            usage: financial 
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

    server.listen(port, host, () => {
        console.log(chalk.green.bold(`\n🍌 Banana Code API Server running at http://${host}:${port}`));
        console.log(chalk.gray(`WebSocket streaming enabled on the same port.\n`));
    });
}
