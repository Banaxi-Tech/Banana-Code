// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

export const BANANA_CODE_DOCS = `
# 🍌 Banana Code Official Documentation (Summary)

Banana Code is a terminal-native AI pair programmer that supports multiple providers (Gemini, Claude, OpenAI, etc.) and gives the AI full autonomy via advanced tools.

## 💬 Slash Commands
Type these into the chat to control the app:
- /chats      : Open an interactive menu to resume previous chat sessions.
- /provider   : Switch between AI providers (gemini, claude, openai, etc.).
- /model      : Change the model for the current provider (e.g., claude-sonnet-4.6).
- /clean      : Summarize the current chat history to save tokens and clear "clutter".
- /context    : Show current token usage and context breakdown.
- /effort     : Set Claude reasoning effort (low, medium, high, xhigh, max).
- /plan       : Enable Plan Mode (AI proposes a plan before writing code).
- /agent      : Enable Agent Mode (AI writes code directly - Default).
- /ask        : Enable Ask Mode (Read-only, AI cannot edit files).
- /security   : Enable Security Mode (AI focuses on finding vulnerabilities).
- /skill-creator: Enable Skill Creator Mode (AI helps you write custom Agent Skills).
- /guard      : Toggle Banana Guard (AI auto-approve for safe commands).
- /yolo       : Toggle YOLO mode (Auto-approve all tool permissions).
- /settings   : Manage features like Auto-feed workspace, Syntax highlighting, and Memory.
- /beta       : Enable beta features like MCP (Model Context Protocol) and search tools.
- /memory     : View or manage global AI memories.
- /skills     : List loaded agent skills (custom expert behaviors).
- /init       : Generate a BANANA.md file that summarizes your project for the AI.
- /clear      : Clear current chat history.
- /help       : Show this help message.
- /exit       : Quit the application.

## 📂 File Mentions
- Use '@path/to/file' to attach a file's content to your message.
- Use '@@path/to/image.png' to attach an image (supported by Gemini/Claude/OpenAI).

## 🚀 CLI Flags
- --resume [uuid] : Resume a specific session (or the latest if UUID is omitted).
- --yolo          : Start the app with YOLO mode enabled.
- --api [port]    : Start Banana Code as a REST API server.
- --no-auth       : Disable API authentication (use with caution).

## 🧠 Key Features
- Multi-Provider: Switch between the best models on the fly.
- Sub-Agents: Use 'delegate_task' to spawn researchers, coders, or reviewers.
- MCP Support: Connect to external tools like databases, GitHub, or browsers via Model Context Protocol.
- Self-Healing: If a command fails, the AI automatically reads the error and tries to fix it.
`;
