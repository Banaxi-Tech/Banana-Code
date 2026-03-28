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

## ✨ Key Features

- **Multi-Provider Support**: Switch between **Google Gemini**, **Anthropic Claude**, **OpenAI**, and **Ollama (Local)** effortlessly.
- **Interactive TUI**: A beautiful, minimal terminal interface with real-time feedback and progress indicators.
- **Persistent Sessions**: All chats are saved to `~/.config/banana-code/chats/`. Resume any session with a single command.
- **Robust Tool System**: Banana Code can execute shell commands, read/write files, fetch URLs, and search your workspace.
- **Security First**: A dedicated permission model ensures no tool is executed without your explicit approval.
- **Keyless Playground**: Integration with OpenAI Codex for seamless, keyless access to GPT-4o and beyond.

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

## 🔐 Privacy & Security

Banana Code is built with transparency in mind:
1. **Approval Required**: No file is written and no command is run without you saying "Allow".
2. **Local Storage**: Your API keys and chat history are stored locally on your machine (`~/.config/banana-code/`).
---

Made with 🍌 by [banaxi](https://github.com/banaxi-tech)

Banana Code is an independent open-source project and is not affiliated with, endorsed by, or sponsored by OpenAI, Google, Anthropic, or any other AI provider. 

This tool provides an interface to access services you already have permission to use. Users are responsible for complying with the Terms of Service of their respective AI providers. Use of experimental or internal endpoints is at the user's own risk.
