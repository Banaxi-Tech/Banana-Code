// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

export const USER_SKILLS_DIR = path.join(os.homedir(), '.config', 'banana-code', 'skills');
export const BUNDLED_SKILLS_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'skills'
);

function parseBooleanFrontmatter(frontmatter, key, defaultValue = true) {
    const match = frontmatter.match(new RegExp(`${key}:\\s*['"]?([^'"\n]+)['"]?`));
    if (!match) return defaultValue;

    const value = match[1].trim().toLowerCase();
    if (['false', 'no', 'off', 'disabled'].includes(value)) return false;
    if (['true', 'yes', 'on', 'enabled'].includes(value)) return true;
    return defaultValue;
}

function ensureDirectory(dir) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return true;
    } catch (e) {
        return false;
    }
}

function parseSkill(skillPath, entryName) {
    const mdPath = path.join(skillPath, 'SKILL.md');

    if (!fs.existsSync(mdPath)) return null;

    try {
        const content = fs.readFileSync(mdPath, 'utf8');
        // Match YAML frontmatter between --- and ---
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

        if (!match) return null;

        const frontmatter = match[1];
        const body = content.slice(match[0].length).trim();

        // Simple YAML parsing via regex
        const nameMatch = frontmatter.match(/name:\s*['"]?([^'"\n]+)['"]?/);
        const descMatch = frontmatter.match(/description:\s*['"]?([^'"\n]+)['"]?/);

        if (!nameMatch || !descMatch) return null;

        return {
            id: entryName,
            name: nameMatch[1].trim(),
            description: descMatch[1].trim(),
            instructions: body,
            path: skillPath,
            defaultAutoLoad: parseBooleanFrontmatter(frontmatter, 'defaultAutoLoad', true)
        };
    } catch (err) {
        // Skip corrupted or unreadable skills
        return null;
    }
}

function readSkillsFromDirectory(skillsDir) {
    let skills = [];

    try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skill = parseSkill(path.join(skillsDir, entry.name), entry.name);
            if (skill) skills.push(skill);
        }
    } catch (e) {}

    return skills;
}

function getDefaultSkillConfig(config = {}) {
    return {
        enabled: Array.isArray(config.defaultSkills?.enabled) ? config.defaultSkills.enabled : [],
        disabled: Array.isArray(config.defaultSkills?.disabled) ? config.defaultSkills.disabled : []
    };
}

function skillMatchesIdOrName(skill, values) {
    return values.includes(skill.id) || values.includes(skill.name);
}

export function isBundledSkillEnabled(skill, config = {}) {
    const defaultSkills = getDefaultSkillConfig(config);

    if (skillMatchesIdOrName(skill, defaultSkills.disabled)) {
        return false;
    }

    if (skillMatchesIdOrName(skill, defaultSkills.enabled)) {
        return true;
    }

    return skill.defaultAutoLoad !== false;
}

export function getBundledSkills({ bundledSkillsDir = BUNDLED_SKILLS_DIR } = {}) {
    return readSkillsFromDirectory(bundledSkillsDir);
}

/**
 * Scans user and bundled skill directories and parses SKILL.md files.
 * User skills take precedence over bundled skills with the same directory ID
 * or frontmatter name.
 * @returns {Array} List of discovered skills.
 */
export function getAvailableSkills({
    userSkillsDir = USER_SKILLS_DIR,
    bundledSkillsDir = BUNDLED_SKILLS_DIR,
    config = {}
} = {}) {
    const skills = ensureDirectory(userSkillsDir) ? readSkillsFromDirectory(userSkillsDir) : [];
    const seenIds = new Set(skills.map(skill => skill.id));
    const seenNames = new Set(skills.map(skill => skill.name));

    for (const skill of getBundledSkills({ bundledSkillsDir })) {
        if (seenIds.has(skill.id) || seenNames.has(skill.name)) {
            continue;
        }
        if (!isBundledSkillEnabled(skill, config)) {
            continue;
        }
        skills.push(skill);
        seenIds.add(skill.id);
        seenNames.add(skill.name);
    }

    return skills;
}
