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
