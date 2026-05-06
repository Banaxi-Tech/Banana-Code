// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import chalk from 'chalk';
import { requestPermission } from '../permissions.js';
import { isRemoteConnected, sendRemoteImageGenEvent, sendRemoteToolEvent } from '../remote.js';
import { DEFAULT_IMAGEGEN_BASE_URL, normalizeImageGenBaseUrl } from '../config.js';

const FINAL_IMAGE_MIME_TYPE = 'image/png';

function parseArgs(args) {
    if (typeof args === 'string') {
        try {
            return JSON.parse(args);
        } catch {
            return {};
        }
    }
    return args && typeof args === 'object' ? args : {};
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function integerInRange(value, fallback, min, max) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`Expected integer between ${min} and ${max}.`);
    }
    return parsed;
}

function numberInRange(value, fallback, min, max) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new Error(`Expected number between ${min} and ${max}.`);
    }
    return parsed;
}

function chooseOutputPath(outputPath, index, total) {
    const resolved = path.resolve(process.cwd(), outputPath);
    if (total <= 1) return resolved;

    const ext = path.extname(resolved) || '.png';
    const base = resolved.slice(0, resolved.length - ext.length);
    return `${base}-${index + 1}${ext}`;
}

function stripBase64ForToolResult(result) {
    return {
        ...result,
        images: result.images.map(image => {
            const { b64_json, ...safeImage } = image;
            if (b64_json) {
                safeImage.b64_json = `[base64 image data omitted from tool result: ${b64_json.length} chars]`;
            }
            return safeImage;
        })
    };
}

async function readResponseJson(response, baseUrl) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data.error?.message || data.error || response.statusText;
        throw new Error(`ImageGen request failed at ${baseUrl}: ${message}`);
    }
    return data;
}

async function fetchImageBytes(image, baseUrl) {
    if (image.b64_json) {
        return Buffer.from(image.b64_json, 'base64');
    }

    if (!image.url) {
        throw new Error('ImageGen response did not include url or b64_json.');
    }

    const imageUrl = new URL(image.url, baseUrl).toString();
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to download generated image ${imageUrl}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

async function saveImages({ responseData, outputPath, baseUrl, prompt, model, steps, requestId }) {
    const images = Array.isArray(responseData.data) ? responseData.data : [];
    if (images.length === 0) {
        throw new Error('ImageGen response did not include any images.');
    }

    const saved = [];
    for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const destination = chooseOutputPath(outputPath, i, images.length);
        const bytes = await fetchImageBytes(image, baseUrl);

        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes);

        saved.push({
            index: i,
            path: destination,
            url: image.url || null,
            b64_json: image.b64_json || null,
            mime_type: FINAL_IMAGE_MIME_TYPE,
            model,
            steps,
            prompt,
            requestId
        });
    }

    return saved;
}

function emitImageGenEvent(config, eventType, payload) {
    if (eventType === 'image_generation_progress' && typeof config.onImageGenProgress === 'function') {
        config.onImageGenProgress(payload);
    }
    if (eventType === 'image_generation_result' && typeof config.onImageGenResult === 'function') {
        config.onImageGenResult(payload);
    }
    sendRemoteImageGenEvent(eventType, payload);
}

function parseSseEvent(rawEvent) {
    let event = 'message';
    const dataLines = [];

    for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) {
            event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
        }
    }

    if (dataLines.length === 0) return null;

    try {
        return { event, data: JSON.parse(dataLines.join('\n')) };
    } catch {
        return null;
    }
}

