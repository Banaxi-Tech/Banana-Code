---
name: banana-code-plugin-creator
description: Use this skill whenever the user asks to create, design, debug, publish, or explain a Banana Code plugin using the Banana Code plugin API.
---

# Banana Code Plugin Creator Skill

You are an expert Banana Code plugin engineer. Your job is to help the user create high-quality Banana Code plugins that match the real plugin system in this codebase.

This skill is based on Banana Code's current implementation, especially:

- `src/utils/plugins.js` — plugin install/remove/load logic and the runtime `BananaAPI` object.
- `src/tools/registry.js` — how plugin tools become AI-callable tools and how they execute.
- `src/index.js` — how plugin providers, slash commands, and lifecycle hooks are used by the CLI.
- `src/config.js` — how plugin providers participate in setup/model selection.
- `README.md` — public-facing plugin commands and examples.

The plugin system is beta, so always prefer code that is simple, defensive, easy to debug, and compatible with the current loader.

---

## 1. Core Mental Model

A Banana Code plugin is a normal Node.js/NPM package that exports one initialization function.

Banana Code installs plugins into:

```text
~/.config/banana-code/plugins/
```

The configured plugin list is stored at:

```text
~/.config/banana-code/plugins.json
```

On startup, Banana Code:

1. Ensures the plugin environment exists.
2. Reads the configured package names/paths from `plugins.json`.
3. Loads each package.
4. Finds the plugin initialization function with this priority:
   - `pluginModule.default`
   - `pluginModule.init`
   - `pluginModule` itself
5. Calls the initialization function with a `BananaAPI` object.
6. The plugin uses that API object to register providers, slash commands, tools, or lifecycle hooks.

The initialization function runs during Banana Code startup. Keep it fast and side-effect-light.

---

## 2. Current `BananaAPI` Surface

The object passed into the plugin initialization function currently supports these methods:

```js
api.registerProvider(id, name, ProviderClass)
api.registerCommand(command, description, handler)
api.registerTool(toolDefinition, executeFunction)
api.onBeforeMessage(handler)
api.onAfterMessage(handler)
```

### `registerProvider(id, name, ProviderClass)`

Registers a new AI provider that appears in the `/provider` menu.

- `id`: Internal provider ID. Use lowercase, kebab-case or snake_case, and make it globally unique.
- `name`: Human-readable display name shown in the provider menu.
- `ProviderClass`: A class that Banana Code can instantiate with `new ProviderClass(config)`.

Provider classes should usually implement:

```js
class MyProvider {
  constructor(config) {}
  async sendMessage(input) {}
  updateSystemPrompt(newPrompt) {} // Optional but recommended.
  static async getModels(config) {} // Optional.
  static async setup(config) {}     // Optional.
}
```

Important runtime behavior:

- Banana Code calls `new ProviderClass(activeConfig)` when the user switches to the plugin provider.
- `/model` uses `ProviderClass.getModels(config)` if it exists.
- Provider setup uses `ProviderClass.setup(config)` first if it exists; otherwise it falls back to `getModels(config)` if available.
- `sendMessage` is called with an object shaped like:

```js
{
  text: "User message text",
  images: [],
  ultrathink: false
}
```

For maximum compatibility, plugin providers may also accept a plain string because older docs/examples may show `sendMessage(input)` with a string.

### `registerCommand(command, description, handler)`

Registers a custom slash command.

- `command`: The command name. It can be passed as `'hello'` or `'/hello'`; Banana Code adds the slash if missing.
- `description`: Shown under plugin commands in `/help`.
- `handler`: Async or sync function called when the slash command is used.

Current handler signature:

```js
async function handler(args, config, providerInstance) {}
```

Where:

- `args` is an array of words after the command.
- `config` is Banana Code's current config object.
- `providerInstance` is the active provider instance.

Slash command handlers can print to the terminal with `console.log()`. Avoid mutating config unless the user explicitly asks and you understand persistence implications.

### `registerTool(toolDefinition, executeFunction)`

Registers a new AI-callable tool.

The tool definition is added to Banana Code's available tool list. The AI can then call it the same way it calls built-in tools.

Current execute signature:

```js
async function executeFunction(args, config) {}
```

Where:

- `args` is the parsed JSON argument object from the AI tool call.
- `config` is Banana Code's current config object.

The return value should be a string or JSON-serializable value describing the result. Prefer returning concise strings or plain objects.

Use simple JSON Schema for tool parameters. Providers can be strict, so prefer this shape:

