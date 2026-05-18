// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createPlan,
    getCreatedPlan,
    resetCreatedPlan
} from '../src/tools/createPlan.js';

test('createPlan stores a trimmed plan and title', async () => {
    resetCreatedPlan();

    const result = await createPlan({
        title: '  Release steps  ',
        plan: '  1. Run tests\n2. Publish  '
    });

    assert.equal(result, 'Plan captured. Banana Code will now show the approval menu.');
    assert.equal(getCreatedPlan().title, 'Release steps');
    assert.equal(getCreatedPlan().plan, '1. Run tests\n2. Publish');
    assert.match(getCreatedPlan().createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('createPlan rejects empty or non-string plan text without changing existing state', async () => {
    resetCreatedPlan();

    assert.equal(await createPlan({ plan: 'initial' }), 'Plan captured. Banana Code will now show the approval menu.');
    const previous = getCreatedPlan();

    assert.equal(await createPlan({ plan: '   ' }), 'create_plan failed: plan text is required.');
    assert.equal(getCreatedPlan(), previous);

    assert.equal(await createPlan({ plan: ['not', 'text'] }), 'create_plan failed: plan text is required.');
    assert.equal(getCreatedPlan(), previous);
});