async function streamImageGeneration({ baseUrl, payload, config, requestId }) {
    const response = await fetch(`${baseUrl}/v1/images/generations/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        await readResponseJson(response, baseUrl);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: !done });

        const events = buffer.split('\n\n');
        buffer = done ? '' : events.pop();

        for (const rawEvent of events) {
            const parsed = parseSseEvent(rawEvent.trim());
            if (!parsed) continue;

            if (parsed.event === 'start') {
                emitImageGenEvent(config, 'image_generation_progress', {
                    requestId,
                    phase: 'start',
                    ...parsed.data
                });
            } else if (parsed.event === 'progress') {
                emitImageGenEvent(config, 'image_generation_progress', {
                    requestId,
                    phase: 'progress',
                    ...parsed.data
                });
                if (!config.isApiMode && !isRemoteConnected() && parsed.data.step) {
                    console.log(chalk.gray(`[ImageGen] step ${parsed.data.step}/${parsed.data.total} (${parsed.data.percent || 0}%)`));
                }
            } else if (parsed.event === 'result') {
                result = parsed.data;
            } else if (parsed.event === 'error') {
                throw new Error(parsed.data?.message || 'ImageGen streaming error.');
            }
        }

        if (done) break;
    }

    if (!result) {
        throw new Error('ImageGen stream ended without a result event.');
    }

    return result;
}

async function createImageGeneration({ baseUrl, payload }) {
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return await readResponseJson(response, baseUrl);
}

export async function generateImage(rawArgs, config = {}) {
    const args = parseArgs(rawArgs);
    const imageGenConfig = config.imageGen || {};
    if (imageGenConfig.enabled !== true) {
        return 'ImageGen is not enabled. Run /imagegen to configure it first.';
    }

    const prompt = cleanString(args.prompt);
    const outputPath = cleanString(args.outputPath || args.filepath || args.path);
    if (!prompt) return 'ImageGen failed: prompt is required.';
    if (!outputPath) return 'ImageGen failed: outputPath is required.';

    const baseUrl = normalizeImageGenBaseUrl(args.baseUrl || imageGenConfig.baseUrl || DEFAULT_IMAGEGEN_BASE_URL);
    const model = cleanString(args.model) || imageGenConfig.model;
    if (!model) return 'ImageGen failed: no model configured. Run /imagegen setup.';

    let steps;
    let n;
    let progressInterval;
    let guidanceScale;
    try {
        steps = integerInRange(args.steps ?? args.num_inference_steps, 28, 1, 100);
        n = integerInRange(args.n, 1, 1, 4);
        progressInterval = integerInRange(args.progress_interval, 1, 1, 100);
        guidanceScale = numberInRange(args.guidance_scale, 4.5, 0, 30);
    } catch (error) {
        return `ImageGen failed: ${error.message}`;
    }

    const responseFormat = args.response_format === 'b64_json' ? 'b64_json' : 'url';
    const explicitProgressFormat = cleanString(args.progress_format);
    const wantsRealtimeProgress = explicitProgressFormat
        ? explicitProgressFormat !== 'none'
        : imageGenConfig.realtimeProgress !== false;
    const shouldStream = wantsRealtimeProgress && (
        config.isApiMode ||
        typeof config.onImageGenProgress === 'function' ||
        isRemoteConnected()
    );
    const progressFormat = explicitProgressFormat === 'b64_json'
        ? 'b64_json'
        : (explicitProgressFormat === 'none' ? 'none' : 'url');

    const payload = {
        prompt,
        model,
        n,
        steps,
        guidance_scale: guidanceScale,
        response_format: responseFormat
    };
    if (args.size) payload.size = String(args.size);
    if (args.negative_prompt) payload.negative_prompt = String(args.negative_prompt);
    if (args.seed !== undefined && args.seed !== null) payload.seed = integerInRange(args.seed, null, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (shouldStream || args.progress_format) {
        payload.progress_format = shouldStream ? progressFormat : args.progress_format;
        payload.progress_interval = progressInterval;
    }

    const details = [
        `Prompt: ${prompt}`,
        `Output: ${path.resolve(process.cwd(), outputPath)}`,
        `Model: ${model}`,
        `Steps: ${steps}`,
        `Images: ${n}`,
        `Base URL: ${baseUrl}`
    ].join('\n');

    const permission = await requestPermission('Generate Image', details);
    if (!permission.allowed) {
        sendRemoteToolEvent({ actionType: 'Generate Image', details, status: 'denied' });
        return `User denied permission to generate image: ${outputPath}`;
    }

    const requestId = crypto.randomUUID();
    sendRemoteToolEvent({ actionType: 'Generate Image', details, status: 'pending' });

    try {
        if (!config.isApiMode) {
            console.log(chalk.yellow(`\n[ImageGen] Generating ${n} image(s) with ${model}, ${steps} steps...`));
        }

        let responseData;
        try {
            if (shouldStream) {
                emitImageGenEvent(config, 'image_generation_progress', {
                    requestId,
                    phase: 'queued',
                    prompt,
                    model,
                    steps,
                    total: steps,
                    percent: 0,
                    message: 'Waiting for first live preview...'
                });
            }
            responseData = shouldStream
                ? await streamImageGeneration({ baseUrl, payload, config, requestId })
                : await createImageGeneration({ baseUrl, payload });
        } catch (error) {
            if (!shouldStream) throw error;
            emitImageGenEvent(config, 'image_generation_progress', {
                requestId,
                phase: 'fallback',
                prompt,
                model,
                steps,
                message: `Realtime ImageGen stream failed (${error.message}); waiting for final image.`
            });
            responseData = await createImageGeneration({ baseUrl, payload: { ...payload, progress_format: undefined, progress_interval: undefined } });
        }

        const savedImages = await saveImages({
            responseData,
            outputPath,
            baseUrl,
            prompt,
            model,
            steps,
            requestId
        });

        const result = {
            ok: true,
            requestId,
            created: responseData.created || Math.floor(Date.now() / 1000),
            model,
            steps,
            prompt,
            images: savedImages
        };

        emitImageGenEvent(config, 'image_generation_result', result);
        sendRemoteToolEvent({ actionType: 'Generate Image', details, status: 'completed' });

        if (!config.isApiMode) {
            console.log(chalk.green(`[ImageGen] Saved ${savedImages.length} image(s).`));
        }

        return stripBase64ForToolResult(result);
    } catch (error) {
        sendRemoteToolEvent({ actionType: 'Generate Image', details: `${details}\n\nError: ${error.message}`, status: 'failed' });
        return `ImageGen failed: ${error.message}`;
    }
}