```js
{
  name: 'my_tool_name',
  description: 'What this tool does and when the AI should use it.',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'The input text to process.'
      }
    },
    required: ['input']
  }
}
```

Tool naming rules:

- Use globally unique names, e.g. `my_plugin_search_notes` instead of `search`.
- Use snake_case for tool names.
- Avoid colliding with built-in tools such as `read_file`, `write_file`, `execute_command`, etc.

### `onBeforeMessage(handler)`

Registers a hook that runs before Banana Code sends the user message to the active provider.

Current handler call shape:

```js
const result = await handler({ text, images }, config)
```

The hook may return:

- `undefined` to leave the input unchanged.
- A string to replace the message text.
- An object with `text` and/or `images` to update either field.

Example:

```js
api.onBeforeMessage(({ text, images }) => {
  return {
    text: text.replace(/apple/gi, 'banana'),
    images
  };
});
```

Important:

- Multiple plugins can register hooks.
- Hooks run sequentially.
- If a hook throws, Banana Code catches the error and prints a warning, then continues.
- Keep hooks fast; they run on every user message.

### `onAfterMessage(handler)`

Registers a hook that runs after the provider returns the assistant response.

Current handler call shape:

```js
const result = await handler(responseText, config)
```

The hook may return:

- `undefined` to leave the response unchanged.
- A string to replace the assistant response text.

Example:

```js
api.onAfterMessage((responseText) => {
  return responseText + '\n\n_Plugin footer added by my plugin._';
});
```

---

## 3. Recommended Plugin Package Structure

Use a small Node.js package. For the current loader, CommonJS is the most reliable package-root format for NPM-installed plugins because Banana Code falls back to `require(plugin)` when direct dynamic import of the package directory fails.

Recommended structure:

```text
banana-code-plugin-example/
├── package.json
├── index.cjs
├── README.md
└── LICENSE
```

Recommended `package.json`:

```json
{
  "name": "banana-code-plugin-example",
  "version": "1.0.0",
  "description": "Example plugin for Banana Code.",
  "main": "index.cjs",
  "keywords": [
    "banana-code",
    "banana-code-plugin",
    "ai",
    "cli"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}
```

Recommended `index.cjs` template:

```js
/**
 * Banana Code Plugin: Example
 *
 * Purpose:
 * - Demonstrates the safest current plugin shape for Banana Code.
 * - Uses CommonJS because the current loader supports package-root CJS well.
 *
 * Runtime:
 * - Banana Code calls module.exports (this init function) during startup.
 * - The init function receives the BananaAPI object.
 */

/**
 * Initialize the plugin and register features with Banana Code.
 *
 * @param {object} api - Banana Code plugin API.
 * @returns {void|Promise<void>}
 */
function init(api) {
  // Register features here.
}

module.exports = init;
```

ESM can be used with `export default function init(api) {}` in some situations, especially for direct file imports, but if a user reports loader problems with an NPM-installed package-root ESM plugin, switch to the CommonJS template above for compatibility with the current implementation.

---

## 4. Complete Minimal Plugin Example

Use this when the user wants a working starter plugin.

### `package.json`

```json
{
  "name": "banana-code-plugin-hello",
  "version": "1.0.0",
  "description": "Adds a hello command, a simple AI tool, and message hooks to Banana Code.",
  "main": "index.cjs",
  "keywords": ["banana-code", "banana-code-plugin"],
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}
```

### `index.cjs`

