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

- **Multi-Provider Support**: Switch between **Google Gemini**, **Anthropic Claude**, **OpenAI**, **Ollama Cloud**, and **Ollama (Local)** effortlessly.
- **Plan & Agent Modes**: Use `/agent` for instant execution, or `/plan` to make the AI draft a step-by-step implementation plan for your approval before it touches any code.
- **Self-Healing Loop**: If the AI runs a command (like running tests) and it fails, Banana Code automatically feeds the error trace back to the AI so it can fix its own code.
- **Agent Skills**: Teach your AI specialized workflows. Drop a `SKILL.md` file in your config folder, and the AI will automatically activate it when relevant.
- **Smart Context**: Use `@file/path.js` to instantly inject file contents into your prompt, or use `/settings` to auto-feed your entire workspace structure (respecting `.gitignore`).
- **Web Research**: Deep integration with DuckDuckGo APIs and Scrapers to give the AI real-time access to the internet.
- **Persistent Sessions**: All chats are saved to `~/.config/banana-code/chats/`. Resume any session with a single command.
- **Syntax Highlighting**: Beautiful, readable markdown output with syntax coloring directly in your terminal.

## 🚀 Installation

Install Banana Code globally via npm:

```bash
npm install -g @banaxi/banana-code
```

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
- `/model`: Switch the active AI model on the fly.
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

## 🔐 Privacy & Security

Banana Code is built with transparency in mind:
1. **Approval Required**: No file is written and no command is run without you saying "Allow".
2. **Local Storage**: Your API keys and chat history are stored locally on your machine (`~/.config/banana-code/`).
---

Made with 🍌 by [banaxi](https://github.com/banaxi-tech)

Banana Code is an independent open-source project and is not affiliated with, endorsed by, or sponsored by OpenAI, Google, Anthropic, or any other AI provider. 

This tool provides an interface to access services you already have permission to use. Users are responsible for complying with the Terms of Service of their respective AI providers. Use of experimental or internal endpoints is at the user's own risk.
