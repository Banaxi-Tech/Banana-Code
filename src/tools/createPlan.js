// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

let latestCreatedPlan = null;

export function resetCreatedPlan() {
    latestCreatedPlan = null;
}

export function getCreatedPlan() {
    return latestCreatedPlan;
}

export async function createPlan({ plan, title = '' } = {}) {
    const planText = typeof plan === 'string' ? plan.trim() : '';
    if (!planText) {
        return 'create_plan failed: plan text is required.';
    }

    latestCreatedPlan = {
        title: typeof title === 'string' ? title.trim() : '',
        plan: planText,
        createdAt: new Date().toISOString()
    };

    return 'Plan captured. Banana Code will now show the approval menu.';
}