```js
/**
 * Banana Code Plugin: Hello
 *
 * This example intentionally has lots of comments so plugin authors can learn
 * the expected runtime shape quickly.
 */

/**
 * Banana Code calls this function once during startup.
 *
 * @param {object} api - The Banana Code plugin API.
 */
function init(api) {
  // ---------------------------------------------------------------------------
  // Slash command example
  // ---------------------------------------------------------------------------

  api.registerCommand('/hello', 'Print a friendly greeting from the hello plugin.', async (args, config, providerInstance) => {
    // `args` contains every word after `/hello`.
    // Example: `/hello Banaxi` gives args = ['Banaxi'].
    const name = args.join(' ').trim() || 'Banana Code user';

    // Slash commands can write directly to the terminal.
    console.log(`🍌 Hello, ${name}! This message came from a Banana Code plugin.`);
  });

  // ---------------------------------------------------------------------------
  // AI tool example
  // ---------------------------------------------------------------------------

  api.registerTool(
    {
      name: 'hello_plugin_echo',
      description: 'Echo text back with a Banana Code plugin prefix. Use this only when the user asks to test the hello plugin.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to echo back.'
          }
        },
        required: ['text']
      }
    },
    async (args, config) => {
      // Always validate tool inputs. The AI normally sends the right shape, but
      // plugins should still be robust against malformed calls.
      if (!args || typeof args.text !== 'string') {
        return 'Error: expected { text: string }.';
      }

      return `🍌 Echo from plugin: ${args.text}`;
    }
  );

  // ---------------------------------------------------------------------------
  // Message lifecycle hook examples
  // ---------------------------------------------------------------------------

  api.onBeforeMessage(({ text, images }, config) => {
    // Keep hooks conservative. They run on every message.
    // This example only modifies text when the user explicitly opts in.
    if (text.startsWith('[bananafy]')) {
      return {
        text: text.replace('[bananafy]', '').replace(/apple/gi, 'banana').trim(),
        images
      };
    }

    // Returning undefined leaves the message unchanged.
    return undefined;
  });

  api.onAfterMessage((responseText, config) => {
    // Avoid noisy after-hooks in real plugins unless the user requested them.
    return responseText;
  });
}

module.exports = init;
```

---

## 5. Provider Plugin Template

Use this when the user wants to add a new LLM provider.

A provider plugin is more involved because it must behave like Banana Code's built-in providers.

Important expectations:

- The provider constructor receives the full Banana Code config object.
- `sendMessage(input)` should accept `{ text, images, ultrathink }`.
- Keep `this.messages` as an array when possible; Banana Code uses provider message history in several places.
- Implement `updateSystemPrompt(newPrompt)` so Banana Code can refresh workspace/system context.
- Implement `static getModels(config)` to populate `/model`.
- Implement `static setup(config)` if the provider needs API keys, URLs, regions, or custom setup prompts.

Common provider skeleton:

```js
/**
 * Example provider for Banana Code.
 *
 * This is intentionally generic. Replace the fake network call with the real
 * API SDK or fetch call for the provider being integrated.
 */
class ExampleProvider {
  /**
   * @param {object} config - Banana Code config object.
   */
  constructor(config) {
    this.config = config;

    // Provider classes should track their active model.
    this.modelName = config.model || 'example-default-model';

    // Banana Code expects providers to maintain message history when possible.
    // The exact message format can match the upstream provider API, but keep it
    // simple and consistent.
    this.messages = [
      {
        role: 'system',
        content: 'You are Banana Code, a helpful terminal coding assistant.'
      }
    ];
  }

  /**
   * Allow Banana Code to refresh the system prompt after config/tool/context changes.
   *
   * @param {string} newPrompt - New system prompt text.
   */
  updateSystemPrompt(newPrompt) {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = newPrompt;
    } else {
      this.messages.unshift({ role: 'system', content: newPrompt });
    }
  }

  /**
   * Send one user message to the provider and return assistant text.
   *
   * @param {object|string} input - Banana Code passes { text, images, ultrathink }.
   * @returns {Promise<string>} Assistant response text.
   */
  async sendMessage(input) {
    // Support both current object input and older string-style examples.
    const text = typeof input === 'string' ? input : input?.text || '';
    const images = typeof input === 'object' && Array.isArray(input.images) ? input.images : [];

    this.messages.push({ role: 'user', content: text, images });

    // TODO: Replace this with the real provider API request.
    const responseText = `ExampleProvider received: ${text}`;

    this.messages.push({ role: 'assistant', content: responseText });
    return responseText;
  }

  /**
   * Optional: models shown by `/model`.
   * Must return Inquirer-compatible choices.
   */
  static async getModels(config) {
    return [
      { name: 'Example Fast Model', value: 'example-fast' },
      { name: 'Example Smart Model', value: 'example-smart' }
    ];
  }

  /**
   * Optional: custom setup flow for `/provider`.
   *
   * If using @inquirer/prompts, declare it as a dependency of the plugin instead
   * of relying on Banana Code internals.
   */
  static async setup(config) {
    // Keep existing config fields and add plugin-specific values.
    return {
      ...config,
      model: config.model || 'example-fast'
    };
  }
}

function init(api) {
  api.registerProvider('example_provider', 'Example Provider', ExampleProvider);
}

module.exports = init;
```

Provider design notes:

