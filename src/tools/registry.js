import { execCommand } from './execCommand.js';
import { readFile } from './readFile.js';
import { readManyFiles } from './readManyFiles.js';
import { writeFile } from './writeFile.js';
import { fetchUrl } from './fetchUrl.js';
import { searchFiles } from './searchFiles.js';
import { listDirectory } from './listDirectory.js';
import { duckDuckGo } from './duckDuckGo.js';
import { duckDuckGoScrape } from './duckDuckGoScrape.js';
import { patchFile } from './patchFile.js';
import { activateSkill } from './activateSkill.js';
import { delegateTask } from './delegateTask.js';
import { mcpManager } from '../utils/mcp.js';
import { saveMemoryTool, listMemoryTool, deleteMemoryTool } from './memoryTools.js';

export const TOOLS = [
    {
        name: 'execute_command',
        description: 'Execute a shell command on the local machine.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The shell command to run' },
                cwd: { type: 'string', description: 'The directory to run in (optional)' }
            },
            required: ['command']
        }
    },
    {
        name: 'read_file',
        description: 'Read the contents of a file.',
        parameters: {
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'Path to the file to read' }
            },
            required: ['filepath']
        }
    },
    {
        name: 'read_many_files',
        description: 'Read the contents of multiple files at once.',
        parameters: {
            type: 'object',
            properties: {
                filepaths: {
                    type: 'array',
                    description: 'List of file paths to read',
                    items: { type: 'string' }
                }
            },
            required: ['filepaths']
        }
    },
    {
        name: 'write_file',
        description: 'Write content to a file. Overwrites existing content.',
        parameters: {
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'Path to the file to write to' },
                content: { type: 'string', description: 'The content to write' }
            },
            required: ['filepath', 'content']
        }
    },
    {
        name: 'fetch_url',
        description: 'Fetch the text content of a URL via HTTP GET.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to fetch' }
            },
            required: ['url']
        }
    },
    {
        name: 'search_files',
        description: 'Search for a regex pattern across files in a directory.',
        parameters: {
            type: 'object',
            properties: {
                directory: { type: 'string', description: 'The directory to search in' },
                pattern: { type: 'string', description: 'The regex pattern to search for' }
            },
            required: ['directory', 'pattern']
        }
    },
    {
        name: 'list_directory',
        description: 'List contents of a directory (files and subdirectories).',
        parameters: {
            type: 'object',
            properties: {
                directoryPath: { type: 'string', description: 'The path to list' }
            },
            required: ['directoryPath']
        }
    },
    {
        name: 'duck_duck_go',
        label: 'DuckDuckGo Quick Answer',
        description: 'Search for quick answers using DuckDuckGo API.',
        beta: true,
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        }
    },
    {
        name: 'duck_duck_go_scrape',
        label: 'DuckDuckGo Scrape (Lite)',
        description: 'Perform a full search on DuckDuckGo Lite and extract result links.',
        beta: true,
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        }
    },
    {
        name: 'patch_file',
        label: 'Surgical File Patch',
        description: 'Edit a file by replacing specific sections of text. Much more efficient for large files.',
        settingsFeature: 'usePatchFile',
        parameters: {
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'Path to the file to patch' },
                edits: {
                    type: 'array',
                    description: 'List of edits to perform in order',
                    items: {
                        type: 'object',
                        properties: {
                            oldText: { type: 'string', description: 'The exact text to find (including whitespace/indentation)' },
                            newText: { type: 'string', description: 'The text to replace it with' },
                            occurrence: { 
                                type: 'integer', 
                                description: 'Which occurrence of oldText to replace (1-based). Use 0 to replace all occurrences.',
                                default: 1 
                            }
                        },
                        required: ['oldText', 'newText']
                    }
                }
            },
            required: ['filepath', 'edits']
        }
    },
    {
        name: 'activate_skill',
        description: 'Activates a specialized agent skill by name. Returns the skill\'s instructions wrapped in <activated_skill> tags. These provide specialized guidance for the current task.',
        parameters: {
            type: 'object',
            properties: {
                skillName: { type: 'string', description: 'The name or ID of the skill to activate.' }
            },
            required: ['skillName']
        }
    },
    {
        name: 'delegate_task',
        label: 'Sub-Agent Delegation (Beta)',
        description: 'Spawns a specialized sub-agent to handle a specific sub-task. Use this for complex research, big code changes, or detailed reviews to keep the main context clean.',
        beta: true,
        parameters: {
            type: 'object',
            properties: {
                task: { type: 'string', description: 'The specific, detailed instruction for the sub-agent.' },
                agentType: { 
                    type: 'string', 
                    description: 'The type of specialist to spawn.',
                    enum: ['researcher', 'coder', 'reviewer', 'generalist']
                },
                contextFiles: {
                    type: 'array',
                    description: 'Optional list of file paths to provide as initial context to the sub-agent.',
                    items: { type: 'string' }
                }
            },
            required: ['task']
        }
    },
    {
        name: 'save_memory',
        description: 'Persists a fact across ALL future sessions globally. Use this ONLY to save facts or preferences you want to permanently remember across different projects. Do NOT use for session-specific or temporary data.',
        memoryFeature: true,
        parameters: {
            type: 'object',
            properties: {
                fact: { type: 'string', description: 'A concise fact or preference to remember globally.' }
            },
            required: ['fact']
        }
    },
    {
        name: 'list_memory',
        description: 'Retrieves all globally saved memories with their IDs. Use this to review facts you have saved or find an ID to delete an outdated fact.',
        memoryFeature: true,
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'delete_memory',
        description: 'Deletes a specific global memory using its ID. Call list_memory first to find the ID.',
        memoryFeature: true,
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The exact ID of the memory to delete.' }
            },
            required: ['id']
        }
    }
];

