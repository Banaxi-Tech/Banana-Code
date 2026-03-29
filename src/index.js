import readline from 'readline';
import chalk from 'chalk';
import { loadConfig, saveConfig, setupProvider } from './config.js';
import { runStartup } from './startup.js';
import { getSessionPermissions } from './permissions.js';

import { GeminiProvider } from './providers/gemini.js';
import { ClaudeProvider } from './providers/claude.js';
import { OpenAIProvider } from './providers/openai.js';
import { OllamaProvider } from './providers/ollama.js';
import { OllamaCloudProvider } from './providers/ollamaCloud.js';

import { loadSession, saveSession, generateSessionId, getLatestSessionId, listSessions } from './sessions.js';
import { printMarkdown } from './utils/markdown.js';

let config;
let providerInstance;
let currentSessionId;
const commandHistory = [];
let historyIndex = -1;
let currentInputSaved = '';

function createProvider(overrideConfig = null) {
    const activeConfig = overrideConfig || config;
    switch (activeConfig.provider) {
        case 'gemini': return new GeminiProvider(activeConfig);
        case 'claude': return new ClaudeProvider(activeConfig);
        case 'openai': return new OpenAIProvider(activeConfig);
        case 'ollama_cloud': return new OllamaCloudProvider(activeConfig);
        case 'ollama': return new OllamaProvider(activeConfig);
        default:
            console.log(chalk.red(`Unknown provider: ${activeConfig.provider}. Defaulting to Ollama.`));
            activeConfig.provider = 'ollama';
            return new OllamaProvider(activeConfig);
    }
}