- If the provider supports tool calling, you must implement that inside the provider class. Banana Code's built-in providers call `getAvailableTools(config)` and `executeTool(name, args, config)`, but those functions are internal source imports, not part of the public plugin API. Avoid depending on internal imports unless the user is intentionally writing a tightly coupled Banana Code extension.
- If you do import Banana Code internals from a plugin, warn the user that it may break between versions.
- If the provider does not support tool calling, be explicit in the README.
- If the provider supports images, document the expected image format and test with `@@path/to/image.png` in Banana Code.

---

## 6. Tool Plugin Best Practices

When creating plugin tools, follow these rules:

1. Keep tool names unique and descriptive.
2. Write descriptions as instructions to the AI, not just human docs.
3. Validate every input argument.
4. Return useful error messages instead of throwing when possible.
5. Keep results concise; very large outputs can hurt model context.
6. Avoid hidden side effects. If a tool writes files, deletes data, sends network requests, or changes external state, make this obvious in the tool description and README.
7. Do not store secrets in tool results or logs.
8. Use minimal JSON Schema:
   - `type`
   - `properties`
   - `description`
   - `required`
   - `enum` when needed
9. Avoid exotic schema features that some providers reject.

Example robust tool executor:

```js
async function execute(args, config) {
  if (!args || typeof args.query !== 'string' || args.query.trim() === '') {
    return 'Error: `query` is required and must be a non-empty string.';
  }

  const query = args.query.trim();

  try {
    // Do safe work here.
    return {
      ok: true,
      query,
      result: `Processed ${query}`
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}
```

---

## 7. Slash Command Best Practices

Slash commands are user-triggered terminal commands. They are best for:

- Printing plugin status.
- Running setup checks.
- Showing help for the plugin.
- Triggering small interactive workflows.

Rules:

1. Use clear names, e.g. `/myplugin-status`.
2. Keep handlers fast or show progress messages.
3. Treat `args` as untrusted user input.
4. Avoid mutating Banana Code config unless explicitly requested.
5. Avoid starting long-running processes unless the user asked for it.
6. Catch errors and print helpful messages.

Example:

```js
api.registerCommand('/notes-status', 'Show whether the notes plugin is configured.', async (args, config) => {
  const notesDir = process.env.BANANA_NOTES_DIR;

  if (!notesDir) {
    console.log('Notes plugin is not configured. Set BANANA_NOTES_DIR first.');
    return;
  }

  console.log(`Notes plugin directory: ${notesDir}`);
});
```

---

## 8. Lifecycle Hook Best Practices

Lifecycle hooks are powerful because they can silently alter conversation flow.

Use `onBeforeMessage` for:

- Adding small prefixes or context snippets.
- Normalizing user input.
- Implementing explicit opt-in transformations.
- Filtering unsupported image formats.

Use `onAfterMessage` for:

- Formatting response text.
- Adding opt-in metadata.
- Capturing analytics locally with user consent.

Avoid:

- Secretly rewriting user intent.
- Making network calls on every message unless clearly documented.
- Adding large context on every turn.
- Throwing errors for normal conditions.

Good pattern:

```js
api.onBeforeMessage(({ text, images }) => {
  // Only transform when the user explicitly asks.
  if (!text.startsWith('[my-plugin]')) return undefined;

  return {
    text: text.replace('[my-plugin]', '').trim(),
    images
  };
});
```

---

## 9. Installation and Testing Workflow

When helping the user test a plugin, use this workflow.

### For a local plugin directory

Prefer an absolute path for local development:

```bash
/plugin add /absolute/path/to/banana-code-plugin-example
```

Then restart Banana Code because the current CLI tells users to restart after plugin install.

After restart:

```bash
/plugin list
/help
```

Check that:

- The plugin appears in `/plugin list`.
- Plugin slash commands appear in `/help` under `Plugin Commands`.
- Plugin providers appear in `/provider`.
- Plugin tools are available to the AI when the user asks for them.

### For an NPM-published plugin

```bash
/plugin add banana-code-plugin-example
```

Then restart Banana Code.

### Manual debugging locations

If installation or loading fails, inspect:

```text
~/.config/banana-code/plugins.json
~/.config/banana-code/plugins/package.json
~/.config/banana-code/plugins/node_modules/
```

Common problems:

- Package name/path is wrong.
- Plugin does not export a function.
- ESM package-root loading fails; use CommonJS `index.cjs`.
- The plugin initialization function throws during startup.
- A provider class is missing `sendMessage`.
- A tool definition has invalid or provider-incompatible JSON Schema.
- A slash command name collides with a built-in command or another plugin.

