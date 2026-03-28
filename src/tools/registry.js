import { execCommand } from './execCommand.js';
import { readFile } from './readFile.js';
import { writeFile } from './writeFile.js';
import { fetchUrl } from './fetchUrl.js';
import { searchFiles } from './searchFiles.js';
import { listDirectory } from './listDirectory.js';
import { duckDuckGo } from './duckDuckGo.js';
import { duckDuckGoScrape } from './duckDuckGoScrape.js';
import { patchFile } from './patchFile.js';

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
        label: 'Surgical File Patch (Beta)',
        description: 'Edit a file by replacing specific sections of text. Much more efficient for large files.',
        beta: true,
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
    }
];

export function getAvailableTools(config = {}) {
    return TOOLS.filter(tool => {
        if (tool.beta) {
            return config.betaTools && config.betaTools.includes(tool.name);
        }
        return true;
    });
}

export async function executeTool(name, args) {
    switch (name) {
        case 'execute_command': return await execCommand(args);
        case 'read_file': return await readFile(args);
        case 'write_file': return await writeFile(args);
        case 'fetch_url': return await fetchUrl(args);
        case 'search_files': return await searchFiles(args);
        case 'list_directory': return await listDirectory(args);
        case 'duck_duck_go': return await duckDuckGo(args);
        case 'duck_duck_go_scrape': return await duckDuckGoScrape(args);
        case 'patch_file': return await patchFile(args);
        default: return `Unknown tool: ${name}`;
    }
}