async function handleSlashCommand(command) {
    const [cmd, ...args] = command.split(' ');

    switch (cmd) {
        case '/provider':
            let newProv = args[0];
            if (!newProv) {
                const { select } = await import('@inquirer/prompts');
                newProv = await select({
                    message: 'Select an AI provider:',
                    choices: [
                        { name: 'Google Gemini', value: 'gemini' },
                        { name: 'Anthropic Claude', value: 'claude' },
                        { name: 'OpenAI', value: 'openai' },
                        { name: 'Ollama Cloud', value: 'ollama_cloud' },
                        { name: 'Ollama (Local)', value: 'ollama' }
                    ]
                });
            }

            if (['gemini', 'claude', 'openai', 'ollama_cloud', 'ollama'].includes(newProv)) {
                // Use the shared setup logic to get keys/models
                config = await setupProvider(newProv, config);
                await saveConfig(config);
                providerInstance = createProvider();
                console.log(chalk.green(`Switched provider to ${newProv} (${config.model}).`));
            } else {
                console.log(chalk.yellow(`Usage: /provider <gemini|claude|openai|ollama>`));
            }
            break;
        case '/model':
            let newModel = args[0];
            if (!newModel) {
                // Interactive selection
                const { select } = await import('@inquirer/prompts');
                const { GEMINI_MODELS, CLAUDE_MODELS, OPENAI_MODELS, CODEX_MODELS, OLLAMA_CLOUD_MODELS } = await import('./constants.js');

                let choices = [];
                if (config.provider === 'gemini') choices = GEMINI_MODELS;
                else if (config.provider === 'claude') choices = CLAUDE_MODELS;
                else if (config.provider === 'openai') {
                    choices = config.authType === 'oauth' ? CODEX_MODELS : OPENAI_MODELS;
                } else if (config.provider === 'ollama_cloud') {
                    choices = OLLAMA_CLOUD_MODELS;
                } else if (config.provider === 'ollama') {
                    try {
                        const response = await fetch('http://localhost:11434/api/tags');
                        const data = await response.json();
                        choices = data.models.map(m => ({ name: m.name, value: m.name }));
                    } catch (e) {
                        console.log(chalk.red("Could not connect to Ollama."));
                        return;
                    }
                }

                if (choices.length > 0) {
                    const finalChoices = [...choices];
                    if (config.provider === 'ollama_cloud') {
                        finalChoices.push({ name: chalk.magenta('✎ Enter custom model ID...'), value: 'CUSTOM_ID' });
                    }
                    
                    newModel = await select({
                        message: 'Select a model:',
                        choices: finalChoices,
                        loop: false,
                        pageSize: Math.max(finalChoices.length, 15)
                    });

                    if (newModel === 'CUSTOM_ID') {
                        const { input } = await import('@inquirer/prompts');
                        newModel = await input({
                            message: 'Enter the exact model ID (e.g., gemma3:27b-cloud):',
                            validate: (v) => v.trim().length > 0 || 'Model ID cannot be empty'
                        });
                    }
                }
            }

            if (newModel) {
                config.model = newModel;
                await saveConfig(config);
                if (providerInstance) {
                    providerInstance.modelName = newModel;
                } else {
                    providerInstance = createProvider();
                }
                console.log(chalk.green(`Switched model to ${newModel}.`));
            } else {
                console.log(chalk.yellow(`Usage: /model <model_name> (or just /model for selection)`));
            }
            break;
        case '/clear':
            providerInstance = createProvider(); // fresh instance = clear history
            console.log(chalk.green('Chat history cleared.'));
            break;
        case '/context':
            let length = 0;
            if (providerInstance.messages) length = providerInstance.messages.length;
            else if (providerInstance.chat) length = (await providerInstance.chat.getHistory()).length;
            console.log(chalk.cyan(`Current context contains approximately ${length} messages.`));
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

            if (betaTools.length === 0) {
                console.log(chalk.yellow("No beta tools available."));
                break;
            }

            const enabledBetaTools = await checkbox({
                message: 'Select beta tools to activate (Space to toggle, Enter to confirm):',
                choices: betaTools.map(t => ({
                    name: t.label || t.name,
                    value: t.name,
                    checked: (config.betaTools || []).includes(t.name)
                }))
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

            config.betaTools = enabledBetaTools;
            await saveConfig(config);
            providerInstance = createProvider(); // Re-init to update tools
            console.log(chalk.green(`Beta tools updated: ${enabledBetaTools.join(', ') || 'none'}`));
            break;
        case '/settings':
            const { checkbox: settingsCheckbox } = await import('@inquirer/prompts');
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
                    }
                ]
            });
            
            config.autoFeedWorkspace = enabledSettings.includes('autoFeedWorkspace');
            config.useMarkedTerminal = enabledSettings.includes('useMarkedTerminal');
            await saveConfig(config);
            providerInstance = createProvider(); // Re-init to update tools/config
            console.log(chalk.green(`Settings updated.`));
            break;
        case '/debug':
            config.debug = !config.debug;
            await saveConfig(config);
            providerInstance = createProvider(); // Re-init to pass debug flag
            console.log(chalk.magenta(`Debug mode ${config.debug ? 'enabled' : 'disabled'}.`));
            break;
        case '/chats':
            const sessions = await listSessions();
            if (sessions.length === 0) {
                console.log(chalk.yellow("No saved chat sessions found."));
            } else {
                console.log(chalk.cyan.bold("\nRecent Chat Sessions:"));
                sessions.forEach((s, i) => {
                    const active = s.uuid === currentSessionId ? chalk.green(' (active)') : '';
                    console.log(chalk.gray(`${i + 1}. [${s.updatedAt}] ${s.uuid.slice(0, 8)}... (${s.provider}/${s.model})${active}`));
                });
                console.log(chalk.gray("\nTo resume a chat, restart with: banana --resume <uuid>\n"));
            }
            break;
        case '/help':
            console.log(chalk.yellow(`
Available commands:
  /provider <name> - Switch AI provider (gemini, claude, openai, ollama)
  /model [name]    - Switch model within current provider (opens menu if name omitted)
  /chats           - List persistent chat sessions
  /clear           - Clear chat history
  /context         - Show current context window size
  /permissions     - List session-approved permissions
  /beta            - Manage beta features and tools
  /settings        - Manage app settings (workspace auto-feed, etc)
  /debug           - Toggle debug mode (show tool results)
  /help            - Show all commands
  /exit            - Quit Banana Code
`));
            break;
        case '/exit':
            console.log(chalk.yellow(`\nTo resume this session: node bin/banana.js --resume ${currentSessionId}`));
            console.log(chalk.yellow("🍌 Bye BananaCode. See ya!"));
            process.exit(0);
            break;
        default:
            console.log(chalk.red(`Unknown command: ${cmd}. Type /help for a list of commands.`));
    }
}

