// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import chalk from 'chalk';

const MCP_CONFIG_FILE = path.join(os.homedir(), '.config', 'banana-code', 'mcp.json');

class MCPManager {
    constructor() {
        this.clients = new Map();
        this.tools = [];
        this._opQueue = Promise.resolve();
    }

    _enqueue(operation) {
        const next = this._opQueue.then(() => operation()).catch(err => {
            console.log(chalk.red(`MCP operation failed: ${err.message}`));
        });
        this._opQueue = next;
        return next;
    }

    async init() {
        return this._enqueue(() => this._initInternal());
    }

    async cleanup() {
        return this._enqueue(() => this._cleanupInternal());
    }

    async _initInternal() {
        await this._cleanupInternal();

        try {
            const configData = await fs.readFile(MCP_CONFIG_FILE, 'utf-8');
            const config = JSON.parse(configData);
            
            if (!config.mcpServers) return;

            console.log(chalk.cyan("\nInitializing MCP Servers..."));

            for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
                try {
                    const transport = new StdioClientTransport({
                        command: serverConfig.command,
                        args: serverConfig.args || [],
                        env: { ...process.env, ...serverConfig.env }
                    });

                    const client = new Client(
                        { name: "banana-code-client", version: "1.0.0" },
                        { capabilities: { tools: {} } }
                    );

                    await client.connect(transport);
                    this.clients.set(serverName, client);

                    const response = await client.listTools();
                    
                    // Map MCP tools to our internal format
                    const mappedTools = response.tools.map(tool => ({
                        ...tool,
                        serverName, // Track which server this belongs to
                        isMcp: true
                    }));

                    this.tools.push(...mappedTools);
                    console.log(chalk.green(`  ✔ Connected to ${serverName} (${response.tools.length} tools discovered)`));
                } catch (err) {
                    console.log(chalk.red(`  ✘ Failed to connect to ${serverName}: ${err.message}`));
                }
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.log(chalk.red(`Error loading MCP config: ${err.message}`));
            } else {
                // Create default empty config if not found
                await fs.writeFile(MCP_CONFIG_FILE, JSON.stringify({ mcpServers: {} }, null, 2));
            }
        }
    }

    getTools() {
        return this.tools;
    }

    async callTool(name, args) {
        // Find which server has this tool
        const tool = this.tools.find(t => t.name === name);
        if (!tool) throw new Error(`MCP Tool ${name} not found`);

        const client = this.clients.get(tool.serverName);
        if (!client) throw new Error(`MCP Client for ${tool.serverName} not found`);

        const result = await client.callTool({
            name: name,
            arguments: args
        });

        // MCP returns content array, we usually want the text from the first item
        return result.content.map(c => c.text).join('\n');
    }

    async _cleanupInternal() {
        for (const [name, client] of this.clients) {
            try {
                await client.close();
            } catch (e) {}
        }
        this.clients.clear();
        this.tools = [];
    }
}

export const mcpManager = new MCPManager();
