/**
 * Estimates the number of tokens in a given string.
 * This is a rough approximation (1 token ≈ 4 characters or ~0.75 words) 
 * used to provide a quick estimate without needing heavy, provider-specific tokenizer libraries.
 * 
 * @param {string} text - The input text to estimate tokens for.
 * @returns {number} The estimated token count.
 */
export function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    
    // A common heuristic: 1 token is roughly 4 English characters.
    // For code, it can be denser, but this provides a reasonable ballpark.
    return Math.ceil(text.length / 4);
}

/**
 * Calculates the estimated token count for the entire conversation history.
 * 
 * @param {Array} messages - The array of message objects.
 * @returns {number} The estimated total tokens.
 */
export function estimateConversationTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    
    let totalString = '';
    
    // Stringify the entire message array to get a representation of its "weight"
    // This includes system prompts, tool calls, and results.
    try {
        totalString = JSON.stringify(messages);
    } catch (e) {
        // Fallback if there are circular references (unlikely in simple message arrays)
        messages.forEach(msg => {
            if (typeof msg === 'string') totalString += msg;
            else if (msg && typeof msg === 'object') {
                if (msg.content) totalString += typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                if (msg.parts) totalString += JSON.stringify(msg.parts);
            }
        });
    }

    return estimateTokens(totalString);
}

/**
 * Estimates the token breakdown for the conversation history.
 * 
 * @param {Array} messages - The array of message objects.
 * @returns {Object} breakdown - An object with tokens and percentages.
 */
export function getContextBreakdown(messages) {
    if (!Array.isArray(messages)) return { total: 0, system: 0, chat: 0, tools: 0, other: 0 };
    
    let systemTokens = 0;
    let chatTokens = 0;
    let toolTokens = 0;
    let otherTokens = 0;

    messages.forEach(msg => {
        const str = JSON.stringify(msg);
        const tokens = estimateTokens(str);

        if (msg.role === 'system') {
            systemTokens += tokens;
        } else if (msg.role === 'tool' || msg.tool_calls || msg.tool_call_id || (msg.parts && msg.parts.some(p => p.functionCall || p.functionResponse))) {
            toolTokens += tokens;
        } else if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'model' || msg.role === 'output_text') {
            chatTokens += tokens;
        } else {
            otherTokens += tokens;
        }
    });

    const total = systemTokens + chatTokens + toolTokens + otherTokens;
    
    return {
        total,
        system: systemTokens,
        chat: chatTokens,
        tools: toolTokens,
        other: otherTokens,
        percentages: {
            system: total > 0 ? Math.round((systemTokens / total) * 100) : 0,
            chat: total > 0 ? Math.round((chatTokens / total) * 100) : 0,
            tools: total > 0 ? Math.round((toolTokens / total) * 100) : 0,
            other: total > 0 ? Math.round((otherTokens / total) * 100) : 0
        }
    };
}
