// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

export const GROQ_WHISPER_MODELS = [
    { name: 'Whisper Large V3 Turbo (fast, lower cost)', value: 'whisper-large-v3-turbo' },
    { name: 'Whisper Large V3 (highest accuracy)', value: 'whisper-large-v3' }
];

export const OPENROUTER_TRANSCRIPTION_MODELS = [
    { name: 'GPT-4o Mini Transcribe (fast, lower cost)', value: 'openai/gpt-4o-mini-transcribe' },
    { name: 'GPT-4o Transcribe (highest accuracy)', value: 'openai/gpt-4o-transcribe' }
];

export const VOICE_TRANSCRIPTION_PROVIDERS = [
    { name: 'Groq Whisper', value: 'groq' },
    { name: 'OpenRouter GPT-4o Transcribe', value: 'openrouter' }
];

const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.webm', '.aac']);
const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENROUTER_TRANSCRIPTION_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const MIME_TYPES_BY_EXTENSION = new Map([
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.m4a', 'audio/mp4'],
    ['.flac', 'audio/flac'],
    ['.ogg', 'audio/ogg'],
    ['.webm', 'audio/webm'],
    ['.aac', 'audio/aac']
]);
const OPENROUTER_FORMAT_BY_EXTENSION = new Map([
    ['.mp3', 'mp3'],
    ['.wav', 'wav'],
    ['.m4a', 'm4a'],
    ['.flac', 'flac'],
    ['.ogg', 'ogg'],
    ['.webm', 'webm'],
    ['.aac', 'aac']
]);

