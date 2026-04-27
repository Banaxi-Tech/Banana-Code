import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import ora from 'ora';

const PLUGINS_DIR = path.join(os.homedir(), '.config', 'banana-code', 'plugins');
const PLUGINS_JSON_PATH = path.join(os.homedir(), '.config', 'banana-code', 'plugins.json');

// Global plugin registry
export const pluginRegistry = {
    providers: {}, // id -> { name, ProviderClass }
    commands: {}, // '/command' -> { description, handler }
    tools: {}, // name -> { definition, execute }
    lifecycleHooks: {
        onBeforeMessage: [], // functions
        onAfterMessage: [] // functions
    }
};

/**
 * Ensures the plugins directory and config exist.
 */
function ensurePluginEnvironment() {
    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
    
    const packageJsonPath = path.join(PLUGINS_DIR, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(packageJsonPath, JSON.stringify({
            name: "banana-code-plugins",
            version: "1.0.0",
            description: "Auto-generated package.json for Banana Code plugins",
            dependencies: {}
        }, null, 2));
    }

    if (!fs.existsSync(PLUGINS_JSON_PATH)) {
        fs.writeFileSync(PLUGINS_JSON_PATH, JSON.stringify([], null, 2));
    }
}

/**
 * Gets the list of configured plugins from plugins.json
 */
export function getConfiguredPlugins() {
    try {
        const content = fs.readFileSync(PLUGINS_JSON_PATH, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        return [];
    }
}

/**
 * Saves the list of plugins to plugins.json
 */
function saveConfiguredPlugins(plugins) {
    fs.writeFileSync(PLUGINS_JSON_PATH, JSON.stringify(plugins, null, 2));
}

// Helper to run npm asynchronously without blocking the event loop or the spinner
function runNpmCommand(args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn('npm', args, { cwd, shell: process.platform === 'win32' });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`npm ${args[0]} failed with code ${code}`));
        });
        proc.on('error', reject);
    });
}

/**
 * Adds and installs a new plugin package.
 */
export async function installPlugin(packageName) {
    ensurePluginEnvironment();
    const plugins = getConfiguredPlugins();
    
    if (plugins.includes(packageName)) {
        console.log(chalk.yellow(`Plugin ${packageName} is already installed.`));
        return false;
    }

    // Security: Validate package name to prevent shell injection on Windows
    if (!/^[a-z0-9@/._-]+$/i.test(packageName)) {
        console.log(chalk.red(`Invalid package name: ${packageName}`));
        return false;
    }

    const spinner = ora({ text: `Installing plugin ${chalk.cyan(packageName)}...`, color: 'yellow' }).start();
    try {
        await runNpmCommand(['install', packageName], PLUGINS_DIR);
        plugins.push(packageName);
        saveConfiguredPlugins(plugins);
        spinner.succeed(`Successfully installed plugin ${chalk.green(packageName)}`);
        return true;
    } catch (err) {
        spinner.fail(`Failed to install plugin ${chalk.red(packageName)}: ${err.message}`);
        return false;
    }
}

/**
 * Removes and uninstalls a plugin package.
 */
export async function removePlugin(packageName) {
    ensurePluginEnvironment();
    const plugins = getConfiguredPlugins();
    
    if (!plugins.includes(packageName)) {
        console.log(chalk.yellow(`Plugin ${packageName} is not installed.`));
        return false;
    }

    // Security: Validate package name
    if (!/^[a-z0-9@/._-]+$/i.test(packageName)) {
        console.log(chalk.red(`Invalid package name: ${packageName}`));
        return false;
    }

    const spinner = ora({ text: `Removing plugin ${chalk.cyan(packageName)}...`, color: 'yellow' }).start();
    try {
        await runNpmCommand(['uninstall', packageName], PLUGINS_DIR);
        const newPlugins = plugins.filter(p => p !== packageName);
        saveConfiguredPlugins(newPlugins);
        spinner.succeed(`Successfully removed plugin ${chalk.green(packageName)}`);
        return true;
    } catch (err) {
        spinner.fail(`Failed to remove plugin ${chalk.red(packageName)}: ${err.message}`);
        return false;
    }
}

/**
 * The API object passed to plugins.
 */
function createPluginAPI(pluginName) {
    return {
        registerProvider: (id, name, ProviderClass) => {
            pluginRegistry.providers[id] = { name, ProviderClass, source: pluginName };
        },
        registerCommand: (command, description, handler) => {
            if (!command.startsWith('/')) {
                command = '/' + command;
            }
            pluginRegistry.commands[command] = { description, handler, source: pluginName };
        },
        registerTool: (toolDefinition, executeFunction) => {
            pluginRegistry.tools[toolDefinition.name] = { definition: toolDefinition, execute: executeFunction, source: pluginName };
        },
        onBeforeMessage: (handler) => {
            pluginRegistry.lifecycleHooks.onBeforeMessage.push(handler);
        },
        onAfterMessage: (handler) => {
            pluginRegistry.lifecycleHooks.onAfterMessage.push(handler);
        }
    };
}

/**
 * Loads all configured plugins on startup.
 */
export async function loadPlugins() {
    ensurePluginEnvironment();
    const plugins = getConfiguredPlugins();
    
    if (plugins.length === 0) return;

    const spinner = ora({ text: 'Loading plugins...', color: 'yellow' }).start();
    let loadedCount = 0;

    for (const plugin of plugins) {
        try {
            // Determine the import path
            // NPM installs modules into PLUGINS_DIR/node_modules/
            let modulePath = path.join(PLUGINS_DIR, 'node_modules', plugin);
            
            // Check if it's a local path (starts with . or /)
            if (plugin.startsWith('.') || plugin.startsWith('/')) {
                modulePath = path.resolve(process.cwd(), plugin);
            }

            // Read the package.json of the plugin to find the main entry point if needed
            // Dynamic import requires a file URL on Windows usually, but on Linux absolute paths work.
            const fileUrl = pathToFileURL(modulePath).href;
            
            let pluginModule;
            try {
                 pluginModule = await import(fileUrl);
            } catch(e) {
                 if (e.code === 'ERR_REQUIRE_ESM') {
                     throw e; // Do not fallback to CJS if it's an ESM error
                 }
                 // Try requiring by standard module resolution within the plugins dir if the direct path fails
                 const { createRequire } = await import('module');
                 const require = createRequire(path.join(PLUGINS_DIR, 'package.json'));
                 pluginModule = require(plugin);
            }

            const initFn = pluginModule.default || pluginModule.init || pluginModule;
            if (typeof initFn === 'function') {
                const api = createPluginAPI(plugin);
                await initFn(api);
                loadedCount++;
            } else {
                spinner.warn(`Plugin ${plugin} does not export a default initialization function.`);
                spinner.start('Loading remaining plugins...');
            }
        } catch (err) {
            spinner.fail(`Failed to load plugin ${plugin}: ${err.message}`);
            spinner.start('Loading remaining plugins...');
        }
    }

    if (loadedCount > 0) {
        spinner.succeed(`Loaded ${loadedCount} plugin(s).`);
    } else {
        spinner.fail('No plugins loaded successfully.');
    }
}
