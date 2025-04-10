// __tests__/services/trimmingService.test.js
// --- Mock dependencies ---
const mockScroll = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../config/qdrantClient', () => ({
    scroll: mockScroll,
    delete: mockDelete,
}));

// Mock memory logic only for calculateTrimScore
const mockCalculateTrimScore = jest.fn();
jest.mock('../../services/memoryLogic', () => ({
    // Keep other exports if trimmingService used them, otherwise just mock the one needed
    calculateTrimScore: mockCalculateTrimScore
}));

// Mock Env Vars for Trimming
const MOCK_TRIM_THRESHOLD = 10000; // Example threshold for testing
const MOCK_TRIM_BATCH_SIZE = 3; // Small batch size for testing pagination
process.env.TRIM_THRESHOLD = MOCK_TRIM_THRESHOLD;
process.env.TRIM_BATCH_SIZE = MOCK_TRIM_BATCH_SIZE;
// process.env.MIN_AGE_BEFORE_TRIM_SECONDS = '...'; // Set if you want to test filtering

const { runTrimming } = require('../../services/trimmingService');

describe('Trimming Service', () => {

    beforeEach(() => {
        mockScroll.mockClear();
        mockDelete.mockClear();
        mockCalculateTrimScore.mockClear();
    });

    // Helper function to create mock points
    const createMockPoint = (id, score, payloadOverrides = {}) => ({
        id,
        // Vector not needed for trimming test
        payload: {
            timestamp_created: 1690000000,
            timestamp_last_accessed: 1699000000,
            weighted_access_score: 5.0,
            ...payloadOverrides // Allow overriding defaults
        },
        // Mock score field is not used by our logic, only the calculated one
    });

    it('should scan points and delete those above threshold', async () => {
        const pointsToKeep1 = createMockPoint('keep1');
        const pointsToDelete1 = createMockPoint('del1');
        const pointsToKeep2 = createMockPoint('keep2');
        const pointsToDelete2 = createMockPoint('del2');
        const pointsToDelete3 = createMockPoint('del3');
        const pointsToKeep3 = createMockPoint('keep3');

        // Mock calculateTrimScore behavior
        mockCalculateTrimScore.mockImplementation((payload, currentTime) => {
            if (payload === pointsToKeep1.payload) return MOCK_TRIM_THRESHOLD - 1;
            if (payload === pointsToDelete1.payload) return MOCK_TRIM_THRESHOLD + 1;
            if (payload === pointsToKeep2.payload) return 0;
            if (payload === pointsToDelete2.payload) return MOCK_TRIM_THRESHOLD * 2;
            if (payload === pointsToDelete3.payload) return MOCK_TRIM_THRESHOLD + 5;
            if (payload === pointsToKeep3.payload) return 100;
            return 0; // Default
        });

        // Mock Qdrant scroll responses (paginate based on batch size)
        mockScroll
            .mockResolvedValueOnce({ // First batch
                points: [pointsToKeep1, pointsToDelete1, pointsToKeep2],
                next_page_offset: 'offset1'
            })
            .mockResolvedValueOnce({ // Second batch
                points: [pointsToDelete2, pointsToDelete3, pointsToKeep3],
                next_page_offset: null // Last batch
            });

        mockDelete.mockResolvedValue({}); // Simulate successful delete

        await runTrimming();

        // Assertions
        expect(mockScroll).toHaveBeenCalledTimes(2); // Called twice due to pagination
        expect(mockScroll).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ limit: MOCK_TRIM_BATCH_SIZE }));
        expect(mockCalculateTrimScore).toHaveBeenCalledTimes(6); // Called for each point

        expect(mockDelete).toHaveBeenCalledTimes(2); // One delete call per batch containing deletable items
        // First delete call check
        expect(mockDelete).toHaveBeenCalledWith(
            expect.any(String),
            { points: ['del1'] } // Only del1 in first batch was above threshold
        );
        // Second delete call check
        expect(mockDelete).toHaveBeenCalledWith(
            expect.any(String),
            { points: ['del2', 'del3'] } // del2 and del3 in second batch
        );
    });

    it('should handle empty collection gracefully', async () => {
        mockScroll.mockResolvedValueOnce({ points: [], next_page_offset: null });

        await runTrimming();

        expect(mockScroll).toHaveBeenCalledTimes(1);
        expect(mockCalculateTrimScore).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

     it('should handle a batch exactly matching batch size for deletion', async () => {
        const pointsToDelete = [
             createMockPoint('d1'),
             createMockPoint('d2'),
             createMockPoint('d3'), // Exactly batch size
        ];
         mockCalculateTrimScore.mockReturnValue(MOCK_TRIM_THRESHOLD + 1); // All should be deleted
         mockScroll.mockResolvedValueOnce({ points: pointsToDelete, next_page_offset: null });
         mockDelete.mockResolvedValue({});

         await runTrimming();

         expect(mockScroll).toHaveBeenCalledTimes(1);
         expect(mockCalculateTrimScore).toHaveBeenCalledTimes(3);
         expect(mockDelete).toHaveBeenCalledTimes(1);
         expect(mockDelete).toHaveBeenCalledWith(expect.any(String), { points: ['d1', 'd2', 'd3'] });
     });


    it('should handle Qdrant scroll errors', async () => {
         const scrollError = new Error("Scroll failed");
         mockScroll.mockRejectedValue(scrollError);
         // Use console.error spy to check if error is logged
         const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

         await runTrimming();

         expect(mockScroll).toHaveBeenCalledTimes(1);
         expect(mockDelete).not.toHaveBeenCalled();
         expect(consoleSpy).toHaveBeenCalledWith("Error during memory trimming:", scrollError);
         consoleSpy.mockRestore(); // Restore console.error
     });

     it('should handle Qdrant delete errors', async () => {
         const pointToDelete = createMockPoint('del1');
         mockCalculateTrimScore.mockReturnValue(MOCK_TRIM_THRESHOLD + 1);
         mockScroll.mockResolvedValueOnce({ points: [pointToDelete], next_page_offset: null });
         const deleteError = new Error("Delete failed");
         mockDelete.mockRejectedValue(deleteError);
          const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});


         await runTrimming();

         expect(mockScroll).toHaveBeenCalledTimes(1);
         expect(mockDelete).toHaveBeenCalledTimes(1); // Attempted delete
         expect(consoleSpy).toHaveBeenCalledWith("Error during memory trimming:", deleteError);
         consoleSpy.mockRestore();
     });

     // Add test case for MIN_AGE_SECONDS filtering if implemented and needed
     it('should apply MIN_AGE_SECONDS filter if set', async () => {
        process.env.MIN_AGE_BEFORE_TRIM_SECONDS = '86400'; // 1 day
         const currentTime = Date.now() / 1000;
         mockScroll.mockResolvedValueOnce({ points: [], next_page_offset: null }); // Just check the call

         await runTrimming();

         const receivedLtValue = mockScroll.mock.calls[0][1].filter.must[0].range.lt;
         expect(receivedLtValue / 1e9).toBeCloseTo((currentTime - 86400) / 1e9, 0);
         // Reset env var if other tests rely on it being unset
         delete process.env.MIN_AGE_BEFORE_TRIM_SECONDS;
     });


});
