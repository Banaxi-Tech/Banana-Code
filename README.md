# 🍌 Banana Code

> Create any app you want with AI

Banana Code is a high-performance, terminal-based AI pair programmer. It combines the power of multiple state-of-the-art LLMs with a rich, interactive TUI and a robust tool-calling system to help you write, debug, and explore code without leaving your terminal.

```text
                                                       #%%S#
                                                      ?;+*??%
                                                    #*;;;+%?#
                                                  #?;:;+?S
                                            #S%%?+;::;%
                                         #?+::,,::;;*#
                                       #*;::::,,,::*
                                      %;;;::::,,,::#
                                     ?;;;;::::::::*
                                    ?;;;;;::::::::#
                                   S;;;;;::::::::?
                                   *;;;;;:::::::;
                                  S;+;;;;:::::::?
                                  ?;;;;;::::::::#
                                  *;;;;;:::::::;
                                  +;;;;;:::::::;
                                  *;;;;;:::::::;
                                  ?;;;;;;:::::::#
                                  S;+;;;;::::::,?
                                   +;;;;;;::::::;
                                   ?;+;;;;::::::,*
                                    +;;;;;;:::::::%
                                    S;;;;;;::::::::%
                                     %;;;;;;::::::::%
                                      %;;;;;;;::::::,*
                                       %;;;;;;;::::::,;S
                                        #+;;;;;;::::::::+#
                                          ?;;;;;;;::::::,:*#
                                           S*;;;;;;;:::::::;%
               #                             %;;;;;;;;:::::::*
                                              #%*;;;;;;;::::::+#
                         #S#      ##             S*+;;;;::::;;;+
                                                   #S%*+;;;;;;*S
                                             #S#SSSSSS%%%?%%%%S
```

## 🤔 Why Banana Code?
While tools like Cursor provide great GUI experiences, Banana Code is built for developers who live in the terminal and want maximum flexibility. 
- **No Vendor Lock-in**: Switch instantly between the best proprietary models (Gemini, Claude, OpenAI) and high-performance open-source models (Ollama Local, Ollama Cloud) mid-conversation.
- **True Autonomy**: With Plan & Execute mode and Self-Healing Error Loops, Banana Code doesn't just suggest code; it tries, fails, reads the errors, and fixes its own mistakes automatically.
- **Terminal Native**: It brings the power of full workspace awareness, web search, and surgical file patching directly to your CLI without forcing you to change your IDE.

## ✨ Key Features

- **Multi-Provider Support**: Switch between **Google Gemini**, **Anthropic Claude**, **OpenAI**, **Mistral AI**, **Ollama Cloud**, and **Ollama (Local)** effortlessly.
- **Model Context Protocol (MCP)**: Connect Banana Code to any community-built MCP server (like SQLite, GitHub, Google Maps) to give your AI infinite new superpowers via `/beta`.
- **Plan & Agent Modes**: Use `/agent` for instant execution, or `/plan` to make the AI draft a step-by-step implementation plan for your approval before it touches any code.
- **Hierarchical Sub-Agents**: The main AI can spawn specialized "sub-agents" (Researchers, Coders, Reviewers) to handle complex tasks without polluting your main chat history.
- **Self-Healing Loop**: If the AI runs a command (like running tests) and it fails, Banana Code automatically feeds the error trace back to the AI so it can fix its own code.
- **Agent Skills**: Teach your AI specialized workflows. Drop a `SKILL.md` file in your config folder, and the AI will automatically activate it when relevant.
- **Smart Context & Pruning**: Use `@file/path.js` to instantly inject file contents, auto-feed your workspace, and use `/clean` to instantly compress long chat histories to save tokens.
- **Web Research**: Deep integration with DuckDuckGo APIs and Scrapers to give the AI real-time access to the internet.
- **Persistent Sessions**: All chats are auto-titled and saved. Use `/chats` for a fully interactive menu to resume any past session.
- **Syntax Highlighting**: Beautiful, readable markdown output with syntax coloring directly in your terminal.

## 🚀 Installation

Install Banana Code globally via npm using the scoped package name:

```bash
npm install -g @banaxi/banana-code
```

> **⚠️ Important Notice:** Please ensure you install `@banaxi/banana-code`. The unscoped `banana-code` package on npm is NOT affiliated with this project.

## 🛠️ Setup

On your first run, Banana Code will walk you through a quick setup to configure your preferred AI providers:

```bash
banana
```

You'll need your API keys handy for Gemini, Claude, or OpenAI (if not using the OAuth sign-in).

## 📖 Usage

### Start a New Session
```bash
banana
```

### Resume a Session
To continue where you left off, use the `--resume` flag with your session UUID:
```bash
banana --resume <uuid>
```

### In-App Commands
While in a chat, use these special commands:
- `/provider`: Switch AI provider (gemini, claude, openai, mistral, ollama_cloud, ollama).
- `/model`: Switch the active AI model on the fly.
- `/chats`: Open an interactive menu to view and resume past auto-titled chat sessions.
- `/clean`: Compress your current chat history into a dense summary to save tokens.
- `/memory`: Manage your global AI memories (facts the AI remembers across all projects).
- `/init`: Analyze the current project and generate a `BANANA.md` summary for instant context.
- `/context`: View your current message count and estimated token usage.
- `/settings`: Toggle UI features like syntax highlighting and auto-workspace feeding.
- `/plan` & `/agent`: Toggle between Plan & Execute mode and standard Agent mode.
- `/beta`: Enable experimental features like MCP Support and Sub-Agents.
- `/clear`: Clear the current chat history.
- `/exit` or `CTRL+D`: Save and exit the session.

