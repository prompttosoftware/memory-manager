// __tests__/services/memoryLogic.test.js
import { describe, it, beforeEach, expect, vi } from 'vitest';
import {
    calculateInitialSpecificity,
    calculateAccessSpecificity,
    calculateTrimScore
} from '../../services/memoryLogic.js';

// --- Mock environment variables used by memoryLogic ---
// It's often cleaner to mock process.env, but for simplicity here,
// we'll rely on the defaults set in the logic file or assume standard values.
// If you heavily rely on process.env, consider using vi.spyOn(process, 'env', 'get').mockReturnValue(...)
// or libraries like 'dotenv-testing'. For this example, we assume K_MAX=100, W_AGE=1.0, W_RECENCY=1.5, C_USAGE=1.0

describe('Memory Logic Service', () => {

    describe('calculateInitialSpecificity', () => {
        it('should return 1.0 for low previous k values', () => {
            expect(calculateInitialSpecificity(0)).toBe(1.0);
            expect(calculateInitialSpecificity(5)).toBe(1.0);
        });

        it('should return lower values for higher k', () => {
            expect(calculateInitialSpecificity(50)).toBeCloseTo(0.5); // 1.0 - (50/100)
            expect(calculateInitialSpecificity(90)).toBeCloseTo(0.1); // 1.0 - (90/100)
        });

        it('should clamp to 0.1 for k >= K_MAX', () => {
            expect(calculateInitialSpecificity(100)).toBe(0.1);
            expect(calculateInitialSpecificity(150)).toBe(0.1);
        });
    });

    describe('calculateAccessSpecificity', () => {
        it('should return 1.0 for zero k value (max specificity)', () => {
            expect(calculateAccessSpecificity(0)).toBe(1.0);
        });

        it('should return lower values for higher k', () => {
            expect(calculateAccessSpecificity(50)).toBeCloseTo(0.5); // 1.0 - (50/100)
            expect(calculateAccessSpecificity(90)).toBeCloseTo(0.1); // 1.0 - (90/100)
        });

        it('should clamp to 0.1 for k >= K_MAX', () => {
            expect(calculateAccessSpecificity(100)).toBe(0.1);
            expect(calculateAccessSpecificity(150)).toBe(0.1);
        });
    });

    describe('calculateTrimScore', () => {
        const currentTime = 1700000000; // Example fixed current time (seconds)
        const W_AGE = 1.0;
        const W_RECENCY = 1.5;
        const C_USAGE = 1.0;

        it('should return a low score for a new, accessed item', () => {
            const payload = {
                timestamp_created: currentTime - 10, // 10 seconds old
                timestamp_last_accessed: currentTime - 1, // Accessed 1 second ago
                weighted_access_score: 5.0
            };
            const expectedScore = (W_AGE * 10 + W_RECENCY * 1) / Math.log(5.0 + C_USAGE);
            expect(calculateTrimScore(payload, currentTime)).toBeCloseTo(expectedScore); // ~6.4
        });

        it('should return a higher score for an old, stale item', () => {
            const payload = {
                timestamp_created: currentTime - 86400 * 30, // 30 days old
                timestamp_last_accessed: currentTime - 86400 * 15, // Accessed 15 days ago
                weighted_access_score: 2.0
            };
            const age = 86400 * 30;
            const recency = 86400 * 15;
            const expectedScore = (W_AGE * age + W_RECENCY * recency) / Math.log(2.0 + C_USAGE);
             expect(calculateTrimScore(payload, currentTime)).toBeCloseTo(expectedScore); // ~4.1 million
        });

        it('should return a lower score for an old, but frequently accessed item', () => {
             const payload = {
                timestamp_created: currentTime - 86400 * 30, // 30 days old
                timestamp_last_accessed: currentTime - 86400 * 1, // Accessed 1 day ago
                weighted_access_score: 100.0 // High score
            };
            const age = 86400 * 30;
            const recency = 86400 * 1;
             const expectedScore = (W_AGE * age + W_RECENCY * recency) / Math.log(100.0 + C_USAGE);
             expect(calculateTrimScore(payload, currentTime)).toBeCloseTo(expectedScore); // ~590k
        });

        it('should handle low weighted_access_score gracefully', () => {
            const payload = {
                timestamp_created: currentTime - 1000,
                timestamp_last_accessed: currentTime - 500,
                weighted_access_score: 0.1 // Less than 1
            };
             // usageFactorInput = Math.max(0.1, 0.1) + 1.0 = 1.1
             // usageFactor = Math.log(1.1)
            const expectedScore = (W_AGE * 1000 + W_RECENCY * 500) / Math.log(1.1);
            expect(calculateTrimScore(payload, currentTime)).toBeCloseTo(expectedScore); // ~18k
        });

        it('should handle missing timestamps (defaulting reasonably)', () => {
             const payload = {
                weighted_access_score: 10.0
            };
            // Should effectively have age=0, recency=0
             const expectedScore = (W_AGE * 0 + W_RECENCY * 0) / Math.log(10.0 + C_USAGE);
             expect(calculateTrimScore(payload, currentTime)).toBeCloseTo(expectedScore); // 0
        });

         it('should return Infinity for invalid payload', () => {
            expect(calculateTrimScore(null, currentTime)).toBe(Infinity);
            expect(calculateTrimScore({}, currentTime)).toBe(0); // Defaults lead to 0 score
        });
    });
});
