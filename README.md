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

For full details, see the [Privacy Policy](https://bananacode.sh/privacy-policy.html).

## 🤔 Why Banana Code?
While tools like Cursor provide great GUI experiences, Banana Code is built for developers who live in the terminal and want maximum flexibility. 
- **No Vendor Lock-in**: Switch instantly between the best proprietary models (Gemini, Claude, OpenAI) and high-performance open-source models (Ollama Local, Ollama Cloud) mid-conversation.
- **True Autonomy**: With Plan & Execute mode and Self-Healing Error Loops, Banana Code doesn't just suggest code; it tries, fails, reads the errors, and fixes its own mistakes automatically.
- **Terminal Native**: It brings the power of full workspace awareness, web search, and surgical file patching directly to your CLI without forcing you to change your IDE.

## ✨ Key Features

- **Multi-Provider Support**: Switch between **Google Gemini**, **Anthropic Claude**, **OpenAI** (API key or ChatGPT / Codex OAuth), **Mistral AI**, **DeepSeek** (V4 Flash and V4 Pro), **Kimi AI** (K2.6 and K2.5), **Qwen** (Qwen 3.6/3.5 via Alibaba Cloud Model Studio), **OpenRouter** (any model ID; see [OpenRouter setup](#openrouter-setup)), **Ollama Cloud**, and **Ollama (Local)** effortlessly.
- **Auto Mode**: For most providers, pick **Auto Mode** as your model — a small “router” model reads your prompt and chooses which model **and reasoning effort** to use for that turn.
- **Model Switch Tool**: On supported providers, the AI can recommend switching models mid-conversation and Banana Code asks before applying it. OpenRouter, local Ollama, and local LM Studio are excluded.
- **Interactive Terminal Suite**: Move beyond one-shot commands. The AI can now spawn persistent terminal sessions to handle interactive prompts like `npm init`, `git commit` (with editors), or Y/N confirmations in real-time.
- **Financial Intelligence**: Track your exact API spend and savings. Banana Code uses server-side usage data to show you session costs and how much you've saved via **Prompt Caching**.
- **Model Context Protocol (MCP)**: Connect Banana Code to any community-built MCP server (like SQLite, GitHub, Google Maps) to give your AI infinite new superpowers via `/beta`.
- **Modes**: Use `/agent` for normal execution, **`/plan`** for [Plan mode](#plan-mode), **`/ask`** for [Ask mode](#ask-mode), **`/security`** for [Security mode](#security-mode), or **`/skill-creator`** for [Skill Creator mode](#skill-creator-mode).
- **Hierarchical Sub-Agents**: The main AI can spawn specialized "sub-agents" (Researchers, Coders, Reviewers) to handle complex tasks without polluting your main chat history.
- **ImageGen Support**: Configure a local Stable Diffusion/OpenAI-compatible image server with `/imagegen` so the AI can generate image assets, choose steps, save files, and stream progress previews to API clients.
- **GitHub App Integration**: Connect `/github` to a Banana Code backend with your GitHub App installed, then let the AI read repositories, inspect files, comment on issues/PRs, review PRs, or merge PRs with your approval.
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

You'll need your API keys handy for Gemini, Claude, OpenAI (unless you use ChatGPT sign-in), Mistral, DeepSeek, Kimi AI, Qwen, Ollama Cloud, or OpenRouter. For **Kimi AI**, use your Moonshot/Kimi API key. For **Qwen**, use your DashScope/Qwen API key from Alibaba Cloud Model Studio or Qwen Cloud. For **OpenRouter**, you enter an API key and a custom model ID; Banana Code checks OpenRouter’s model list so the model supports **tool calling** before continuing.

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

### Project-Specific Settings
Add `./.banana/settings.local.json` in a project folder to override or add CLI settings only while Banana Code is started from that folder. Local settings are merged over your global `~/.config/banana-code/config.json` in memory and are not saved back to the global config.

Because this file can change safety-related settings such as permission behavior, Banana Code asks you to confirm that you trust the folder every time it starts in a directory containing `./.banana/settings.local.json`.

When Banana Code starts interactively in a folder that has `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, it asks whether to merge those existing agent instructions into `BANANA.md`. Imported sections are marked with content hashes, so Banana Code skips the prompt once the current file contents are already merged and asks again only if those source instruction files change.

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
| `/provider` | Switch provider: `gemini`, `claude`, `openai`, `mistral`, `deepseek`, `kimi`, `qwen`, `openrouter`, `ollama_cloud`, `ollama` |
| `/model` | Change model; omit the name to open the menu (includes **Auto Mode** where supported). |
| `/chats` | Browse and resume saved sessions (auto-titled). |
| `/clear` | Clear the current conversation (same provider/model). |
| `/clean` | Summarize long history into a short memory to save tokens (beta; enable in `/beta`). |
| `/copy` | Copy Banana Code's last message to your clipboard. |
| `/voice` | Record speech, transcribe with Groq Whisper or OpenRouter GPT-4o Transcribe, then send the transcript to the AI. |
| `/imagegen` | Configure Stable Diffusion image generation. The AI gets a `generate_image` tool that writes generated images to requested files. |
| `/github` | Connect a GitHub App installation. Enables GitHub tools after browser authorization. |
| `/context` | Show message count and estimated tokens. |
| `/settings` | Workspace auto-feed, markdown/syntax output, patch tool, token count, global memory, optional Puppeteer URL fetch. |
| `/beta` | Beta tools (e.g. MCP, optional scrapers, `/clean`). |
| `/memory` | View, add, or delete global memories (needs memory enabled in `/settings`). |
| `/skills` | List loaded Agent Skills from `~/.config/banana-code/skills/`. |
| `/init` | Generate `BANANA.md` project summary in the current directory. |
| `/permissions` | List permissions granted for this session. |
| `/style` | Change AI writing style (Normal, Explanatory, Formal). |
| `/effort` | Change Claude reasoning effort (low, medium, high, xhigh, max). |
| `/debug` | Toggle debug output (e.g. tool results, auto-route diagnostics). |
| `/goals` | Clarify requirements, produce a plan, then run the approved implementation with scoped auto-approval. |
| `/plan` | Plan mode: AI outlines a plan before large edits. |
| `/agent` | Default: AI applies changes directly. |
| `/skill-creator` | Skill Creator mode: AI helps write custom Agent Skills. |
| `/ask` | [Ask mode](#ask-mode): questions and explanations only; no project edits. |
| `/security` | Security-focused review mode (defensive use only). |
| `/guard` | Toggle Banana Guard (AI auto-approve for safe commands). |
| `/yolo` | Auto-approve permission prompts (use with care). |
| `/help` | Show all commands. |
| `/exit` | Quit (also `Ctrl+D` / `Ctrl+C` flow). |

**File context:** Type `@path/to/file` or `@@/absolute/path` in your message to attach file contents to that prompt. Use `@@path/to/image.png` to attach an image (supported by Gemini/Claude/OpenAI/Kimi/Qwen and other multimodal providers/models).

**Prompt mode shortcut:** Press `Shift+Tab` in the normal input box to cycle `default mode`, `auto accept edits on`, and `plan mode`.

**Voice input:** Type `/voice` to configure a transcription provider the first time. You can choose Groq (`whisper-large-v3-turbo` or `whisper-large-v3`) or OpenRouter (`openai/gpt-4o-mini-transcribe` or `openai/gpt-4o-transcribe`). Later `/voice` starts a microphone recording, and `/voice path/to/audio.wav` transcribes an existing audio file.

**Image generation:** Type `/imagegen` to configure an OpenAI-compatible image API base URL, such as `http://127.0.0.1:8000`, and select a model. Once enabled, the AI can call `generate_image` with a prompt, output path, and optional diffusion steps. API/WebSocket clients receive `image_generation_progress` previews and `image_generation_result` / `done.generatedImages` final references.

**GitHub integration:** Type `/github` to connect through the Banana Code GitHub App backend. The backend must be configured with `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and either `GITHUB_APP_PRIVATE_KEY_PATH` or `GITHUB_APP_PRIVATE_KEY`; the GitHub App setup URL should point to `https://your-backend.example/api/github/connect/callback`. The CLI stores only an opaque Banana integration token locally, while the backend keeps the GitHub App private key server-side and exchanges it for short-lived installation tokens.

### ⚡ Auto Mode
When **Auto Mode** is selected as the model (`/model` or initial setup), each new user message is first sent to a **small, fast router model** (per provider) together with the **last seven conversation messages** (formatted as context only). The router returns JSON: which concrete model should handle **this** turn and a short reason—so short follow-ups like “Implement it” can pick a capable model when the history shows a large task. The assistant’s reply then uses that model. If routing fails, providers fall back to a sensible default (e.g. Gemini may fall back to **Gemini 3 Flash**). **OpenRouter** and **local Ollama** do not offer Auto Mode (fixed model ID vs. local tag list).

Supported providers also expose a `request_model_switch` tool. The AI can call it when the current model is clearly overpowered, underpowered, too slow, or too expensive for the task. Banana Code then asks whether to use the recommended model for the rest of the current turn or continue with the current model. Future messages return to the configured model unless another switch is approved. This is available for Gemini, Claude, OpenAI, Mistral, DeepSeek, Kimi, Qwen, and Ollama Cloud; it is disabled for OpenRouter, local Ollama, and local LM Studio.

### Kimi AI setup

[Kimi API](https://platform.kimi.ai) is Moonshot AI's OpenAI-compatible API. In Banana Code, choose **Kimi AI (Moonshot)** in `/provider`, paste your `MOONSHOT_API_KEY`, then choose `kimi-k2.6` or `kimi-k2.5`. Banana Code uses the official chat completions endpoint at `https://api.moonshot.ai/v1`.

### Qwen setup

[Qwen Cloud](https://docs.qwencloud.com/) and Alibaba Cloud Model Studio expose Qwen through an OpenAI-compatible Chat Completions API. In Banana Code, choose **Qwen (Alibaba Cloud)** in `/provider`, paste your DashScope/Qwen API key, select a region endpoint, then choose a model such as `qwen3.6-plus`, `qwen3.6-max-preview`, or `qwen3.5-plus`. You can also enter a custom model ID as Qwen adds new hosted models.

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
| **`/goals`** | Goals — ask any blocking questions up front, show a plan, then run the approved plan autonomously. |
| **`/plan`** | [Plan mode](#plan-mode) — propose a written plan before larger edits. |
| **`/skill-creator`** | [Skill Creator mode](#skill-creator-mode) — expert prompt engineer to create custom Agent Skills. |
| **`/ask`** | [Ask mode](#ask-mode) — read-only Q&A; no file or state-changing edits. |
| **`/security`** | [Security mode](#security-mode) — prioritize vulnerability review. |
| **`/guard`** | Toggle Banana Guard (AI auto-approve for safe commands). |
| **`/yolo`** | Auto-approve permission prompts (dangerous; use carefully). |

### Goals

Use **`/goals <request>`** for larger work where you want Banana Code to ask clarifying questions first, make a plan, and then keep working after approval. When the plan is ready, Banana Code shows a **Ready to code?** menu:

- **Implement Plan (auto-accept edits, file reads, web fetches, and searches)** keeps shell commands behind explicit permission prompts.
- **Implement Plan (also auto-accept commands)** runs the approved implementation with commands auto-approved too.
- **Tell Banana Code what to change** sends feedback back into planning before implementation starts.

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
- **`fetch_url`**: Browsing web documentation. Enable Puppeteer fetch in `/settings` to render JavaScript-driven pages; Puppeteer is installed into Banana Code's config directory on first use.
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

### 🔌 Plugin System (Beta)
Banana Code features a robust, NPM-based plugin architecture that allows you to extend the CLI's core functionality without modifying the source code. Plugins are installed in a secure sandbox at `~/.config/banana-code/plugins/`.

#### Managing Plugins
- **`/plugin add <package-name>`**: Install a plugin from NPM.
- **`/plugin remove <package-name>`**: Uninstall a plugin.
- **`/plugin list`**: Show all currently active plugins.

#### Developing a Plugin
A plugin is a standard NPM package that exports a default initialization function. This function receives a `BananaAPI` object used to register new features.

**Example `index.js`:**
```javascript
export default function init(api) {
    // Add a custom provider
    api.registerProvider('my-llm', 'My Custom LLM', class MyProvider {
        constructor(config) { this.messages = []; }
        async sendMessage(input) { return "Hello from plugin!"; }
        static async getModels() { return [{ name: 'Model 1', value: 'm1' }]; }
    });

    // Add a custom slash command
    api.registerCommand('/hello', 'Say hello', (args) => {
        console.log("Hello from the plugin command!");
    });

    // Intercept messages
    api.onBeforeMessage(({ text, images }) => {
        return { text: text.replace(/apple/g, 'banana') };
    });
}
```

#### Available API Hooks:
| Hook | Description |
|------|-------------|
| `registerProvider(id, name, Class)` | Add a new LLM provider to the `/provider` menu. |
| `registerCommand(name, desc, handler)` | Add a new slash command to the CLI. |
| `registerTool(definition, execute)` | Add a new AI tool (capability) to the agent. |
| `onBeforeMessage(fn)` | Modify user input or attached images before sending to AI. |
| `onAfterMessage(fn)` | Modify the AI response text before it is stored in history. |

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
| `POST` | `/api/voice` | Upload audio, transcribe with Groq Whisper or OpenRouter GPT-4o Transcribe, then send the transcript to the AI. |

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

##### 🎙️ Voice Upload

Upload an audio file and have Banana Code transcribe it before sending the transcript to the active AI provider. Groq remains supported:

```bash
curl -X POST "http://localhost:3000/api/voice" \
  -H "Authorization: Bearer YOUR_BANANA_API_TOKEN" \
  -H "x-groq-api-key: YOUR_GROQ_API_KEY" \
  -F "model=whisper-large-v3-turbo" \
  -F "file=@question.wav"
```

You can also configure `voice.groqApiKey` and `voice.model` through `update_config`, then omit the Groq header and model field. The response includes `{ "transcript": "...", "finalResponse": "...", "usage": {...} }`.

OpenRouter transcription uses OpenRouter's `audio/transcriptions` endpoint and supports `openai/gpt-4o-mini-transcribe` or `openai/gpt-4o-transcribe`:

```bash
curl -X POST "http://localhost:3000/api/voice" \
  -H "Authorization: Bearer YOUR_BANANA_API_TOKEN" \
  -H "x-openrouter-api-key: YOUR_OPENROUTER_API_KEY" \
  -F "voiceProvider=openrouter" \
  -F "model=openai/gpt-4o-mini-transcribe" \
  -F "file=@question.wav"
```

You can also configure `voice.provider`, `voice.openrouterApiKey`, and `voice.model` through `update_config`, then omit the OpenRouter header and model field. Supported uploaded file extensions are `.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.webm`, and `.aac`.

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

## 📱 Banana Code Remote (Android App)

Banana Code Remote is a companion Android app that lets you chat with your CLI session, monitor responses, and approve or deny AI tool calls from your phone — in real time, from anywhere.

**[Download the APK →](https://drive.usercontent.google.com/download?id=1hzZ5I354hH1m3pOI_2N6hSMmzfV3CRPM&export=download&authuser=0&confirm=t&uuid=4f8125c7-91d2-4226-98b1-56f21ce6b17c&at=ALBwUgmSzSWDvxiIFLX8f0ogcFBH%3A1777466936495)**  
Requires Android 10+ (API 29). Sideloading required (not on Play Store yet).

### Features
- **Phone-to-CLI Chat** — Send prompts from your phone and see the same turn appear in the active CLI terminal.
- **Image Attachments** — Attach up to 4 compressed images when the active provider supports image input.
- **Live AI Feed** — Complete AI responses stream to your phone with full Markdown rendering (headings, bold, inline code, fenced code blocks with diff highlighting, tables).
- **Push Notifications** — Get notified when the AI needs permission to run a command, write a file, or apply a patch.
- **Approve / Deny with one tap** — From the notification shade or from inside the app.
- **Tool History** — Every tool call is shown as a message in the chat history, including file diffs for write/patch operations.
- **Dual-path permission flow** — The CLI simultaneously shows the standard Allow Once / Allow for Session / Deny prompt. Whichever side responds first wins; the other is cancelled automatically.

### Setup

**1. Install the APK** on your Android device. Go to `Settings → Install unknown apps` and allow your browser or file manager to sideload the file.

**2. Open the app** — it will display a 6-character pairing code (e.g. `AB3XZ1`). The code expires in 5 minutes.

**3. Run in your CLI:**
```bash
/remotetooling
```
Enter the pairing code. Once connected, you'll see "Mobile App connected!" in the CLI.

**4. You're live.** You can send messages from the phone or CLI. AI messages stream to your phone, and tool approval notifications will arrive when the agent needs to take an action.

### Disconnecting

```bash
/remotetooling disconnect
```

Closes the socket, clears the saved pairing UUID from config, and immediately reverts all permission prompts back to standard local CLI behaviour.

### Privacy

When Banana Remote is active, phone-originated prompts, transient phone image attachments, AI message text, tool call details (including command strings and code diffs), and approval decisions are relayed through our server at `bananacode.sh` over TLS. Image bytes are forwarded to the paired CLI for the current message and are not stored in remote message history; the history keeps text plus image-count metadata.

See the full [Privacy Policy](https://bananacode.sh/privacy-policy.html) for what is collected and how long it is retained.

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
