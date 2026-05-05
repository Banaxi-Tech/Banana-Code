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

const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav']);
const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export function isSupportedVoiceFile(filePath = '') {
    return SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getVoiceConfig(config = {}) {
    return config.voice || {};
}

export function hasUsableVoiceConfig(config = {}) {
    const voice = getVoiceConfig(config);
    return Boolean(voice.groqApiKey && voice.model);
}

export async function setupVoiceConfig(config = {}) {
    const { input, select } = await import('@inquirer/prompts');
    const existing = getVoiceConfig(config);

    const groqApiKey = await input({
        message: 'Enter your GROQ_API_KEY:',
        default: existing.groqApiKey || '',
        validate: (value) => value.trim().length > 0 || 'Groq API key cannot be empty'
    });

    const model = await select({
        message: 'Select a Whisper model for voice input:',
        choices: GROQ_WHISPER_MODELS,
        default: existing.model || 'whisper-large-v3-turbo',
        loop: false
    });

    return {
        ...config,
        voice: {
            ...existing,
            groqApiKey: groqApiKey.trim(),
            model
        }
    };
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

export function mimeTypeFromFileName(fileName = '') {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.mp3') return 'audio/mpeg';
    if (ext === '.wav') return 'audio/wav';
    return 'application/octet-stream';
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
