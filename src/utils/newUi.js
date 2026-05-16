// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import chalk from 'chalk';

const TOOL_LABELS = {
    execute_command: 'RunCommand',
    execute_command_in_terminal: 'Terminal',
    send_to_terminal: 'TerminalInput',
    terminate_terminal_session: 'TerminateTerminal',
    ask_user_questions: 'AskUser',
    create_plan: 'CreatePlan',
    get_banana_docs: 'GetBananaDocs',
    read_file: 'ReadFile',
    read_many_files: 'ReadManyFiles',
    write_file: 'WriteFile',
    generate_image: 'ImageGen',
    fetch_url: 'Fetch',
    search_files: 'Search',
    create_directory: 'CreateDirectory',
    list_directory: 'List',
    duck_duck_go: 'DuckDuckGo',
    duck_duck_go_scrape: 'DuckDuckGoScrape',
    patch_file: 'patch_file',
    activate_skill: 'ActivateSkill',
    delegate_task: 'DelegateTask',
    bananasplit_review: 'BananaSplitReview',
    save_memory: 'SaveMemory',
    list_memory: 'ListMemory',
    delete_memory: 'DeleteMemory',
    save_project_memory: 'SaveProjectMemory',
    list_project_memory: 'ListProjectMemory',
    delete_project_memory: 'DeleteProjectMemory',
    rename_file: 'RenameFile',
    github_api_request: 'GitHubAPI',
    github_list_repositories: 'GitHubRepos',
    github_get_issue: 'GitHubIssue',
    github_get_pull_request: 'GitHubPR',
    github_get_file: 'GitHubFile',
    github_add_issue_comment: 'GitHubComment',
    github_create_pull_request_review: 'GitHubReview',
    github_merge_pull_request: 'GitHubMerge',
    change_banana_setting: 'Settings',
    request_model_switch: 'ModelSwitch',
    browser_open: 'BrowserOpen',
    browser_snapshot: 'BrowserSnapshot',
    browser_click: 'BrowserClick',
    browser_type: 'BrowserType',
    browser_press: 'BrowserPress',
    browser_scroll: 'BrowserScroll',
    browser_back: 'BrowserBack',
    browser_forward: 'BrowserForward',
    browser_reload: 'BrowserReload',
    browser_close: 'BrowserClose'
};

export function isNewUiEnabled(config = global.bananaConfig) {
    return !process.argv.includes('--oldui');
}

export function stripAnsi(text) {
    return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

export function getTermWidth() {
    return process.stdout.columns || 80;
}

export function padLine(text, width) {
    const stripped = stripAnsi(text);
    return text + ' '.repeat(Math.max(0, width - stripped.length));
}

export function truncatePlain(text, width) {
    const value = String(text || '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, Math.max(0, width));
    return value.slice(0, width - 1) + '…';
}

function snakeToPascal(name) {
    return String(name || 'tool')
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function compact(value, max = 80) {
    return truncatePlain(String(value || '').replace(/\s+/g, ' ').trim(), max);
}

function repoRef(args = {}) {
    if (!args.owner || !args.repo) return '';
    if (args.pullNumber) return `${args.owner}/${args.repo}#${args.pullNumber}`;
    if (args.issueNumber) return `${args.owner}/${args.repo}#${args.issueNumber}`;
    if (args.path) return `${args.owner}/${args.repo}/${args.path}`;
    return `${args.owner}/${args.repo}`;
}

function toolTarget(name, args = {}) {
    switch (name) {
        case 'execute_command':
        case 'execute_command_in_terminal':
            return compact(args.command, 90);
        case 'send_to_terminal':
        case 'terminate_terminal_session':
            return compact(args.sessionId, 60);
        case 'read_file':
        case 'write_file':
        case 'patch_file':
            return compact(args.filepath, 90);
        case 'read_many_files':
            return Array.isArray(args.filepaths) ? `${args.filepaths.length} files` : '';
        case 'list_directory':
            return compact(args.directoryPath || '.', 90);
        case 'search_files':
            return compact(`${args.directory || '.'} for ${args.pattern || ''}`, 90);
        case 'fetch_url':
        case 'browser_open':
            return compact(args.url, 90);
        case 'create_directory':
            return compact(args.directoryPath, 90);
        case 'rename_file':
            return compact(`${args.sourcePath || ''} -> ${args.destinationPath || ''}`, 90);
        case 'duck_duck_go':
        case 'duck_duck_go_scrape':
            return compact(args.query, 90);
        case 'change_banana_setting':
            return compact(`${args.enabled ? 'enable' : 'disable'} ${args.setting || ''}`, 90);
        case 'activate_skill':
            return compact(args.skillName, 60);
        case 'delegate_task':
            return compact(args.agentType || 'generalist', 40);
        case 'generate_image':
            return compact(args.outputPath || args.prompt, 90);
        case 'save_memory':
        case 'save_project_memory':
            return compact(args.fact, 90);
        case 'delete_memory':
        case 'delete_project_memory':
            return compact(args.id, 60);
        case 'github_api_request':
            return compact(`${args.method || 'GET'} ${args.path || ''}`, 90);
        case 'github_list_repositories':
            return '';
        case 'github_get_issue':
        case 'github_get_pull_request':
        case 'github_get_file':
        case 'github_add_issue_comment':
        case 'github_create_pull_request_review':
        case 'github_merge_pull_request':
            return compact(repoRef(args), 90);
        case 'request_model_switch':
            return compact(args.recommendedModel || args.model, 80);
        case 'browser_click':
            return compact(args.ref || [args.x, args.y].filter(v => v !== undefined).join(','), 60);
        case 'browser_type':
            return compact(args.text, 60);
        case 'browser_press':
            return compact(args.key, 30);
        case 'browser_scroll':
            return compact(`x:${args.deltaX || 0} y:${args.deltaY || 600}`, 40);
        default:
            return '';
    }
}

export function formatNewUiToolCall(name, args = {}) {
    const label = TOOL_LABELS[name] || snakeToPascal(name);
    const target = toolTarget(name, args);
    return `${label}(${target || ''})`;
}

export function printNewUiToolCall(name, args = {}, config = global.bananaConfig) {
    if (!isNewUiEnabled(config) || config?.isApiMode) return;
    process.stdout.write('\x1b[0m');
    console.log(chalk.cyan(`\n● ${formatNewUiToolCall(name, args)}`));
}

export function queueNewUiAssistantMarker(config = global.bananaConfig) {
    if (!isNewUiEnabled(config) || config?.isApiMode) return;
    global.bananaPendingAssistantMarker = true;
}

export function printNewUiAssistantMarkerIfNeeded(config = global.bananaConfig) {
    if (!isNewUiEnabled(config) || config?.isApiMode || !global.bananaPendingAssistantMarker) return false;
    process.stdout.write(chalk.cyan('● '));
    global.bananaPendingAssistantMarker = false;
    return true;
}

export function writeNewUiAssistantChunk(content, config = global.bananaConfig) {
    let text = String(content || '');
    const printedMarker = printNewUiAssistantMarkerIfNeeded(config);
    if (printedMarker) {
        text = text.replace(/^[\r\n]+/, '');
    }
    process.stdout.write(chalk.cyan(text));
}