export function getAvailableTools(config = {}) {
    let available = TOOLS.filter(tool => {
        if (config.askMode) {
            const forbiddenInAskMode = ['write_file', 'patch_file'];
            if (forbiddenInAskMode.includes(tool.name)) return false;
        }
        if (tool.beta) {
            return config.betaTools && config.betaTools.includes(tool.name);
        }
        if (tool.memoryFeature) {
            return config.useMemory !== false;
        }
        if (tool.settingsFeature) {
            // Default to true if not explicitly set to false
            return config[tool.settingsFeature] !== false;
        }
        return true;
    });

    // Add MCP tools if enabled in beta
    if (config.betaTools && config.betaTools.includes('mcp_support')) {
        const mcpTools = mcpManager.getTools().map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
            isMcp: true
        }));
        available = available.concat(mcpTools);
    }

    return available;
}

/**
 * Some providers (Gemini, Ollama) are extremely strict about JSON Schema.
 * They will throw a 400 if they see "additionalProperties", "$schema", or other unknown fields.
 */
export function sanitizeSchemaForStrictAPIs(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const sanitized = Array.isArray(schema) ? [] : {};

    for (const [key, value] of Object.entries(schema)) {
        // Skip keys that strict APIs don't support
        if (key === 'additionalProperties' || key === '$schema' || key === 'const') {
            continue;
        }

        if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeSchemaForStrictAPIs(value);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

export async function executeTool(name, args, config) {
    // Check if it's an MCP tool first
    if (config.betaTools && config.betaTools.includes('mcp_support')) {
        const mcpTools = mcpManager.getTools();
        if (mcpTools.some(t => t.name === name)) {
            return await mcpManager.callTool(name, args);
        }
    }

    switch (name) {
        case 'execute_command': return await execCommand(args);
        case 'read_file': return await readFile(args);
        case 'read_many_files': return await readManyFiles(args);
        case 'write_file': return await writeFile(args);
        case 'fetch_url': return await fetchUrl(args);
        case 'search_files': return await searchFiles(args);
        case 'list_directory': return await listDirectory(args);
        case 'duck_duck_go': return await duckDuckGo(args);
        case 'duck_duck_go_scrape': return await duckDuckGoScrape(args);
        case 'patch_file': return await patchFile(args);
        case 'activate_skill': return await activateSkill(args);
        case 'delegate_task': return await delegateTask(args, config);
        case 'save_memory': return await saveMemoryTool(args);
        case 'list_memory': return await listMemoryTool(args);
        case 'delete_memory': return await deleteMemoryTool(args);
        default: return `Unknown tool: ${name}`;
    }
}
