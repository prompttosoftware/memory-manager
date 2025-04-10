// services/memoryLogic.js
require('dotenv').config();

const K_MAX = parseInt(process.env.K_MAX || '100', 10);
const W_AGE = parseFloat(process.env.W_AGE || '1.0');
const W_RECENCY = parseFloat(process.env.W_RECENCY || '1.5');
const C_USAGE = parseFloat(process.env.C_USAGE || '1.0');

function calculateInitialSpecificity(lastK) {
    // Handle edge case of no previous retrieval or very few results
    if (lastK <= 5) return 1.0;
    return Math.max(0.1, 1.0 - (lastK / K_MAX));
}

function calculateAccessSpecificity(k) {
     // Treat 0 results as maximum specificity (might indicate error or empty DB)
    if (k <= 0) return 1.0;
    return Math.max(0.1, 1.0 - (k / K_MAX));
}

function calculateTrimScore(memoryPayload, currentTime) {
    if (!memoryPayload || typeof memoryPayload !== 'object') {
        console.warn("Invalid memory payload provided to calculateTrimScore");
        return Infinity; // Ensure invalid items are trimmed
    }

    const age = currentTime - (memoryPayload.timestamp_created || currentTime); // Default age to 0 if missing
    const timeSinceLastAccess = currentTime - (memoryPayload.timestamp_last_accessed || memoryPayload.timestamp_created || currentTime); // Default to age if missing
    const weightedScore = memoryPayload.weighted_access_score || 0; // Default to 0

    // Ensure usage factor doesn't lead to division by zero or negative logs
    const usageFactorInput = Math.max(0.1, weightedScore) + C_USAGE; // Ensure >= 0.1 + C_USAGE
    const usageFactor = Math.log(usageFactorInput);

    // Avoid division by zero if usageFactor somehow becomes zero or negative (shouldn't happen with checks)
    if (usageFactor <= 0) {
         console.warn(`Calculated invalid usageFactor ${usageFactor} for point. Payload:`, memoryPayload);
         // If usage is effectively zero or negative log, treat it as highly trimmable unless it's very new.
         // A very large score ensures trimming unless the item is extremely young.
         return age < 60 ? 0 : Infinity; // Don't trim things < 1 minute old in this edge case.
    }


    const score = (W_AGE * age + W_RECENCY * timeSinceLastAccess) / usageFactor;
    return score;
}


module.exports = {
    calculateInitialSpecificity,
    calculateAccessSpecificity,
    calculateTrimScore
};