let exitRequested = false;
const REPROMPT_SIGNAL = Symbol('REPROMPT');

// Background colors for the chat UI
const userBg = chalk.bgRgb(30, 30, 46);       // Dark charcoal for user messages
const aiBg = chalk.bgRgb(42, 42, 62);         // Slightly lighter for AI responses

function getTermWidth() {
    return process.stdout.columns || 80;
}

function padLine(text, width) {
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI for length
    const pad = Math.max(0, width - stripped.length);
    return text + ' '.repeat(pad);
}

let lastPromptRows = 1;

function drawPromptBox(inputText, cursorPos) {
    const width = getTermWidth();
    const placeholder = 'Type your message or @path/to/file';
    const prefix = ' > ';

    const visibleText = (inputText.length === 0) ? (prefix + chalk.gray(placeholder)) : (prefix + inputText);
    const totalChars = (prefix.length + Math.max(inputText.length, placeholder.length));
    const rows = Math.ceil(totalChars / width) || 1;

    // Move back to the start of the prompt block
    if (lastPromptRows > 1) {
        process.stdout.write(`\x1b[${lastPromptRows - 1}A`);
    }
    process.stdout.write(`\x1b[1G`);

    // Draw each row with background
    for (let i = 0; i < rows; i++) {
        const start = i * width;
        const lineText = visibleText.substring(start, start + width);
        process.stdout.write(userBg(padLine(lineText, width)) + '\n');
    }

    // Redraw status bar and separator (they are always below the prompt)
    const modelDisplay = providerInstance ? providerInstance.modelName : (config.model || 'unknown');
    const providerDisplay = config.provider.toUpperCase();
    const leftText = ` Provider: ${chalk.cyan(providerDisplay)} / Model: ${chalk.yellow(modelDisplay)}`;
    const rightText = '? for shortcuts ';
    const leftStripped = leftText.replace(/\x1b\[[0-9;]*m/g, '');
    const midPad = Math.max(0, width - leftStripped.length - rightText.length);
    const statusLine = chalk.gray(leftText + ' '.repeat(midPad) + rightText);
    const separator = chalk.gray('─'.repeat(width));

    process.stdout.write(statusLine + '\n');
    process.stdout.write(separator);

    lastPromptRows = rows;

    // Position cursor: find row and col
    const cursorIndex = prefix.length + cursorPos;
    const targetRow = Math.floor(cursorIndex / width);
    const targetCol = (cursorIndex % width) + 1;

    // Move cursor back up (2 for status/sep + N-1-targetRow for prompt rows)
    const moveUp = (rows - 1 - targetRow) + 2;
    process.stdout.write(`\x1b[${moveUp}A\x1b[${targetCol}G`);
}

function drawPromptBoxInitial(inputText) {
    const width = getTermWidth();
    const placeholder = 'Type your message or @path/to/file';
    const prefix = ' > ';

    const visibleText = (inputText.length === 0) ? (prefix + chalk.gray(placeholder)) : (prefix + inputText);
    const totalChars = (prefix.length + Math.max(inputText.length, placeholder.length));
    const rows = Math.ceil(totalChars / width) || 1;

    lastPromptRows = rows;

    // Draw initial wrapped lines
    for (let i = 0; i < rows; i++) {
        const start = i * width;
        const lineText = visibleText.substring(start, start + width);
        process.stdout.write(userBg(padLine(lineText, width)) + '\n');
    }

    // Status bar: Current Provider / Model + right-aligned "? for shortcuts"
    const modelDisplay = providerInstance ? providerInstance.modelName : (config.model || 'unknown');
    const providerDisplay = config.provider.toUpperCase();
    const leftText = ` Provider: ${chalk.cyan(providerDisplay)} / Model: ${chalk.yellow(modelDisplay)}`;
    const rightText = '? for shortcuts ';

    const leftStripped = leftText.replace(/\x1b\[[0-9;]*m/g, '');
    const midPad = Math.max(0, width - leftStripped.length - rightText.length);
    const statusLine = chalk.gray(leftText + ' '.repeat(midPad) + rightText);
    const separator = chalk.gray('─'.repeat(width));

    process.stdout.write(statusLine + '\n');
    process.stdout.write(separator);

    // Move cursor back up to content line (up 2 for status/sep + N-1 for wrapping)
    const cursorIndex = prefix.length + (inputText.length || 0);
    const targetRow = Math.floor(cursorIndex / width);
    const moveUp = (rows - 1 - targetRow) + 2;
    const targetCol = (cursorIndex % width) + 1;

    process.stdout.write(`\x1b[${moveUp}A\x1b[${targetCol}G`);
}

function promptUser() {
    return new Promise((resolve) => {
        let inputBuffer = '';
        let cursorPos = 0;
        let resolveCalled = false;
        let onData; // Declare early so resolve closure can reference it

        const originalResolve = resolve;
        resolve = (val) => {
            resolveCalled = true;
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            if (onData) process.stdin.removeListener('data', onData);

            // Move cursor past the prompt lines + status + separator, clear them
            // We are currently on some row of the prompt.
            const width = getTermWidth();
            const cursorIndex = ("> ".length + 1) + cursorPos; // Approx
            const currentRow = Math.floor(cursorIndex / width);
            const moveDown = (lastPromptRows - 1 - currentRow) + 1;

            process.stdout.write(`\x1b[${moveDown}B`); // move to status line
            for (let i = 0; i < 2; i++) { // clear status and separator
                process.stdout.write(`\x1b[2K\x1b[1B`);
            }
            process.stdout.write(`\x1b[1G\n`);   // beginning of line + newline
            originalResolve(val);
        };

        const handleExit = () => {
            if (!exitRequested) {
                exitRequested = true;
                const moveDown = lastPromptRows + 1; // rough guess
                process.stdout.write(`\x1b[${moveDown}B\x1b[2K\x1b[1B\x1b[2K\x1b[1G\n`);
                process.stdout.write(chalk.yellow('(Press CTRL+C or CTRL+D again to exit)\n'));
                resolve(REPROMPT_SIGNAL);
            } else {
                const moveDown = lastPromptRows + 1;
                process.stdout.write(`\x1b[${moveDown}B\x1b[2K\x1b[1B\x1b[2K\x1b[1G\n`);
                console.log(chalk.yellow(`\nTo resume this session: node bin/banana.js --resume ${currentSessionId}`));
                console.log(chalk.yellow("🍌 Bye BananaCode. See ya!"));
                process.exit(0);
            }
        };

        drawPromptBoxInitial('');

        if (!process.stdin.isTTY) {
            const rl = readline.createInterface({ input: process.stdin });
            rl.on('line', (line) => { resolve(line); rl.close(); });
            rl.on('close', () => { if (!resolveCalled) resolve(REPROMPT_SIGNAL); });
            return;
        }

        process.stdin.setRawMode(true);
        process.stdin.resume();

        onData = (key) => {
            const str = key.toString();

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
                    drawPromptBox(inputBuffer, cursorPos);
                }
                return;
            }

            if (str === '\x1b[3~') {                            // Delete
                exitRequested = false;
                if (cursorPos < inputBuffer.length) {
                    inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
                    drawPromptBox(inputBuffer, cursorPos);
                }
                return;
            }

            if (str === '\x1b[D') {                             // Arrow Left
                if (cursorPos > 0) { cursorPos--; drawPromptBox(inputBuffer, cursorPos); }
                return;
            }

            if (str === '\x1b[C') {                             // Arrow Right
                if (cursorPos < inputBuffer.length) { cursorPos++; drawPromptBox(inputBuffer, cursorPos); }
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
                    drawPromptBox(inputBuffer, cursorPos);
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
                    drawPromptBox(inputBuffer, cursorPos);
                }
                return;
            }

            if (str === '\x1b[H' || str === '\x01') {           // Home / Ctrl+A
                cursorPos = 0; drawPromptBox(inputBuffer, cursorPos);
                return;
            }

            if (str === '\x1b[F' || str === '\x05') {           // End / Ctrl+E
                cursorPos = inputBuffer.length; drawPromptBox(inputBuffer, cursorPos);
                return;
            }

            if (str.startsWith('\x1b')) return;                 // Ignore other escapes

            // Regular character
            exitRequested = false;
            inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
            cursorPos += str.length;
            drawPromptBox(inputBuffer, cursorPos);
        };

        process.stdin.on('data', onData);
    });
}

