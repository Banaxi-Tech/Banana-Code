// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Banaxi

export const SPINNER_VERBS = [
  'Working', 'Thinking', 'Processing', 'Loading', 'Running',
  'Building', 'Computing', 'Executing', 'Preparing', 'Finishing',
  'Compiling', 'Deploying', 'Refactoring', 'Debugging', 'Parsing',
  'Optimizing', 'Indexing', 'Caching', 'Rendering', 'Transpiling',
  'Bundling', 'Linting', 'Patching', 'Scaffolding', 'Containerizing',
  'Orchestrating', 'Versioning', 'Syncing', 'Hashing', 'Tokenizing',
  'Caffeinating', 'Daydreaming', 'Spelunking', 'Noodling', 'Tinkering',
  'Meandering', 'Doodling', 'Puzzling', 'Pondering', 'Gallivanting',
  'Rummaging', 'Scavenging', 'Pottering', 'Fiddling', 'Scheming',
  'Concocting', 'Conjuring', 'Manifesting', 'Summoning', 'Experimenting',
  'Charging', 'Launching', 'Accelerating', 'Turbocharging', 'Wrangling',
  'Juggling', 'Assembling', 'Forging', 'Crafting', 'Weaving',
  'Stitching', 'Hammering', 'Chiseling', 'Sculpting', 'Architecting',
  'Calculating', 'Simulating', 'Extrapolating', 'Theorizing', 'Hypothesizing',
  'Materializing', 'Crystallizing', 'Synthesizing', 'Transmuting', 'Converging', 'Bananing', 'Coding',
];

export function getRandomSpinnerText(provider) {
    if (Math.random() < 0.5) {
        switch (provider?.toLowerCase()) {
            case 'claude':
                return 'Clauding...';
            case 'openai':
                return 'GPTing...';
            case 'gemini':
                return 'Gemming...';
            case 'mistral':
                return 'Mistraling...';
            case 'deepseek':
                return 'DeepSeeking...';
            case 'kimi':
                return 'Kimiing...';
            case 'openrouter':
                return 'Routing...';
            case 'ollama':
            case 'ollamacloud':
                return 'Ollaming...';
            case 'lmstudio':
                return 'LMing...';
        }
    }
    const verb = SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
    return `${verb}...`;
}
