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
import { listSessions, loadSession } from './sessions.js';

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
            console.log(chalk.yellow(`Save this token. You must pass it to connect:`));
            console.log(chalk.yellow(`ws://${host}:${port}?token=${apiToken}`));
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
        // Verify token in WebSocket connection URL
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        if (!noAuth && token !== apiToken) {
            console.log(chalk.red(`[API] WebSocket connection rejected: Invalid or missing token`));
            ws.close(1008, 'Unauthorized'); // 1008 Policy Violation
            return;
        }

        console.log(chalk.cyan(`[API] GUI Client connected via WebSocket ${noAuth ? '(UNSECURE - no-auth)' : '(Authenticated)'}`));

        const activeTickets = new Set();
        let currentWorkspace = process.cwd();

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
                    config = { ...config, ...data.config };
                    if (providerInstance) {
                        providerInstance.config = { ...providerInstance.config, ...data.config };
                    }
                    console.log(chalk.cyan(`[API] Configuration updated.`));
                    ws.send(JSON.stringify({ type: 'config_updated', config }));
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
