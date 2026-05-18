# 🍌 Banana Code Privacy Policy

**Last updated: May 18, 2026**

**Updated Privacy Policy:** This update reflects Banana Code Remote phone-to-CLI chat, optional image attachments, optional GitHub App integration, and optional CLI feedback submission.

## 1. Overview

This Privacy Policy explains what data is collected, how it is used, and your rights when you use Banana Code and the Banana Code Remote companion Android application. We are committed to transparency and collecting only what is strictly necessary to make the product work.

## 2. Banana Code CLI — Data Collected

### 2.1 One-Time Installation Ping

When you install Banana Code via `npm install -g @banaxi/banana-code` and run it for the first time, a single HTTP request is sent to our server (bananacode.sh) to count the download. This request includes:

- Your IP address — processed momentarily for bot filtering, **never stored**.
- A timestamp and a basic User-Agent string.

Only the total download count (an integer) is saved. No personally identifiable information (PII) is retained from this ping.

### 2.2 API Keys

Your AI provider API keys and local provider URLs (OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, Kimi AI, Qwen, llama.cpp, etc.) are stored **locally only** in your home directory (`~/.config/banana-code/config.json`). They are never transmitted to our servers.

### 2.3 Chat History & Sessions

All chat history and session files are stored **locally only** in your home directory. They are never uploaded to any server unless you explicitly enable Banana Remote (see Section 3).

### 2.4 Workspace & File Contents

Banana Code reads your local files when you use `@file` mentions, `write_file`, `patch_file`, or the workspace auto-feed feature. This content is sent directly from your machine to the AI provider you have configured (e.g. Anthropic, Google, OpenAI, DeepSeek, Kimi AI, Qwen, or your local llama.cpp server). We do not intercept, store, or process this data.

### 2.5 Optional Feedback Submission

When you run `/feedback`, Banana Code sends the feedback text you enter to `bananacode.sh` so the project maintainer can review product feedback and bug reports.

The feedback request includes:

- The feedback message you type.
- A source label (`banana-code-cli`).
- Basic CLI/runtime metadata: Banana Code version when available, configured provider, configured model, authentication type, operating system platform, and operating system release.
- Request metadata collected by the server: timestamp, IP address, and User-Agent.

Feedback is optional. Banana Code does **not** automatically include chat history, local file contents, API keys, terminal output, or workspace data in feedback submissions. Do not include secrets or private code in feedback unless you intentionally want to send that information to the maintainer.

## 3. Banana Code Remote (Android App) — Data Collected

Banana Code Remote is an optional companion Android app that lets you send messages to your CLI session, monitor responses, and approve tool calls remotely. When you use it, the following data flows through our relay server at `bananacode.sh`:

### 3.1 Account Credentials

To use Banana Code Remote you create an account with a **username** and **password**. The username is chosen by you and is stored in our database. The password is **never stored in plain text** — it is hashed using scrypt (a cryptographically strong, memory-hard algorithm) before being saved. We cannot recover your password; only a correct password will verify against the stored hash.

A random account UUID is generated at registration and stored alongside your username. This UUID is used to route messages between your CLI and your phone. You may delete your account and all associated data at any time by contacting us.

### 3.1.1 Device Tokens

After registering or logging in (app) and after redeeming a pairing code (CLI), a unique **opaque device token** is issued for each device:

- The app receives a `bapp_…` token.
- The CLI receives a `bcli_…` token.

These tokens are stored as SHA-256 hashes in our database. The plain-text token is only ever held on your device. Tokens are used to authenticate all API calls and Socket.IO connections. You can revoke tokens by logging out (app) or disconnecting (`/remotetooling disconnect` in the CLI).

### 3.2 Remote Chat Messages, Image Attachments, and AI Messages

When you send a message from Banana Code Remote on your phone, the message text is relayed through our server to your paired CLI. The message text may be stored in our database to support remote message history and delivery status.

If you attach images from the phone app, the app compresses them before sending. Image bytes are relayed through our server to your paired CLI for the current message only. We do **not** store phone image bytes in remote message history; only image-count metadata or a marker such as "[1 image attachment]" may be stored.

When Banana Remote is paired, the text of AI responses from your CLI session is relayed through our server to your phone. These messages are temporarily stored in our database to support message history. These AI-response records contain the AI-generated text. Phone-originated prompts are covered above, and local CLI prompts or file contents are not stored as AI-response records.

### 3.3 Tool Call Requests

When the AI agent wants to execute a command, write a file, or patch code, a tool request is sent through our relay. This includes:

- The action type (e.g. "Execute Command", "Write File").
- The details (e.g. the command string, the file path, or the diff).

