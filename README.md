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

## Privacy
When you download Banana Code, a request is sent to our server to count downloads. 
Your IP address is processed momentarily to filter bots but is never stored.
Only the total download count is saved.

## 🤔 Why Banana Code?
While tools like Cursor provide great GUI experiences, Banana Code is built for developers who live in the terminal and want maximum flexibility. 
- **No Vendor Lock-in**: Switch instantly between the best proprietary models (Gemini, Claude, OpenAI) and high-performance open-source models (Ollama Local, Ollama Cloud) mid-conversation.
- **True Autonomy**: With Plan & Execute mode and Self-Healing Error Loops, Banana Code doesn't just suggest code; it tries, fails, reads the errors, and fixes its own mistakes automatically.
- **Terminal Native**: It brings the power of full workspace awareness, web search, and surgical file patching directly to your CLI without forcing you to change your IDE.

## ✨ Key Features

- **Multi-Provider Support**: Switch between **Google Gemini**, **Anthropic Claude**, **OpenAI** (API key or ChatGPT / Codex OAuth), **Mistral AI**, **OpenRouter** (any model ID; see [OpenRouter setup](#openrouter-setup)), **Ollama Cloud**, and **Ollama (Local)** effortlessly.
- **Auto Mode**: For most providers, pick **Auto Mode** as your model — a small “router” model reads your prompt and chooses which model **and reasoning effort** to use for that turn.
- **Interactive Terminal Suite**: Move beyond one-shot commands. The AI can now spawn persistent terminal sessions to handle interactive prompts like `npm init`, `git commit` (with editors), or Y/N confirmations in real-time.
- **Financial Intelligence**: Track your exact API spend and savings. Banana Code uses server-side usage data to show you session costs and how much you've saved via **Prompt Caching**.
- **Model Context Protocol (MCP)**: Connect Banana Code to any community-built MCP server (like SQLite, GitHub, Google Maps) to give your AI infinite new superpowers via `/beta`.
- **Modes**: Use `/agent` for normal execution, **`/plan`** for [Plan mode](#plan-mode), **`/ask`** for [Ask mode](#ask-mode), **`/security`** for [Security mode](#security-mode), or **`/skill-creator`** for [Skill Creator mode](#skill-creator-mode).
- **Hierarchical Sub-Agents**: The main AI can spawn specialized "sub-agents" (Researchers, Coders, Reviewers) to handle complex tasks without polluting your main chat history.
- **Self-Healing Loop**: If the AI runs a command (like running tests) and it fails, Banana Code automatically feeds the error trace back to the AI so it can fix its own code.
- **Agent Skills**: Teach your AI specialized workflows. Drop a `SKILL.md` file in your config folder, and the AI will automatically activate it when relevant.
- **Smart Context & Pruning**: Use `@file/path.js` to instantly inject file contents, auto-feed your workspace, and use `/clean` to instantly compress long chat histories to save tokens.
- **Web Research**: Deep integration with DuckDuckGo APIs and Scrapers to give the AI real-time access to the internet.
- **Persistent Sessions**: All chats are auto-titled and saved. Use `/chats` for a fully interactive menu to resume any past session.
- **🛡️ Banana Guard**: AI-Powered Auto-Approve. Instead of clicking "Allow" on every single action, Banana Guard automatically approves all file-system operations (`write_file`, `patch_file`, etc.). For shell commands, it uses a second, fast AI check to automatically approve safe tasks (like `ls` or `npm install`) while still stopping risky operations for your review. This gives you the speed of YOLO mode with a security layer for your shell.
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

You'll need your API keys handy for Gemini, Claude, OpenAI (unless you use ChatGPT sign-in), Mistral, Ollama Cloud, or OpenRouter. For **OpenRouter**, you enter an API key and a custom model ID; Banana Code checks OpenRouter’s model list so the model supports **tool calling** before continuing.

## 📖 Usage

### Start a New Session
```bash
banana
```

Optional flags:

| Flag | Effect |
|------|--------|
| `--yolo` | Start with YOLO mode on (same as `/yolo` in-app: auto-approve permission prompts). |
| `--resume [uuid]` | Resume a session; UUID optional (latest session if omitted). |

### Resume a Session
To continue where you left off, use the `--resume` flag with your session UUID:
```bash
banana --resume <uuid>
```
Omit `<uuid>` to resume the **most recently updated** saved session.

### In-App Commands
While in a chat, use these special commands (type `/help` for the full list):

| Command | What it does |
|--------|----------------|
| `/provider` | Switch provider: `gemini`, `claude`, `openai`, `mistral`, `openrouter`, `ollama_cloud`, `ollama` |
| `/model` | Change model; omit the name to open the menu (includes **Auto Mode** where supported). |
| `/chats` | Browse and resume saved sessions (auto-titled). |
| `/clear` | Clear the current conversation (same provider/model). |
| `/clean` | Summarize long history into a short memory to save tokens (beta; enable in `/beta`). |
| `/context` | Show message count and estimated tokens. |
| `/settings` | Workspace auto-feed, markdown/syntax output, patch tool, token count in status bar, global memory. |
| `/beta` | Beta tools (e.g. MCP, optional scrapers, `/clean`). |
| `/memory` | View, add, or delete global memories (needs memory enabled in `/settings`). |
| `/skills` | List loaded Agent Skills from `~/.config/banana-code/skills/`. |
| `/init` | Generate `BANANA.md` project summary in the current directory. |
| `/permissions` | List permissions granted for this session. |
| `/style` | Change AI writing style (Normal, Explanatory, Formal). |
| `/effort` | Change Claude reasoning effort (low, medium, high, xhigh, max). |
| `/debug` | Toggle debug output (e.g. tool results, auto-route diagnostics). |
| `/plan` | Plan mode: AI outlines a plan before large edits. |
| `/agent` | Default: AI applies changes directly. |
| `/skill-creator` | Skill Creator mode: AI helps write custom Agent Skills. |
| `/ask` | [Ask mode](#ask-mode): questions and explanations only; no project edits. |
| `/security` | Security-focused review mode (defensive use only). |
| `/guard` | Toggle Banana Guard (AI auto-approve for safe commands). |
| `/yolo` | Auto-approve permission prompts (use with care). |
| `/help` | Show all commands. |
| `/exit` | Quit (also `Ctrl+D` / `Ctrl+C` flow). |

**File context:** Type `@path/to/file` or `@@/absolute/path` in your message to attach file contents to that prompt. Use `@@path/to/image.png` to attach an image (supported by Gemini/Claude/OpenAI).

### ⚡ Auto Mode
When **Auto Mode** is selected as the model (`/model` or initial setup), each new user message is first sent to a **small, fast router model** (per provider) together with the **last seven conversation messages** (formatted as context only). The router returns JSON: which concrete model should handle **this** turn and a short reason—so short follow-ups like “Implement it” can pick a capable model when the history shows a large task. The assistant’s reply then uses that model. If routing fails, providers fall back to a sensible default (e.g. Gemini may fall back to **Gemini 3 Flash**). **OpenRouter** and **local Ollama** do not offer Auto Mode (fixed model ID vs. local tag list).

### 🚀 Claude Fast Mode
Select models like **Claude Opus 4.6 (Fast Mode)** from the `/model` menu to dramatically speed up your workflow. Fast Mode provides 2.5x faster output speeds for high-intensity tasks. 
> **⚠️ WARNING:** Fast Mode consumes significantly more compute and costs approximately 6x more than standard models.

### OpenRouter setup

[OpenRouter](https://openrouter.ai) lets you use many models behind one API. In Banana Code, choose **OpenRouter** in `/provider`, paste your OpenRouter API key, then enter a **model ID** (e.g. `org/model:free`). Banana Code loads OpenRouter’s public model list and checks that the model advertises tool support (`tools` / `tool_choice` in `supported_parameters`) so Banana’s tools can run. Routing uses the same OpenAI-compatible Chat Completions API at `https://openrouter.ai/api/v1`.

### 🎛️ Operating modes
Banana Code layers **behavior modes** on top of the normal agent. Only one “style” mode is active at a time (`/plan`, `/ask`, `/security`, `/skill-creator`, or default agent). The status bar shows **PLAN MODE**, **ASK MODE**, or **SECURITY MODE** when relevant.

| Command | Role |
|--------|------|
| **`/agent`** | Default: full coding agent with tools (subject to permissions). |
| **`/plan`** | [Plan mode](#plan-mode) — propose a written plan before larger edits. |
| **`/skill-creator`** | [Skill Creator mode](#skill-creator-mode) — expert prompt engineer to create custom Agent Skills. |
| **`/ask`** | [Ask mode](#ask-mode) — read-only Q&A; no file or state-changing edits. |
| **`/security`** | [Security mode](#security-mode) — prioritize vulnerability review. |
| **`/guard`** | Toggle Banana Guard (AI auto-approve for safe commands). |
| **`/yolo`** | Auto-approve permission prompts (dangerous; use carefully). |

### Plan mode

Enable with **`/plan`**. The system prompt switches to **Plan Mode**: the model is told to treat you as someone who wants a clear plan before risky or wide-reaching work.

**Behavior**

- **Small or trivial changes** (e.g. a typo, a one-line fix) may still be applied directly with tools.
- **Significant work** — anything that touches multiple areas, adds a feature, or has broad impact — should **not** start with `write_file` / `patch_file`. The model should instead output an **implementation plan** (files to touch, ordered steps).
- It should **pause** and ask whether the plan looks good before editing.
- **File-changing tools** for those larger tasks are only appropriate **after** you explicitly approve the plan.

Return to normal behavior with **`/agent`** (or switch to another mode). Plan mode is meant to reduce surprise edits and keep big refactors reviewable.

### Ask mode

Enable with **`/ask`**. The system prompt switches to **Ask Mode**: the assistant is restricted to **answering questions**, **explaining code**, and **gathering information** — not changing your project.

**Behavior**

- The model **must not** modify the codebase: no `write_file`, `patch_file`, or shell commands that change state (installing packages, deleting files, etc.).
- It **may** use **read-only** tools to help answer you: e.g. `read_file`, `search_files`, `list_directory`, and **non-mutating** `execute_command` runs such as `git status` or running tests to report output.

Use Ask mode when you want explanations, design discussion, or code review without accidental edits. Return to the default coding agent with **`/agent`**, or switch to **`/plan`** or **`/security`** if you want those modes instead.

### Security mode

Enable with **`/security`**. The system prompt switches to **Security Mode**: the model prioritizes **finding and explaining** security issues in **your** codebase.

**Behavior**

- Focus on vulnerabilities, misconfigurations, and unsafe patterns (e.g. injection, auth issues, secret leakage, OWASP-style issues).
- Output should include **actionable detail**: affected paths, what’s wrong, and remediation ideas.

**Responsible use**

Banana Code is for **defensive** work on software you own or are authorized to test. Do not use Security mode to probe systems without permission or to develop exploits. Return to normal coding with **`/agent`** when you’re done reviewing.

### Skill Creator mode

Enable with **`/skill-creator`**. The system prompt switches to **Skill Creator Mode**: the assistant acts as an expert Prompt Engineer to help you write custom "Agent Skills".

**Behavior**

- When you ask for a skill (e.g., "Make me a React Expert skill"), the AI will automatically generate a well-structured markdown file.
- It saves this file directly into the skills directory (`~/.config/banana-code/skills/<skill-name>/SKILL.md`) using the required YAML frontmatter format.
- The AI will ask clarifying questions if your request is too vague.

Return to normal coding with **`/agent`** when you’re done creating skills.

### Available Tools
Banana Code can assist you by:
- **`execute_command`**: Running one-shot shell commands (ls, mkdir, etc.).
- **`execute_command_in_terminal`**: Starting a persistent, interactive terminal session (e.g. for `npm init`).
- **`send_to_terminal`**: Sending input to an active terminal session (e.g. answering "Y" or a package name).
- **`read_file`**: Reading local source code.
- **`write_file`**: Creating or editing files.
- **`patch_file`**: Targeted search-and-replace style edits.
- **`fetch_url`**: Browsing web documentation.
- **`search_files`**: Performing regex searches across your project.
- **`list_directory`**: Exploring folder structures.
- **`get_banana_docs`**: Reading internal app documentation to answer user questions.

### 🐚 Interactive Terminal
Version 2.0.0 introduces **Stateful Terminal Interaction**. When the AI runs a command that doesn't exit immediately (like a configuration wizard or a long-running dev server), it maintains a persistent session. The AI can then "see" the prompt from the terminal and send the appropriate response (e.g., typing a project name into `npm init` or answering `Y` to a deletion prompt).

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

### 💰 Financial Intelligence
Banana Code 2.0.0 tracks your actual API expenditure. By using real usage data from providers (like Anthropic), it calculates exactly how much each turn costs. 

- **Prompt Caching**: The app automatically utilizes Claude's Prompt Caching.
- **View Savings**: Type **`/context`** to see your current session spend and how much money the cache has saved you (often up to 90%).
- **Session Totals**: A final cost summary is printed whenever you exit the application.

## 📡 Headless API Mode (`--api`)
Banana Code can be run as a background engine, exposing its powerful tool-calling and provider-switching logic via a local HTTP and WebSocket server. This allows you to build custom GUIs (Electron, Tauri, React) on top of the Banana Code engine.

### Starting the server
```bash
banana --api         # default port 3000, localhost only
banana --api 4000    # custom port
```

> **`--no-auth`** flag disables token protection entirely. This is **deprecated and unsafe** — anyone on your network can execute arbitrary commands on your machine. Never use it in production.

---

### 🔐 API Security (Token Auth)
The API server is protected by a **Secure API Token**.
- A 32-character hex token is automatically generated on first start and stored at `~/.config/banana-code/token.json`.
- **HTTP endpoints** require the token via `Authorization: Bearer <token>` header or `?token=<token>` query parameter.
- **WebSocket connections** authenticate via an in-message handshake after connecting (see below).

---

### HTTP Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Engine status, active provider, and model. |
| `GET` | `/api/sessions` | JSON array of all saved chat sessions (metadata only, no message history). |
| `GET` | `/api/config` | Current runtime configuration. |
| `GET` | `/api/docs` | Internal `BANANA.md` documentation for the current workspace. |

---

### WebSocket API

Connect to `ws://localhost:<port>` (no token in the URL). After the connection opens, your **first message must be an auth handshake**:

```json
{ "type": "auth", "token": "YOUR_TOKEN" }
```

**Success response:**
```json
{ "type": "auth_success" }
```

**Failure response** (connection is then closed):
```json
{ "type": "error", "message": "Unauthorized: Invalid token" }
```

All subsequent messages are only processed after a successful auth. Sending any other message type before authenticating will close the connection.

---

#### Message Reference

All messages are JSON objects with a `type` field.

##### 💬 Chat

Send a message to the AI:
```json
{ "type": "chat", "text": "Refactor the login function" }
```

Streamed responses arrive as a sequence of events:
| Event | Description |
|-------|-------------|
| `{"type": "chunk", "content": "..."}` | Streamed text token from the AI. |
| `{"type": "tool_start", "tool": "write_file"}` | AI is invoking a tool. |
| `{"type": "tool_end", "result": "..."}` | Tool execution finished. |
| `{"type": "done", "finalResponse": "...", "usage": {...}}` | Full response complete. `usage` contains cost data if available. |

Sessions are **automatically saved to disk** after every chat message.

---

##### ⚙️ Configuration

Update runtime config (in-memory only):
```json
{ "type": "update_config", "config": { "model": "gpt-5.5", "yolo": false } }
```

To also persist the change to `config.json` on disk, add `"save": true`:
```json
{ "type": "update_config", "config": { "provider": "claude" }, "save": true }
```

If `provider` or `model` changes, the provider instance is automatically re-initialized while preserving conversation history.

**Response:** `{ "type": "config_updated", "config": { ... } }`

---

##### 📁 Workspace

Change the working directory:
```json
{ "type": "set_workspace", "path": "/home/user/my-project" }
```

**Response:** `{ "type": "workspace_updated", "path": "/home/user/my-project" }`

---

##### 💾 Sessions

List saved sessions (metadata only):
```json
{ "type": "list_sessions" }
```
**Response:** `{ "type": "sessions_list", "sessions": [ { "uuid": "...", "title": "...", "updatedAt": "...", "provider": "...", "model": "..." } ] }`

Load a session (restores provider and full message history):
```json
{ "type": "load_session", "sessionId": "SESSION_UUID" }
```
**Response:** `{ "type": "session_loaded", "sessionId": "...", "title": "...", "messages": [ ... ] }`

---

##### 🧠 Memory

List all saved memories:
```json
{ "type": "list_memories" }
```
**Response:** `{ "type": "memories_list", "memories": [ ... ] }`

Add a memory:
```json
{ "type": "add_memory", "fact": "User prefers TypeScript over JavaScript." }
```
**Response:** `{ "type": "memory_added", "id": "...", "fact": "..." }`

Delete a memory:
```json
{ "type": "delete_memory", "id": "MEMORY_ID" }
```
**Response:** `{ "type": "memory_deleted", "id": "..." }`

---

##### 🗑️ History

Clear the current conversation history (keeps system prompt):
```json
{ "type": "clear_history" }
```
**Response:** `{ "type": "history_cleared" }`

Compress long conversation history into a short summary to save tokens:
```json
{ "type": "clean" }
```
**Response:** `{ "type": "clean_complete", "summary": "...", "messages": [ ... ] }`
The compressed session is automatically saved to disk if a session is active.

---

##### 🍌 Project Init

Generate a `BANANA.md` project summary for the current workspace:
```json
{ "type": "init" }
```
**Response:** `{ "type": "init_complete", "summary": "..." }`
The provider instance is automatically re-initialized after creation so it picks up the new context file.

---

##### 🔑 Codex OAuth Login

Trigger the OpenAI Codex browser-based OAuth login flow:
```json
{ "type": "trigger_codex_login" }
```

Immediate response (check your terminal to complete login in the browser):
```json
{ "type": "codex_login_started", "message": "Please check your terminal to complete the OpenAI login." }
```

Final response when login completes:
```json
{ "type": "codex_login_finished", "success": true }
```

---

##### 🛡️ Remote Tool Approval

When the AI needs to execute a tool that requires permission, the server sends:
```json
{ "type": "permission_requested", "ticketId": "5c9b2a...", "action": "Execute Command", "details": "rm -rf dist/" }
```

Your client must respond with the matching `ticketId`:
```json
{ "type": "permission_response", "ticketId": "5c9b2a...", "allowed": true, "session": true }
```

- `"allowed": false` blocks the action.
- `"session": true` remembers the decision for the rest of the session.
- Responding with an invalid or unknown `ticketId` is automatically blocked for safety.

---

##### ❌ Error Response

All errors follow a consistent format:
```json
{ "type": "error", "message": "Description of what went wrong." }
```

## 🐛 Known Issues

- Its a known issue that when resizing the terminal the Banana Code logo goes away.

## 🔐 Privacy & Security
...

Banana Code is built with transparency in mind:
1. **Approval Required**: No file is written and no command is run without you saying "Allow".
2. **Local Storage**: Your API keys and chat history are stored locally on your machine (`~/.config/banana-code/`).
---

Made with 🍌 by [banaxi](https://github.com/banaxi-tech)

Banana Code is an independent open-source project and is not affiliated with, endorsed by, or sponsored by OpenAI, Google, Anthropic, or any other AI provider. 

This tool provides an interface to access services you already have permission to use. Users are responsible for complying with the Terms of Service of their respective AI providers. Use of experimental or internal endpoints is at the user's own risk.