async function main() {
    try {
        config = await loadConfig();
        await runStartup();

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
                    config.provider = session.provider;
                    config.model = session.model;
                    providerInstance = createProvider();
                    if (providerInstance.messages !== undefined) {
                        providerInstance.messages = session.messages;
                    }
                    console.log(chalk.green(`Resumed session: ${currentSessionId} (${session.provider}/${session.model})\n`));

                    // Playback history
                    for (const msg of session.messages) {
                        if (msg.role === 'system') continue;

                        if (config.provider === 'gemini') {
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
                        } else if (config.provider === 'claude') {
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
                            // OpenAI, Ollama
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


        while (true) {
            const inputLine = await promptUser();

            if (inputLine === REPROMPT_SIGNAL) continue;

            const trimmed = inputLine.trim();

            if (!trimmed) continue;

            if (trimmed.startsWith('/')) {
                await handleSlashCommand(trimmed);
            } else {
                let finalInput = trimmed;
                const fileMentions = trimmed.match(/@@?([\w/.-]+)/g);
                if (fileMentions) {
                    let addedFiles = 0;
                    const fsSync = await import('fs');
                    const path = await import('path');
                    for (const mention of fileMentions) {
                        let filepath;
                        if (mention.startsWith('@@')) {
                            filepath = mention.substring(2);
                        } else {
                            filepath = path.join(process.cwd(), mention.substring(1));
                        }
                        
                        try {
                            const stat = fsSync.statSync(filepath);
                            if (stat.isFile()) {
                                const content = fsSync.readFileSync(filepath, 'utf8');
                                finalInput += `\n\n--- File Context: ${filepath} ---\n${content}\n--- End of ${filepath} ---`;
                                addedFiles++;
                            }
                        } catch (e) {
                            console.log(chalk.yellow(`Warning: Could not read file for mention ${mention}`));
                        }
                    }
                    if (addedFiles > 0) {
                        console.log(chalk.gray(`(Attached ${addedFiles} file(s) to context)`));
                    }
                }

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

                process.stdout.write(chalk.cyan('✦ '));
                await providerInstance.sendMessage(finalInput);
                console.log(); // Extra newline after AI response
                // Save session after AI message
                await saveSession(currentSessionId, {
                    provider: config.provider,
                    model: config.model || providerInstance.modelName,
                    messages: providerInstance.messages
                });
            }
        }
    } catch (error) {
        console.error(chalk.red(`Fatal error: ${error.message}`));
        process.exit(1);
    }
}

main();

process.on('uncaughtException', (err) => {
    console.error(chalk.red('Uncaught Exception:'), err);
});
process.on('unhandledRejection', (reason) => {
    console.error(chalk.red('Unhandled Rejection:'), reason);
});