This data may include code snippets, file paths, and shell commands from your local machine. It is relayed through our server and stored temporarily in our database.

### 3.4 Tool Responses (Approvals/Denials)

Your Approve or Deny decisions are relayed from the app back to the CLI via our server. The approval decision is stored alongside the tool request in our database.

### 3.5 Pairing Codes

Short-lived alphanumeric pairing codes (used to link your CLI to your phone) are stored temporarily and deleted immediately upon successful use or expiry (5 minutes).

## 4. GitHub App Integration — Data Collected

The GitHub integration is optional and starts only when you run `/github` and authorize a GitHub App installation in your browser.

### 4.1 GitHub Connection Tokens

The CLI stores an opaque Banana GitHub integration token locally in `~/.config/banana-code/config.json`. The server stores only a SHA-256 hash of that token, the GitHub App installation ID, and the connected GitHub account login/type. The GitHub App private key is kept on the backend server only and is never sent to users or stored in the CLI.

### 4.2 GitHub Tool Calls

When the AI uses GitHub tools, API requests are sent through the backend so it can exchange the GitHub App private key for short-lived GitHub installation tokens. Requests may include repository names, file paths, issue or pull request numbers, comment/review text, and other GitHub REST API payloads needed for the action. Mutating actions such as comments, reviews, and merges require user approval in Banana Code before they are sent.

## 5. Data Storage & Security

- Our relay server runs at `bananacode.sh` on infrastructure in the EU.
- All connections use TLS (HTTPS / WSS).
- All API requests and Socket.IO connections are authenticated with per-device **Bearer tokens**. Tokens are stored only as SHA-256 hashes on the server; the plain-text value never leaves your device.
- GitHub integration tokens are also stored only as SHA-256 hashes on the server. GitHub installation access tokens are short-lived and cached in memory only.
- Passwords are stored using **scrypt** (memory-hard key derivation). They are never stored in plain text.
- Remote and GitHub integration data is stored in an SQLite database on the server.
- CLI feedback submissions are stored in a server-side JSONL file and can be viewed only through a maintainer-only, password-protected feedback feed. The feedback feed uses a bcrypt-hashed maintainer password and HMAC-signed session cookies.
- No third-party analytics, advertising networks, or data brokers receive your data.
- Access to the server, database, and feedback feed is restricted to the project maintainer.

## 6. Data Retention

- Tool requests and text messages are stored for session debugging and remote message history. Phone image bytes are forwarded transiently and are not stored in message history. There is currently no automatic deletion schedule for stored text/tool data. You may request deletion at any time.
- CLI feedback submissions are stored for product improvement and bug triage. There is currently no automatic deletion schedule for feedback submissions. You may request deletion at any time by describing the feedback text or approximate submission date.
- Pairing codes are automatically deleted after use or after 5 minutes.
- GitHub connection sessions expire after 5 minutes. GitHub integration token records remain until you disconnect GitHub or request deletion.
- The installation ping counter only stores an aggregate number — no per-request history is kept.

## 7. Third-Party AI Providers

When you use Banana Code, your prompts, file contents, and any image attachments you provide are sent to the AI provider you configured (Google, Anthropic, OpenAI, Mistral, DeepSeek, Kimi AI, Qwen, local llama.cpp, etc.) so the model can answer. Their own privacy policies govern how they handle this data. For local CLI messages, Banana Code does not intermediate or receive copies of these provider requests. For phone-originated Banana Remote messages, the prompt text and transient image bytes pass through `bananacode.sh` only to reach your paired CLI.

## 8. Children's Privacy

Banana Code and Banana Code Remote are not directed at children under 13. We do not knowingly collect data from children.

## 9. Your Rights

You have the right to:

- Request a copy of data associated with your UUID.
- Request deletion of your account UUID and all associated data from our relay server.
- Request deletion of feedback you submitted through `/feedback`.
- Disconnect Banana Remote at any time using `/remotetooling disconnect` in the CLI.
- Disconnect GitHub at any time using `/github disconnect` in the CLI.

To exercise these rights, contact us at **[banaxitech@gmail.com](mailto:banaxitech@gmail.com)**.

## 10. Changes to This Policy

We may update this Privacy Policy as features change. When a significant update is made, a notice banner will be displayed at the top of the website policy page for 30 days. The "Last updated" date will always reflect the date of the most recent change, and a link to the full change history is available on the website.

Continued use of the product after changes constitutes acceptance of the updated policy.

## 11. Contact

Questions or requests regarding this Privacy Policy:

- Email: **[banaxitech@gmail.com](mailto:banaxitech@gmail.com)**
- GitHub: [github.com/banaxi-tech/banana-code](https://github.com/banaxi-tech/banana-code)
