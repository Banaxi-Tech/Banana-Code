// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { execCommand } from './execCommand.js';
import { executeCommandInTerminal, sendToTerminal, terminateTerminalSession } from './terminal.js';
import { getBananaDocs } from './getBananaDocs.js';
import { readFile } from './readFile.js';
import { readManyFiles } from './readManyFiles.js';
import { writeFile } from './writeFile.js';
import { createDirectory } from './createDirectory.js';
import { fetchUrl } from './fetchUrl.js';
import { searchFiles } from './searchFiles.js';
import { listDirectory } from './listDirectory.js';
import { duckDuckGo } from './duckDuckGo.js';
import { duckDuckGoScrape } from './duckDuckGoScrape.js';
import { patchFile } from './patchFile.js';
import { activateSkill } from './activateSkill.js';
import { delegateTask } from './delegateTask.js';
import { bananasplitReview } from './bananasplitReview.js';
import { renameFile } from './renameFile.js';
import { generateImage } from './imageGen.js';
import { requestModelSwitch } from './modelSwitch.js';
import { askUserQuestions } from './askUserQuestions.js';
import { createPlan } from './createPlan.js';
import {
    githubApiRequest,
    githubListRepositories,
    githubGetIssue,
    githubGetPullRequest,
    githubGetFile,
    githubAddIssueComment,
    githubCreatePullRequestReview,
    githubMergePullRequest
} from './github.js';
import {
    browserOpen,
    browserSnapshot,
    browserClick,
    browserType,
    browserPress,
    browserScroll,
    browserBack,
    browserForward,
    browserReload,
    browserClose
} from './browserUse.js';
import { mcpManager } from '../utils/mcp.js';
import { saveMemoryTool, listMemoryTool, deleteMemoryTool, saveProjectMemoryTool, listProjectMemoryTool, deleteProjectMemoryTool } from './memoryTools.js';
import { pluginRegistry } from '../utils/plugins.js';
import { printNewUiToolCall } from '../utils/newUi.js';
import { MODEL_SWITCH_TOOL_NAME, providerSupportsModelSwitch } from '../utils/modelSwitch.js';

const BROWSER_TOOLS = [
    {
        name: 'browser_open',
        label: 'Browser Open',
        description: 'Open a HTTP or HTTPS URL in the visible Banana Code Studio browser and return a page observation.',
        browserUse: true,
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Absolute HTTP or HTTPS URL to open.' }
            },
            required: ['url']
        }
    },
    {
        name: 'browser_snapshot',
        label: 'Browser Snapshot',
        description: 'Inspect the current visible browser page. Returns URL, title, visible text, viewport, screenshot metadata, and clickable/typeable element refs.',
        browserUse: true,
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'browser_click',
        label: 'Browser Click',
        description: 'Click an element in the visible browser. Prefer a ref from browser_snapshot; use x/y viewport coordinates only if no ref is available.',
        browserUse: true,
        parameters: {
            type: 'object',
            properties: {
                ref: { type: 'string', description: 'Element ref returned by browser_snapshot.' },
                x: { type: 'number', description: 'Viewport x coordinate fallback.' },
                y: { type: 'number', description: 'Viewport y coordinate fallback.' }
            }
        }
    },
    {
        name: 'browser_type',
        label: 'Browser Type',
        description: 'Type text into the currently focused browser element.',
        browserUse: true,
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to type.' }
            },
            required: ['text']
        }
    },
    {
        name: 'browser_press',
        label: 'Browser Press',
        description: 'Press a keyboard key in the browser, such as Enter, Tab, Escape, ArrowDown, Backspace, or a single character.',
        browserUse: true,
        parameters: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key name to press.' }
            },
            required: ['key']
        }
    },
    {
        name: 'browser_scroll',
        label: 'Browser Scroll',
        description: 'Scroll the visible browser page by viewport deltas.',
        browserUse: true,
        parameters: {
            type: 'object',
            properties: {
                deltaX: { type: 'number', description: 'Horizontal scroll delta. Defaults to 0.' },
                deltaY: { type: 'number', description: 'Vertical scroll delta. Positive scrolls down. Defaults to 600.' }
            }
        }
    },
    {
        name: 'browser_back',
        label: 'Browser Back',
        description: 'Navigate the visible browser back.',
        browserUse: true,
        parameters: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'browser_forward',
        label: 'Browser Forward',
        description: 'Navigate the visible browser forward.',
        browserUse: true,
        parameters: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'browser_reload',
        label: 'Browser Reload',
        description: 'Reload the visible browser page.',
        browserUse: true,
        parameters: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'browser_close',
        label: 'Browser Close',
        description: 'Close the visible Banana Code Studio browser panel.',
        browserUse: true,
        parameters: { type: 'object', properties: {}, required: [] }
    }
];

