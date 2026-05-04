import chalk from 'chalk';

const ULTRATHINK_DIRECTIVE_REGEX = /(^|[\s([{])@ultrathink\b/gi;
const ULTRATHINK_DISPLAY_REGEX = /@ultrathink\b/gi;
const ULTRATHINK_COLORS = [217, 223, 230, 194, 158, 153, 147, 183];

function normalizeDirectiveWhitespace(text) {
    return text
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+(\r?\n)/g, '$1')
        .replace(/(\r?\n)[ \t]+/g, '$1')
        .trim();
}

export function extractUltrathinkDirective(input = '') {
    let enabled = false;
    const text = String(input || '').replace(ULTRATHINK_DIRECTIVE_REGEX, (_match, prefix) => {
        enabled = true;
        return prefix;
    });

    return {
        enabled,
        text: enabled ? normalizeDirectiveWhitespace(text) : String(input || '')
    };
}

export function providerSupportsUltrathink(config = {}) {
    return config.provider === 'claude' || (config.provider === 'openai' && config.authType === 'oauth');
}

export function isUltrathinkMention(mention = '') {
    return /^@ultrathink\b/i.test(String(mention || ''));
}

export function rainbowUltrathink(text = 'ultrathink', offset = 0) {
    return Array.from(text)
        .map((char, index) => chalk.ansi256(ULTRATHINK_COLORS[(index + offset) % ULTRATHINK_COLORS.length])(char))
        .join('');
}

export function styleUltrathinkMentions(text = '', baseStyle = value => value, offset = 0) {
    const raw = String(text || '');
    let styled = '';
    let lastIndex = 0;

    for (const match of raw.matchAll(ULTRATHINK_DISPLAY_REGEX)) {
        styled += baseStyle(raw.slice(lastIndex, match.index));
        styled += baseStyle('@') + rainbowUltrathink(match[0].slice(1), offset);
        lastIndex = match.index + match[0].length;
    }

    styled += baseStyle(raw.slice(lastIndex));
    return styled;
}