export function isSupportedVoiceFile(filePath = '') {
    return SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getVoiceConfig(config = {}) {
    return config.voice || {};
}

export function getVoiceProvider(voice = {}) {
    if (voice.provider) return voice.provider;
    if (voice.model && String(voice.model).startsWith('openai/')) return 'openrouter';
    return 'groq';
}

export function hasUsableVoiceConfig(config = {}) {
    const voice = getVoiceConfig(config);
    const provider = getVoiceProvider(voice);
    if (provider === 'openrouter') return Boolean(voice.openrouterApiKey && voice.model);
    return Boolean(voice.groqApiKey && voice.model);
}

export async function setupVoiceConfig(config = {}) {
    const { input, select } = await import('@inquirer/prompts');
    const existing = getVoiceConfig(config);
    const existingProvider = getVoiceProvider(existing);

    const provider = await select({
        message: 'Select a transcription provider for voice input:',
        choices: VOICE_TRANSCRIPTION_PROVIDERS,
        default: existingProvider,
        loop: false
    });

    if (provider === 'openrouter') {
        const openrouterApiKey = await input({
            message: 'Enter your OPENROUTER_API_KEY:',
            default: existing.openrouterApiKey || '',
            validate: (value) => value.trim().length > 0 || 'OpenRouter API key cannot be empty'
        });

        const model = await select({
            message: 'Select an OpenRouter transcription model for voice input:',
            choices: OPENROUTER_TRANSCRIPTION_MODELS,
            default: OPENROUTER_TRANSCRIPTION_MODELS.some(choice => choice.value === existing.model)
                ? existing.model
                : 'openai/gpt-4o-mini-transcribe',
            loop: false
        });

        return {
            ...config,
            voice: {
                ...existing,
                provider,
                openrouterApiKey: openrouterApiKey.trim(),
                model
            }
        };
    }

    const groqApiKey = await input({
        message: 'Enter your GROQ_API_KEY:',
        default: existing.groqApiKey || '',
        validate: (value) => value.trim().length > 0 || 'Groq API key cannot be empty'
    });

    const model = await select({
        message: 'Select a Whisper model for voice input:',
        choices: GROQ_WHISPER_MODELS,
        default: GROQ_WHISPER_MODELS.some(choice => choice.value === existing.model)
            ? existing.model
            : 'whisper-large-v3-turbo',
        loop: false
    });

    return {
        ...config,
        voice: {
            ...existing,
            provider,
            groqApiKey: groqApiKey.trim(),
            model
        }
    };
}

export function isSupportedVoiceModel(provider, model) {
    if (provider === 'openrouter') {
        return OPENROUTER_TRANSCRIPTION_MODELS.some(choice => choice.value === model);
    }
    if (provider === 'groq') {
        return GROQ_WHISPER_MODELS.some(choice => choice.value === model);
    }
    return false;
}

export function getVoiceApiKey(voice = {}) {
    const provider = getVoiceProvider(voice);
    return provider === 'openrouter' ? voice.openrouterApiKey : voice.groqApiKey;
}

export function getVoiceProviderLabel(provider) {
    return provider === 'openrouter' ? 'OpenRouter' : 'Groq';
}

export async function transcribeVoice({ provider = 'groq', apiKey, model, filePath, fileBuffer, fileName = 'audio.wav', mimeType = 'audio/wav' }) {
    if (provider === 'openrouter') {
        return transcribeWithOpenRouter({ apiKey, model, filePath, fileBuffer, fileName, mimeType });
    }
    return transcribeWithGroq({ apiKey, model, filePath, fileBuffer, fileName, mimeType });
}

export async function transcribeWithGroq({ apiKey, model, filePath, fileBuffer, fileName = 'audio.wav', mimeType = 'audio/wav' }) {
    if (!apiKey) throw new Error('Missing Groq API key.');
    if (!model) throw new Error('Missing Groq Whisper model.');

    const buffer = fileBuffer || await fs.readFile(filePath);
    const resolvedName = filePath ? path.basename(filePath) : fileName;
    const resolvedMimeType = mimeType || mimeTypeFromFileName(resolvedName);

    const form = new FormData();
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('file', new Blob([buffer], { type: resolvedMimeType }), resolvedName);

    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`
        },
        body: form
    });

    const bodyText = await response.text();
    let payload;
    try {
        payload = bodyText ? JSON.parse(bodyText) : {};
    } catch {
        payload = { error: bodyText };
    }

    if (!response.ok) {
        const message = payload?.error?.message || payload?.error || bodyText || response.statusText;
        throw new Error(`Groq transcription failed (${response.status}): ${message}`);
    }

    const text = payload?.text?.trim();
    if (!text) throw new Error('Groq returned an empty transcription.');
    return text;
}

export async function transcribeWithOpenRouter({ apiKey, model, filePath, fileBuffer, fileName = 'audio.wav', mimeType = 'audio/wav' }) {
    if (!apiKey) throw new Error('Missing OpenRouter API key.');
    if (!model) throw new Error('Missing OpenRouter transcription model.');

    const buffer = fileBuffer || await fs.readFile(filePath);
    const resolvedName = filePath ? path.basename(filePath) : fileName;
    const format = openRouterAudioFormatFromFileName(resolvedName, mimeType);
    if (!format) {
        throw new Error('OpenRouter voice input accepts .mp3, .wav, .m4a, .flac, .ogg, .webm, or .aac files.');
    }

    const response = await fetch(OPENROUTER_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            input_audio: {
                data: buffer.toString('base64'),
                format
            }
        })
    });

    const bodyText = await response.text();
    let payload;
    try {
        payload = bodyText ? JSON.parse(bodyText) : {};
    } catch {
        payload = { error: bodyText };
    }

    if (!response.ok) {
        const message = payload?.error?.message || payload?.error || bodyText || response.statusText;
        throw new Error(`OpenRouter transcription failed (${response.status}): ${message}`);
    }

    const text = payload?.text?.trim();
    if (!text) throw new Error('OpenRouter returned an empty transcription.');
    return text;
}

export function mimeTypeFromFileName(fileName = '') {
    const ext = path.extname(fileName).toLowerCase();
    return MIME_TYPES_BY_EXTENSION.get(ext) || 'application/octet-stream';
}

export function openRouterAudioFormatFromFileName(fileName = '', mimeType = '') {
    const ext = path.extname(fileName).toLowerCase();
    if (OPENROUTER_FORMAT_BY_EXTENSION.has(ext)) return OPENROUTER_FORMAT_BY_EXTENSION.get(ext);

    const normalizedMimeType = String(mimeType).split(';')[0].trim().toLowerCase();
    for (const [candidateExt, candidateMimeType] of MIME_TYPES_BY_EXTENSION.entries()) {
        if (candidateMimeType === normalizedMimeType) {
            return OPENROUTER_FORMAT_BY_EXTENSION.get(candidateExt);
        }
    }

    if (normalizedMimeType === 'audio/x-wav') return 'wav';
    if (normalizedMimeType === 'audio/mp3') return 'mp3';
    if (normalizedMimeType === 'audio/x-m4a') return 'm4a';
    return null;
}

async function commandExists(command) {
    return new Promise((resolve) => {
        const child = spawn('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
        child.on('close', code => resolve(code === 0));
        child.on('error', () => resolve(false));
    });
}

async function getRecorderCommand(outputPath) {
    if (await commandExists('rec')) {
        return { command: 'rec', args: ['-q', '-r', '16000', '-c', '1', outputPath] };
    }

    if (process.platform === 'linux' && await commandExists('arecord')) {
        return { command: 'arecord', args: ['-q', '-f', 'S16_LE', '-c', '1', '-r', '16000', outputPath] };
    }

    if (await commandExists('ffmpeg')) {
        if (process.platform === 'darwin') {
            return { command: 'ffmpeg', args: ['-y', '-f', 'avfoundation', '-i', ':0', '-ac', '1', '-ar', '16000', outputPath] };
        }
        if (process.platform === 'linux') {
            return { command: 'ffmpeg', args: ['-y', '-f', 'alsa', '-i', 'default', '-ac', '1', '-ar', '16000', outputPath] };
        }
    }

    return null;
}

export async function recordVoiceClip() {
    const recorder = await getRecorderCommand(await getTemporaryVoicePath());
    if (!recorder) {
        throw new Error('No supported audio recorder found. Install SoX (`rec`), ALSA `arecord`, or ffmpeg, or run `/voice <path-to-file.mp3|wav>`.');
    }

    const outputPath = recorder.args[recorder.args.length - 1];
    const child = spawn(recorder.command, recorder.args, {
        stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', chunk => {
        stderr += chunk.toString();
    });
    const closePromise = new Promise((resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }));
    });

    const { input } = await import('@inquirer/prompts');
    await input({ message: 'Recording. Press Enter to stop.' });

    if (!child.killed) child.kill('SIGINT');
    await closePromise;

    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat || stat.size <= 44) {
        const detail = stderr.trim() ? ` Recorder output: ${stderr.trim()}` : '';
        throw new Error(`Recording failed or produced no audio.${detail}`);
    }

    return outputPath;
}

export async function cleanupVoiceClip(filePath) {
    if (!filePath || !filePath.startsWith(os.tmpdir())) return;
    await fs.unlink(filePath).catch(() => {});
    await fs.rm(path.dirname(filePath), { recursive: false }).catch(() => {});
}

async function getTemporaryVoicePath() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-voice-'));
    return path.join(dir, 'voice.wav');
}