### Available Tools
Banana Code can assist you by:
- **`execute_command`**: Running shell commands (git, npm, ls, etc.).
- **`read_file`**: Reading local source code.
- **`write_file`**: Creating or editing files.
- **`fetch_url`**: Browsing web documentation.
- **`search_files`**: Performing regex searches across your project.
- **`list_directory`**: Exploring folder structures.

### 🧠 Agent Skills
Banana Code supports custom Agent Skills. Skills are like "onboarding guides" that teach the AI how to do specific tasks, use certain APIs, or follow your company's coding standards. 

When the AI detects a task that matches a skill's description, it automatically activates the skill and loads its specialized instructions.

**How to create a Skill:**
1. Create a folder in your config directory: `~/.config/banana-code/skills/my-react-skill/`
2. Create a `SKILL.md` file inside that folder using this exact format:

```markdown
---
name: my-react-skill
description: Use this skill whenever you are asked to build or edit a React component.
---

# React Guidelines
- Always use functional components.
- Always use Tailwind CSS for styling.
- Do not use default exports.
```
3. Type `/skills` in Banana Code to verify it loaded. The AI will now follow these rules automatically!

### 🔌 Model Context Protocol (MCP) Support
Banana Code supports the open standard [Model Context Protocol](https://modelcontextprotocol.io/), allowing you to plug in community-built servers to give your AI access to your databases, GitHub, Slack, Google Maps, and more.

1. Enable **MCP Support** in the `/beta` menu.
2. Create a configuration file at `~/.config/banana-code/mcp.json`.
3. Add your servers. For example, to add the "fetch" and "math" tools using the test server:

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

Restart Banana Code, and the AI will instantly know how to use these new tools natively!

### 🧠 Global AI Memory
Banana Code features a persistent "brain" that remembers your preferences across every project you work on.

1. Enable **Enable Global AI Memory** in the `/settings` menu.
2. Tell the AI facts about yourself or your coding style (e.g., "My name is Max" or "I prefer using Python for data scripts").
3. Use the `/memory` command to view, manually add, or delete saved facts.
4. The AI will now automatically adhere to these preferences in every future session!

### 🍌 Project Initialization (`/init`)
Stop repeating yourself! When you start working in a new folder, type `/init`. 

Banana Code will analyze your entire project structure and generate a **`BANANA.md`** file. This file acts as a high-level architectural summary. Every time you start `banana` in that folder, the AI silently reads this file, giving it instant context about your project's goals and technologies from the very first message.

## 📡 Headless API Mode (`--api`)
Banana Code can be run as a background engine, exposing its powerful tool-calling and provider-switching logic via a local HTTP and WebSocket server. This allows you to build custom GUIs (Electron, Tauri, React) on top of the Banana Code engine without rewriting any AI logic.

Start the server:
```bash
banana --api 4000
```

### HTTP Endpoints
- `GET /api/status`: Returns engine status, active provider, and model.
- `GET /api/sessions`: Returns a JSON array of all saved chat sessions.
- `GET /api/config`: Returns the current `config.json` preferences.

### WebSocket Streaming & Chat
Connect a WebSocket client (like `wscat` or your GUI frontend) to `ws://localhost:4000`.

**Send a chat message:**
```json
{ "type": "chat", "text": "Run the sensors command" }
```

**Streamed Response Format:**
Banana Code streams data back to the client in real-time chunks:
- `{"type": "chunk", "content": "The output of the command is..."}`
- `{"type": "tool_start", "tool": "execute_command"}`
- `{"type": "done", "finalResponse": "..."}`

### Remote Tool Approval (Security)
If the AI decides to run a shell command or patch a file, Banana Code pauses execution and sends a permission ticket to your GUI:

```json
{
  "type": "permission_requested",
  "ticketId": "5c9b2a...",
  "action": "Execute Command",
  "details": "sensors"
}
```

Your GUI must present a dialog to the user and respond with the same `ticketId` to resume execution:
```json
{
  "type": "permission_response",
  "ticketId": "5c9b2a...",
  "allowed": true,
  "session": true
}
```
If an invalid `ticketId` is provided, Banana Code automatically blocks the tool execution to ensure safety.

## 🔐 Privacy & Security

Banana Code is built with transparency in mind:
1. **Approval Required**: No file is written and no command is run without you saying "Allow".
2. **Local Storage**: Your API keys and chat history are stored locally on your machine (`~/.config/banana-code/`).
---

Made with 🍌 by [banaxi](https://github.com/banaxi-tech)

Banana Code is an independent open-source project and is not affiliated with, endorsed by, or sponsored by OpenAI, Google, Anthropic, or any other AI provider. 

This tool provides an interface to access services you already have permission to use. Users are responsible for complying with the Terms of Service of their respective AI providers. Use of experimental or internal endpoints is at the user's own risk.