const GITHUB_TOOL_NAMES = new Set([
    'github_api_request',
    'github_list_repositories',
    'github_get_issue',
    'github_get_pull_request',
    'github_get_file',
    'github_add_issue_comment',
    'github_create_pull_request_review',
    'github_merge_pull_request'
]);

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
        name: 'execute_command_in_terminal',
        description: 'Execute a command in an interactive terminal session. Useful for commands that require input (like Y/N or package init). Returns a sessionId if the process stays open.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The command to run' },
                cwd: { type: 'string', description: 'The directory to run in (optional)' }
            },
            required: ['command']
        }
    },
    {
        name: 'send_to_terminal',
        description: 'Send input to an active terminal session. Useful for responding to interactive prompts like Y/N. IMPORTANT: You must include "\\n" for Enter.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'The session ID returned by execute_command_in_terminal' },
                input: { type: 'string', description: 'The text to send to stdin (e.g., "Y\\n")' }
            },
            required: ['sessionId', 'input']
        }
    },
    {
        name: 'terminate_terminal_session',
        description: 'Terminate an active terminal session and cleanup resources.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'The session ID to terminate' }
            },
            required: ['sessionId']
        }
    },
    {
        name: 'ask_user_questions',
        label: 'Ask User Questions',
        description: 'Ask the user one or more structured clarification questions using Banana Code\'s selectable terminal UI. Use only when the answer materially affects implementation or planning; avoid using it for routine confirmations or questions you can reasonably infer.',
        parameters: {
            type: 'object',
            properties: {
                questions: {
                    type: 'array',
                    description: 'Clarifying questions to ask now. Ask all foreseeable blocking questions in one call.',
                    items: {
                        type: 'object',
                        properties: {
                            header: {
                                type: 'string',
                                description: 'Short optional label for the question group, such as Language or Scope.'
                            },
                            question: {
                                type: 'string',
                                description: 'The exact question to show the user.'
                            },
                            options: {
                                type: 'array',
                                description: 'Optional selectable answers. Include 2-5 strong choices when possible.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        label: {
                                            type: 'string',
                                            description: 'Short option label.'
                                        },
                                        description: {
                                            type: 'string',
                                            description: 'One short sentence explaining the option.'
                                        }
                                    },
                                    required: ['label']
                                }
                            },
                            allowCustom: {
                                type: 'boolean',
                                description: 'Whether to add a custom free-text answer choice. Defaults to true.'
                            }
                        },
                        required: ['question']
                    }
                }
            },
            required: ['questions']
        }
    },
    {
        name: 'create_plan',
        label: 'Create Plan',
        description: 'Submit the final Goals implementation plan for Banana Code to show in the Ready to code approval menu. In Goals planning mode, call this exactly once after any needed clarification questions. The plan field must contain only the plan itself, not conversational preamble or approval questions.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Optional short title for the plan.'
                },
                plan: {
                    type: 'string',
                    description: 'The complete implementation plan text. Include scope, files to change, ordered steps, validation, and assumptions. Do not include phrases like Shall I implement this plan.'
                }
            },
            required: ['plan']
        }
    },
    {
        name: 'get_banana_docs',
        description: 'Retrieve the official documentation for Banana Code. Use this to answer user questions about app features, slash commands, or setup.',
        parameters: {
            type: 'object',
            properties: {}
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
        name: 'generate_image',
        label: 'ImageGen Stable Diffusion',
        description: 'Generate an image with the configured ImageGen Stable Diffusion server and save it to an output file. Use this when the user asks for a new image asset. The prompt should be vivid and complete; outputPath is where the generated image should be written.',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Detailed image generation prompt.' },
                outputPath: { type: 'string', description: 'Path where the final generated image should be saved, for example assets/hero.png.' },
                steps: { type: 'integer', description: 'Number of diffusion inference steps. Higher is slower and often higher quality. Range: 1-100.' },
                model: { type: 'string', description: 'Optional ImageGen model ID. Defaults to the configured /imagegen model.' },
                size: { type: 'string', description: 'Optional WIDTHxHEIGHT size, for example 1024x1024. Width and height must be divisible by 8.' },
                n: { type: 'integer', description: 'Optional number of images to generate. Range: 1-4.' },
                response_format: { type: 'string', enum: ['url', 'b64_json'], description: 'Optional final image response format from the ImageGen server. Defaults to url.' },
                progress_format: { type: 'string', enum: ['url', 'b64_json', 'none'], description: 'Optional per-step preview format. Defaults to url when streaming progress is available.' },
                progress_interval: { type: 'integer', description: 'Optional interval for progress previews, in diffusion steps. Range: 1-100.' },
                negative_prompt: { type: 'string', description: 'Optional negative prompt.' },
                seed: { type: 'integer', description: 'Optional deterministic seed.' },
                guidance_scale: { type: 'number', description: 'Optional guidance scale. Range: 0-30.' }
            },
            required: ['prompt', 'outputPath']
        }
    },
    {
        name: 'fetch_url',
        description: 'Fetch the text content of a URL via HTTP GET. If Puppeteer fetch is enabled in settings, renders the page first so JavaScript content is available.',
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
        name: 'create_directory',
        description: 'Create a new directory at the specified path. Uses recursive creation if needed.',
        parameters: {
            type: 'object',
            properties: {
                directoryPath: { type: 'string', description: 'The path of the directory to create' }
            },
            required: ['directoryPath']
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
        name: 'bananasplit_review',
        label: 'BananaSplit Cloud Review',
        description: 'Ask the configured BananaSplit cloud model to review the local model\'s recent actions and directly fix real bugs before finalizing.',
        parameters: {
            type: 'object',
            properties: {
                summary: {
                    type: 'string',
                    description: 'Concise summary of what was changed or implemented and what should be reviewed.'
                },
                changedFiles: {
                    type: 'array',
                    description: 'Optional list of files changed by the local model.',
                    items: { type: 'string' }
                },
                concerns: {
                    type: 'string',
                    description: 'Optional specific areas the reviewer should focus on.'
                },
                extraContextReason: {
                    type: 'string',
                    description: 'Optional reason to include broader git diff context. Leave empty unless the local activity log is not enough to review the change.'
                }
            },
            required: ['summary']
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
        name: 'save_project_memory',
        description: 'Persists a fact for the current project only, stored in this workspace. Use this for repo-specific conventions, architecture decisions, commands, naming rules, and other facts that should NOT apply globally.',
        memoryFeature: true,
        parameters: {
            type: 'object',
            properties: {
                fact: { type: 'string', description: 'A concise project-specific fact to remember for this workspace only.' }
            },
            required: ['fact']
        }
    },
    {
        name: 'list_project_memory',
        description: 'Retrieves all memories saved for the current project with their IDs. Use this to review project-only facts or find an ID to delete an outdated project memory.',
        memoryFeature: true,
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'delete_project_memory',
        description: 'Deletes a specific project memory using its ID. Call list_project_memory first to find the ID.',
        memoryFeature: true,
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The exact ID of the project memory to delete.' }
            },
            required: ['id']
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
    },
    {
        name: 'rename_file',
        description: 'Rename or move a file or directory from one path to another.',
        parameters: {
            type: 'object',
            properties: {
                sourcePath: { type: 'string', description: 'The current path of the file or directory.' },
                destinationPath: { type: 'string', description: 'The new path for the file or directory.' }
            },
            required: ['sourcePath', 'destinationPath']
        }
    },
    {
        name: 'github_list_repositories',
        label: 'GitHub List Repositories',
        description: 'List repositories available to the connected GitHub App installation.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'github_get_issue',
        label: 'GitHub Get Issue',
        description: 'Read a GitHub issue, including PR issue metadata when the number belongs to a pull request.',
        parameters: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner or organization.' },
                repo: { type: 'string', description: 'Repository name.' },
                issueNumber: { type: 'integer', description: 'Issue number.' }
            },
            required: ['owner', 'repo', 'issueNumber']
        }
    },
    {
        name: 'github_get_pull_request',
        label: 'GitHub Get Pull Request',
        description: 'Read GitHub pull request metadata.',
        parameters: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner or organization.' },
                repo: { type: 'string', description: 'Repository name.' },
                pullNumber: { type: 'integer', description: 'Pull request number.' }
            },
            required: ['owner', 'repo', 'pullNumber']
        }
    },
    {
        name: 'github_get_file',
        label: 'GitHub Get File',
        description: 'Read a file or directory listing from a repository using the connected GitHub App installation.',
        parameters: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner or organization.' },
                repo: { type: 'string', description: 'Repository name.' },
                path: { type: 'string', description: 'Repository file path.' },
                ref: { type: 'string', description: 'Optional branch, tag, or commit SHA.' }
            },
            required: ['owner', 'repo', 'path']
        }
    },
    {
        name: 'github_add_issue_comment',
        label: 'GitHub Add Issue/PR Comment',
        description: 'Add a top-level comment to a GitHub issue or pull request. Requires user approval before posting.',
        parameters: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner or organization.' },
                repo: { type: 'string', description: 'Repository name.' },
                issueNumber: { type: 'integer', description: 'Issue or pull request number.' },
                body: { type: 'string', description: 'Markdown comment body.' }
            },
            required: ['owner', 'repo', 'issueNumber', 'body']
        }
    },
    {
        name: 'github_create_pull_request_review',
        label: 'GitHub Create PR Review',
        description: 'Create a pull request review with COMMENT, APPROVE, or REQUEST_CHANGES. Requires user approval before submitting.',
        parameters: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner or organization.' },
                repo: { type: 'string', description: 'Repository name.' },
                pullNumber: { type: 'integer', description: 'Pull request number.' },
                event: { type: 'string', enum: ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'], description: 'Review action.' },
                body: { type: 'string', description: 'Review body.' },
                comments: {
                    type: 'array',
                    description: 'Optional inline comments using GitHub REST review comment fields.',
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            position: { type: 'integer' },
                            line: { type: 'integer' },
                            side: { type: 'string' },
                            start_line: { type: 'integer' },
                            start_side: { type: 'string' },
                            body: { type: 'string' }
                        },
                        required: ['path', 'body']
                    }
                }
            },
            required: ['owner', 'repo', 'pullNumber']
        }
    },
    {
        name: 'github_merge_pull_request',
        label: 'GitHub Merge PR',
        description: 'Merge a GitHub pull request with merge, squash, or rebase. Requires user approval before merging.',
        parameters: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner or organization.' },
                repo: { type: 'string', description: 'Repository name.' },
                pullNumber: { type: 'integer', description: 'Pull request number.' },
                mergeMethod: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Merge method. Defaults to merge.' },
                commitTitle: { type: 'string', description: 'Optional merge commit title.' },
                commitMessage: { type: 'string', description: 'Optional merge commit message.' }
            },
            required: ['owner', 'repo', 'pullNumber']
        }
    },
    {
        name: 'github_api_request',
        label: 'GitHub REST API Request',
        description: 'Make an authenticated GitHub REST API request scoped to the connected GitHub App installation. Use exact API paths like /repos/owner/repo/issues/1/comments. Mutating methods require user approval.',
        parameters: {
            type: 'object',
            properties: {
                method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP method. Defaults to GET.' },
                path: { type: 'string', description: 'GitHub REST API path beginning with /repos/ or /installation/repositories.' },
                body: { type: 'object', description: 'Optional JSON request body.' }
            },
            required: ['path']
        }
    },
    {
        name: MODEL_SWITCH_TOOL_NAME,
        label: 'Request Model Switch',
        description: 'Recommend switching to another model for the current provider. This pauses for user approval before switching; if declined, continue with the current model.',
        parameters: {
            type: 'object',
            properties: {
                recommendedModel: {
                    type: 'string',
                    description: 'Exact model ID to switch to. Must be one of the model IDs listed in the system prompt for the current provider.'
                },
                reason: {
                    type: 'string',
                    description: 'One brief sentence explaining why this model is a better fit than the current model.'
                }
            },
            required: ['recommendedModel', 'reason']
        }
    }
];

