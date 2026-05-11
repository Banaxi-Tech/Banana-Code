// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import { select } from '@inquirer/prompts';
import {
    getModelSwitchCurrentModel,
    getModelSwitchProviderId,
    providerSupportsModelSwitch,
    resolveRecommendedModel
} from '../utils/modelSwitch.js';

export async function requestModelSwitch(args = {}, config = {}) {
    if (!providerSupportsModelSwitch(config)) {
        return 'Model switch is not available for this provider.';
    }

    const provider = getModelSwitchProviderId(config);
    const currentModel = getModelSwitchCurrentModel(config) || config.model || 'unknown';
    const recommendedModel = resolveRecommendedModel(config, args.recommendedModel || args.model);
    const reason = String(args.reason || '').trim();

    if (!recommendedModel) {
        return `Model switch rejected: "${args.recommendedModel || args.model || ''}" is not an available ${provider} model ID.`;
    }

    if (recommendedModel === currentModel) {
        return `Already using ${recommendedModel}; no model switch is needed.`;
    }

    const request = {
        provider,
        currentModel,
        recommendedModel,
        reason
    };

    if (typeof config.requestModelSwitch === 'function') {
        const result = await config.requestModelSwitch(request);
        return formatModelSwitchResult(result, currentModel, recommendedModel);
    }

    if (config.isApiMode) {
        return `Model switch declined. No interactive client is available to approve switching from ${currentModel} to ${recommendedModel}.`;
    }

    const choice = await select({
        message: `The model recommends switching from ${currentModel} to ${recommendedModel}.${reason ? ` Reason: ${reason}` : ''}`,
        choices: [
            { name: `Switch to ${recommendedModel}`, value: 'switch' },
            { name: `Continue with ${currentModel}`, value: 'continue' }
        ],
        loop: false
    });

    if (choice !== 'switch') {
        return `Model switch declined. Continue using ${currentModel}.`;
    }

    config.runtimeModelOverride = recommendedModel;
    return `Model switch accepted. This turn will use ${recommendedModel}; future turns will return to ${currentModel} unless another switch is approved.`;
}

function formatModelSwitchResult(result = {}, currentModel, recommendedModel) {
    if (result.accepted) {
        const model = result.model || recommendedModel;
        return `Model switch accepted. This turn will use ${model}; future turns will return to ${currentModel} unless another switch is approved.`;
    }

    const suffix = result.reason ? ` ${result.reason}` : '';
    return `Model switch declined. Continue using ${result.model || currentModel}.${suffix}`;
}
