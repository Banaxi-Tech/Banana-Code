import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import http from 'http';
import chalk from 'chalk';
import { loadConfig } from './config.js';
import { listSessions, loadSession } from './sessions.js';

export async function startApiServer(port = 3000, createProvider) {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(cors());
    app.use(express.json());

    let config = await loadConfig();
    let providerInstance = null;

    // WebSocket connection handling
    wss.on('connection', (ws) => {
        console.log(chalk.cyan(`[API] GUI Client connected via WebSocket`));

        const activeTickets = new Set();

        // Setup global permission handler for API mode
        global.apiPermissionHandler = (ticketId, actionType, details) => {
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
                const responseHandler = (message) => {
                    try {
                        const data = JSON.parse(message);
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
                
                if (data.type === 'chat') {
                    if (!providerInstance) {
                        console.log(chalk.gray(`[API] Creating provider instance...`));
                        providerInstance = createProvider(config);
                    }

                    // Attach a temporary listener for this specific request
                    // We modify the provider config locally for this mode
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
                    
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ type: 'done', finalResponse: response }));
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

    app.get('/api/status', (req, res) => {
        res.json({ status: 'running', provider: config.provider, model: config.model });
    });

    server.listen(port, () => {
        console.log(chalk.green.bold(`\n🍌 Banana Code API Server running at http://localhost:${port}`));
        console.log(chalk.gray(`WebSocket streaming enabled on the same port.\n`));
    });
}