export function getAvailableTools(config = {}) {
    const browserUseAvailable = config.isApiMode === true
        && config.browserUse?.enabled !== false
        && config.browserController?.available === true;
    const toolDefinitions = browserUseAvailable ? TOOLS.concat(BROWSER_TOOLS) : TOOLS;

    let available = toolDefinitions.filter(tool => {
        if (tool.browserUse && !browserUseAvailable) return false;
        if (GITHUB_TOOL_NAMES.has(tool.name) && config.github?.enabled !== true) return false;
        if (tool.name === 'ask_user_questions' && config.isApiMode) return false;
        if (tool.name === 'create_plan' && !config.goalsPlanningMode) return false;
        if (tool.name === 'bananasplit_review' && config.bananaSplit?.enabled !== true) return false;
        if (tool.name === 'generate_image' && config.imageGen?.enabled !== true) return false;
        if (tool.name === MODEL_SWITCH_TOOL_NAME && !providerSupportsModelSwitch(config)) return false;
        if (config.goalsPlanningMode) {
            const allowedInGoalsPlanning = [
                'ask_user_questions',
                'create_plan',
                'read_file',
                'read_many_files',
                'search_files',
                'list_directory',
                'fetch_url',
                'duck_duck_go',
                'duck_duck_go_scrape',
                'get_banana_docs',
                'activate_skill',
                'github_list_repositories',
                'github_get_issue',
                'github_get_pull_request',
                'github_get_file',
                MODEL_SWITCH_TOOL_NAME
            ];
            if (!allowedInGoalsPlanning.includes(tool.name)) return false;
        }
        if (config.bananaSplitReviewerMode) {
            const allowedForBananaSplitReview = [
                'read_file', 'read_many_files', 'search_files',
                'list_directory', 'patch_file', 'write_file', 'get_banana_docs'
            ];
            if (!allowedForBananaSplitReview.includes(tool.name)) return false;
        }
        if (config.askMode) {
            const forbiddenInAskMode = ['write_file', 'patch_file'];
            if (forbiddenInAskMode.includes(tool.name)) return false;
        }
        if (config.deepReviewMode === 'full' || config.deepReviewMode === 'diff') {
            const allowedInDeepReview = [
                'read_file', 'read_many_files', 'search_files', 'list_directory',
                'execute_command', 'get_banana_docs', 'activate_skill',
                'github_list_repositories', 'github_get_issue',
                'github_get_pull_request', 'github_get_file'
            ];
            if (!allowedInDeepReview.includes(tool.name)) return false;
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

    // Add dynamically registered plugin tools
    for (const [name, toolObj] of Object.entries(pluginRegistry.tools)) {
        available.push(toolObj.definition);
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
    printNewUiToolCall(name, args, config);

    // Check if it's an MCP tool first
    if (config.betaTools && config.betaTools.includes('mcp_support')) {
        const mcpTools = mcpManager.getTools();
        if (mcpTools.some(t => t.name === name)) {
            return await mcpManager.callTool(name, args);
        }
    }

    // Check if it's a plugin tool
    if (pluginRegistry.tools[name]) {
        try {
            return await pluginRegistry.tools[name].execute(args, config);
        } catch (e) {
            return `Plugin tool execution failed: ${e.message}`;
        }
    }

    switch (name) {
        case 'execute_command': return await execCommand(args);
        case 'execute_command_in_terminal': return await executeCommandInTerminal(args);
        case 'send_to_terminal': return await sendToTerminal(args);
        case 'terminate_terminal_session': return await terminateTerminalSession(args);
        case 'ask_user_questions': return await askUserQuestions(args);
        case 'create_plan': return await createPlan(args);
        case 'get_banana_docs': return await getBananaDocs(args);
        case 'read_file': return await readFile(args);
        case 'read_many_files': return await readManyFiles(args);
        case 'write_file': return await writeFile(args);
        case 'fetch_url': return await fetchUrl(args, config);
        case 'search_files': return await searchFiles(args);
        case 'create_directory': return await createDirectory(args);
        case 'list_directory': return await listDirectory(args);
        case 'duck_duck_go': return await duckDuckGo(args);
        case 'duck_duck_go_scrape': return await duckDuckGoScrape(args);
        case 'patch_file': return await patchFile(args);
        case 'activate_skill': return await activateSkill(args);
        case 'delegate_task': return await delegateTask(args, config);
        case 'bananasplit_review': return await bananasplitReview(args, config);
        case 'save_memory': return await saveMemoryTool(args);
        case 'list_memory': return await listMemoryTool(args);
        case 'delete_memory': return await deleteMemoryTool(args);
        case 'save_project_memory': return await saveProjectMemoryTool(args);
        case 'list_project_memory': return await listProjectMemoryTool(args);
        case 'delete_project_memory': return await deleteProjectMemoryTool(args);
        case 'rename_file': return await renameFile(args);
        case 'github_api_request': return await githubApiRequest(args, config);
        case 'github_list_repositories': return await githubListRepositories(args, config);
        case 'github_get_issue': return await githubGetIssue(args, config);
        case 'github_get_pull_request': return await githubGetPullRequest(args, config);
        case 'github_get_file': return await githubGetFile(args, config);
        case 'github_add_issue_comment': return await githubAddIssueComment(args, config);
        case 'github_create_pull_request_review': return await githubCreatePullRequestReview(args, config);
        case 'github_merge_pull_request': return await githubMergePullRequest(args, config);
        case 'generate_image': return await generateImage(args, config);
        case 'browser_open': return await browserOpen(args, config);
        case 'browser_snapshot': return await browserSnapshot(args, config);
        case 'browser_click': return await browserClick(args, config);
        case 'browser_type': return await browserType(args, config);
        case 'browser_press': return await browserPress(args, config);
        case 'browser_scroll': return await browserScroll(args, config);
        case 'browser_back': return await browserBack(args, config);
        case 'browser_forward': return await browserForward(args, config);
        case 'browser_reload': return await browserReload(args, config);
        case 'browser_close': return await browserClose(args, config);
        case MODEL_SWITCH_TOOL_NAME: return await requestModelSwitch(args, config);
        default: return `Unknown tool: ${name}`;
    }
}
