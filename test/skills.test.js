// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getAvailableSkills, getBundledSkills, isBundledSkillEnabled } from '../src/utils/skills.js';

async function writeSkill(skillsDir, id, name, description = `Description for ${name}`, options = {}) {
    const skillDir = path.join(skillsDir, id);
    await fs.mkdir(skillDir, { recursive: true });
    const defaultAutoLoad = options.defaultAutoLoad === undefined ? '' : `defaultAutoLoad: ${options.defaultAutoLoad}\n`;
    await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${description}\n${defaultAutoLoad}---\n\n# ${name}\n\nUse this skill for tests.\n`,
        'utf8'
    );
}

test('loads user skills and bundled install-directory skills', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-code-skills-'));
    const userSkillsDir = path.join(root, 'user-skills');
    const bundledSkillsDir = path.join(root, 'bundled-skills');

    try {
        await writeSkill(userSkillsDir, 'user-only', 'user-only');
        await writeSkill(bundledSkillsDir, 'bundled-only', 'bundled-only');

        const skills = getAvailableSkills({ userSkillsDir, bundledSkillsDir });
        assert.deepEqual(skills.map(skill => skill.id), ['user-only', 'bundled-only']);
        assert.equal(skills.find(skill => skill.id === 'bundled-only')?.path, path.join(bundledSkillsDir, 'bundled-only'));
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('user skills override bundled skills with the same id or name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-code-skills-'));
    const userSkillsDir = path.join(root, 'user-skills');
    const bundledSkillsDir = path.join(root, 'bundled-skills');

    try {
        await writeSkill(userSkillsDir, 'same-id', 'user-same-id', 'User skill with same id.');
        await writeSkill(bundledSkillsDir, 'same-id', 'bundled-same-id', 'Bundled skill with same id.');

        await writeSkill(userSkillsDir, 'user-name-owner', 'same-name', 'User skill with same name.');
        await writeSkill(bundledSkillsDir, 'bundled-name-owner', 'same-name', 'Bundled skill with same name.');

        await writeSkill(bundledSkillsDir, 'bundled-unique', 'bundled-unique', 'Bundled skill with unique id and name.');

        const skills = getAvailableSkills({ userSkillsDir, bundledSkillsDir });
        assert.deepEqual(skills.map(skill => skill.id), ['same-id', 'user-name-owner', 'bundled-unique']);
        assert.equal(skills.find(skill => skill.id === 'same-id')?.description, 'User skill with same id.');
        assert.equal(skills.find(skill => skill.id === 'user-name-owner')?.description, 'User skill with same name.');
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('bundled skills can opt out of default auto loading', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-code-skills-'));
    const userSkillsDir = path.join(root, 'user-skills');
    const bundledSkillsDir = path.join(root, 'bundled-skills');

    try {
        await writeSkill(bundledSkillsDir, 'default-on', 'default-on');
        await writeSkill(bundledSkillsDir, 'default-off', 'default-off', 'Bundled skill disabled by default.', { defaultAutoLoad: false });

        assert.deepEqual(
            getAvailableSkills({ userSkillsDir, bundledSkillsDir }).map(skill => skill.id),
            ['default-on']
        );

        assert.deepEqual(
            getAvailableSkills({
                userSkillsDir,
                bundledSkillsDir,
                config: { defaultSkills: { enabled: ['default-off'] } }
            }).map(skill => skill.id),
            ['default-off', 'default-on']
        );

        assert.deepEqual(
            getAvailableSkills({
                userSkillsDir,
                bundledSkillsDir,
                config: { defaultSkills: { disabled: ['default-on'] } }
            }).map(skill => skill.id),
            []
        );
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('lists bundled skills and reports enabled state from config', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-code-skills-'));
    const bundledSkillsDir = path.join(root, 'bundled-skills');

    try {
        await writeSkill(bundledSkillsDir, 'default-on', 'default-on');
        await writeSkill(bundledSkillsDir, 'default-off', 'default-off', 'Bundled skill disabled by default.', { defaultAutoLoad: false });

        const bundledSkills = getBundledSkills({ bundledSkillsDir });
        assert.deepEqual(bundledSkills.map(skill => skill.id), ['default-off', 'default-on']);

        const defaultOn = bundledSkills.find(skill => skill.id === 'default-on');
        const defaultOff = bundledSkills.find(skill => skill.id === 'default-off');

        assert.equal(isBundledSkillEnabled(defaultOn), true);
        assert.equal(isBundledSkillEnabled(defaultOff), false);
        assert.equal(isBundledSkillEnabled(defaultOff, { defaultSkills: { enabled: ['default-off'] } }), true);
        assert.equal(isBundledSkillEnabled(defaultOn, { defaultSkills: { disabled: ['default-on'] } }), false);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