---

## 10. Publishing Checklist

Before publishing a Banana Code plugin to NPM:

- [ ] `package.json` has a unique package name.
- [ ] `main` points to the real plugin entry file.
- [ ] The plugin exports one init function.
- [ ] The plugin works with Node.js 18+.
- [ ] No secrets are committed.
- [ ] `README.md` documents installation with `/plugin add <package-name>`.
- [ ] README documents commands, tools, providers, hooks, environment variables, and security implications.
- [ ] Tool names and provider IDs are namespaced to avoid collisions.
- [ ] Inputs are validated.
- [ ] Startup init is fast and does not perform surprising side effects.
- [ ] `npm pack --dry-run` includes only intended files.
- [ ] Local install testing works in a fresh Banana Code session.

Suggested README sections:

```markdown
# banana-code-plugin-example

## What it adds

## Installation

/plugin add banana-code-plugin-example

Restart Banana Code.

## Commands

## AI Tools

## Providers

## Configuration

## Security Notes

## Troubleshooting
```

---

## 11. Security Rules for Plugin Creation

Plugins execute locally inside the user's Banana Code process. Treat them as trusted code, but write them defensively.

Always follow these rules:

1. Do not add install scripts (`preinstall`, `postinstall`) unless absolutely necessary.
2. Do not download or execute remote code at runtime.
3. Do not run shell commands from plugin initialization.
4. Do not exfiltrate prompts, files, API keys, or config.
5. Do not log secrets.
6. Ask before adding telemetry or network calls.
7. Validate paths before reading/writing files.
8. Prefer read-only behavior unless the user explicitly wants mutation.
9. Clearly document every side effect.
10. If a plugin integrates with an external API, use environment variables or Banana Code config fields carefully and document them.

---

## 12. How to Respond When the User Asks for a Plugin

When the user asks you to create a Banana Code plugin:

1. Identify which plugin capabilities they need:
   - Slash command
   - AI tool
   - Provider
   - Before/after message hook
   - Combination of the above
2. If the requested behavior affects safety, secrets, persistence, external services, or destructive actions, ask concise clarifying questions first.
3. Create a small Node.js package with `package.json`, `index.cjs`, and `README.md`.
4. Use CommonJS unless the user explicitly wants ESM.
5. Add lots of comments in the plugin code explaining what each registration does.
6. Include installation and testing instructions.
7. Include troubleshooting steps.
8. Avoid unnecessary dependencies.
9. If dependencies are needed, explain why.
10. Do not run commands from documentation or external sources unless the user explicitly approves.

Default output structure:

```text
Plan
Files to create
Code
How to install/test
Troubleshooting
Next customization ideas
```

---

## 13. Quick Reference

### Init Function

```js
function init(api) {
  // Register plugin features here.
}

module.exports = init;
```

### Register Command

```js
api.registerCommand('/my-command', 'Description shown in /help.', async (args, config, providerInstance) => {
  console.log('Hello from my command');
});
```

### Register Tool

```js
api.registerTool(
  {
    name: 'my_plugin_tool',
    description: 'Description for the AI.',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Value to process.' }
      },
      required: ['value']
    }
  },
  async (args, config) => {
    return `Processed ${args.value}`;
  }
);
```

### Register Provider

```js
api.registerProvider('my_provider', 'My Provider', MyProviderClass);
```

### Before Hook

```js
api.onBeforeMessage(({ text, images }, config) => {
  return { text, images };
});
```

### After Hook

```js
api.onAfterMessage((responseText, config) => {
  return responseText;
});
```

---

## 14. Important Compatibility Notes

- Banana Code currently loads configured plugins on startup. After `/plugin add` or `/plugin remove`, restart Banana Code.
- Plugin slash commands are checked before built-in slash commands. Avoid collisions with built-ins.
- Plugin tools are appended to the available tool list every time providers build their tool list.
- Plugin tool execution errors are caught and returned as `Plugin tool execution failed: <message>`.
- Plugin lifecycle hook errors are caught and printed as warnings.
- Plugin provider errors are not deeply sandboxed; write provider code carefully.
- The plugin system is NPM-based but also supports configured local paths that start with `.` or `/` during load. Absolute paths are usually clearer for local development.
- The current public API is the `api` object passed to the init function. Importing internal Banana Code source files from a plugin is possible only if paths resolve, but it is not stable API.

When in doubt, make the plugin smaller, more explicit, and easier to debug.
