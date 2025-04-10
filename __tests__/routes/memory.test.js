// __tests__/routes/memory.test.js
// --- Mock dependencies ---
// Mock Qdrant client methods used in the routes
const mockUpsertPoints = jest.fn();
const mockSearch = jest.fn();
const mockSetPayload = jest.fn();
jest.mock('../../config/qdrantClient', () => ({
    upsertPoints: mockUpsertPoints,
    search: mockSearch,
    setPayload: mockSetPayload,
    // Add other methods if needed by routes in the future
}));

// Mock Embedding Helper
const mockGetEmbedding = jest.fn();
jest.mock('../../config/embeddingHelper', () => ({
    getEmbedding: mockGetEmbedding,
}));

// Mock State Utils
const mockSetLastRetrievalCount = jest.fn();
const mockGetLastRetrievalCount = jest.fn().mockReturnValue(50); // Default mock value
jest.mock('../../utils/state', () => ({
    setLastRetrievalCount: mockSetLastRetrievalCount,
    getLastRetrievalCount: mockGetLastRetrievalCount,
}));

const request = require('supertest');
const express = require('express');
const memoryRoutes = require('../../routes/memory');

// --- Setup Express App for Testing ---
const app = express();
app.use(express.json());
app.use('/api/memory', memoryRoutes); // Mount the routes under test

// --- Test Suite ---
describe('Memory API Routes', () => {

    beforeEach(() => {
        // Clear mocks before each test to ensure isolation
        mockUpsertPoints.mockClear();
        mockSearch.mockClear();
        mockSetPayload.mockClear();
        mockGetEmbedding.mockClear();
        mockSetLastRetrievalCount.mockClear();
        mockGetLastRetrievalCount.mockClear();
        // Reset mockGetLastRetrievalCount's return value if needed per test, or keep default
         mockGetLastRetrievalCount.mockReturnValue(50);
    });

    describe('POST /api/memory (Ingestion)', () => {
        it('should ingest memory successfully with valid data', async () => {
            const memoryData = { content: 'Test memory', memory_type: 'chat', source_id: 'user123' };
            const mockEmbedding = [0.1, 0.2, 0.3];
            const initialScore = 0.5; // Expected from calculateInitialSpecificity(50)

            mockGetEmbedding.mockResolvedValue(mockEmbedding);
            mockUpsertPoints.mockResolvedValue({}); // Simulate successful upsert

            const res = await request(app)
                .post('/api/memory')
                .send(memoryData);

            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body).toHaveProperty('message', 'Memory ingested successfully');
            expect(mockGetEmbedding).toHaveBeenCalledWith(memoryData.content);
            expect(mockGetLastRetrievalCount).toHaveBeenCalled(); // Called to get last K
            expect(mockUpsertPoints).toHaveBeenCalledTimes(1);
            expect(mockUpsertPoints).toHaveBeenCalledWith(
                expect.any(String), // collection name
                expect.objectContaining({
                    points: expect.arrayContaining([
                        expect.objectContaining({
                            id: expect.any(String),
                            vector: mockEmbedding,
                            payload: expect.objectContaining({
                                content: memoryData.content,
                                memory_type: memoryData.memory_type,
                                source_id: memoryData.source_id,
                                weighted_access_score: expect.closeTo(initialScore),
                                timestamp_created: expect.any(Number),
                                timestamp_last_accessed: expect.any(Number),
                            }),
                        }),
                    ]),
                })
            );
        });

        it('should return 400 if required fields are missing', async () => {
            const res = await request(app)
                .post('/api/memory')
                .send({ content: 'Incomplete data' }); // Missing memory_type

            expect(res.statusCode).toBe(400);
            expect(res.body).toHaveProperty('error', 'Missing required fields: content, memory_type');
            expect(mockUpsertPoints).not.toHaveBeenCalled();
        });

        it('should return 500 if embedding generation fails', async () => {
            mockGetEmbedding.mockRejectedValue(new Error('Embedding failed'));

            const res = await request(app)
                .post('/api/memory')
                .send({ content: 'Test memory', memory_type: 'thought' });

            expect(res.statusCode).toBe(500);
            expect(res.body).toHaveProperty('error', 'Failed to ingest memory');
        });

         it('should return 500 if Qdrant upsert fails', async () => {
            mockGetEmbedding.mockResolvedValue([0.1]);
            mockUpsertPoints.mockRejectedValue(new Error('Qdrant connection error'));

            const res = await request(app)
                .post('/api/memory')
                .send({ content: 'Test memory', memory_type: 'action' });

            expect(res.statusCode).toBe(500);
             expect(res.body).toHaveProperty('error', 'Failed to ingest memory');
        });
    });

    describe('POST /api/memory/search (Retrieval)', () => {
        const searchQuery = { query: 'Find relevant stuff', top_k: 20, retrieve_n: 5 };
        const mockQueryEmbedding = [0.9, 0.8, 0.7];
        const mockSearchResults = [
            { id: 'id1', score: 0.95, payload: { content: 'Result 1', weighted_access_score: 10.0 } },
            { id: 'id2', score: 0.90, payload: { content: 'Result 2', weighted_access_score: 5.0 } },
            { id: 'id3', score: 0.85, payload: { content: 'Result 3', weighted_access_score: 8.0 } },
            { id: 'id4', score: 0.80, payload: { content: 'Result 4', weighted_access_score: 2.0 } },
            { id: 'id5', score: 0.75, payload: { content: 'Result 5', weighted_access_score: 15.0 } },
            { id: 'id6', score: 0.70, payload: { content: 'Result 6', weighted_access_score: 1.0 } },
        ];

        it('should search successfully and update retrieved memories', async () => {
            mockGetEmbedding.mockResolvedValue(mockQueryEmbedding);
            mockSearch.mockResolvedValue(mockSearchResults); // Simulate Qdrant returning 6 results
            mockSetPayload.mockResolvedValue({}); // Simulate successful update

            const res = await request(app)
                .post('/api/memory/search')
                .send(searchQuery);

            const expectedReturnedResults = mockSearchResults.slice(0, searchQuery.retrieve_n);
            const expectedSpecificity = 0.94; // calculateAccessSpecificity(6) => 1 - 6/100

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual(expectedReturnedResults); // Should return only retrieve_n results
            expect(mockGetEmbedding).toHaveBeenCalledWith(searchQuery.query);
            expect(mockSearch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    vector: mockQueryEmbedding,
                    limit: searchQuery.top_k,
                    with_payload: true,
                })
            );
            expect(mockSetLastRetrievalCount).toHaveBeenCalledWith(mockSearchResults.length); // k=6
            expect(mockSetPayload).toHaveBeenCalledTimes(1); // Expecting one batch update call

            // Check the payload update structure (simplified check)
            const updatedPointIds = mockSetPayload.mock.calls[0][1].points;
             expect(updatedPointIds).toHaveLength(searchQuery.retrieve_n);
             expect(updatedPointIds).toEqual(expectedReturnedResults.map(r => r.id));

             // Check one update payload detail
            const firstUpdatePayload = mockSetPayload.mock.calls[0][1].payload;
             expect(firstUpdatePayload.timestamp_last_accessed).toBeCloseTo(Date.now() / 1000, 0);
             expect(firstUpdatePayload.weighted_access_score)
                 .toBeCloseTo(mockSearchResults[0].payload.weighted_access_score + expectedSpecificity);

        });

        it('should handle search returning fewer results than retrieve_n', async () => {
             const fewResults = mockSearchResults.slice(0, 3); // Only 3 results
             mockGetEmbedding.mockResolvedValue(mockQueryEmbedding);
             mockSearch.mockResolvedValue(fewResults);
             mockSetPayload.mockResolvedValue({});

            const res = await request(app)
                .post('/api/memory/search')
                .send(searchQuery); // retrieve_n is 5

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual(fewResults); // Returns the 3 results found
            expect(mockSetLastRetrievalCount).toHaveBeenCalledWith(fewResults.length); // k=3
            expect(mockSetPayload).toHaveBeenCalledTimes(1);
            const updatedPointIds = mockSetPayload.mock.calls[0][1].points;
             expect(updatedPointIds).toHaveLength(fewResults.length);
        });

        it('should handle search returning zero results', async () => {
             mockGetEmbedding.mockResolvedValue(mockQueryEmbedding);
             mockSearch.mockResolvedValue([]); // No results
             mockSetPayload.mockResolvedValue({});

            const res = await request(app)
                .post('/api/memory/search')
                .send(searchQuery);

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual([]);
            expect(mockSetLastRetrievalCount).toHaveBeenCalledWith(0);
            expect(mockSetPayload).not.toHaveBeenCalled(); // No points to update
        });

        it('should return 400 if query is missing', async () => {
            const res = await request(app)
                .post('/api/memory/search')
                .send({ top_k: 10, retrieve_n: 5 }); // Missing query

            expect(res.statusCode).toBe(400);
            expect(res.body).toHaveProperty('error', 'Missing required field: query');
        });

         it('should return 400 if retrieve_n > top_k', async () => {
            const res = await request(app)
                .post('/api/memory/search')
                .send({ query: "test", top_k: 5, retrieve_n: 10 });

            expect(res.statusCode).toBe(400);
             expect(res.body).toHaveProperty('error', 'retrieve_n cannot be greater than top_k');
        });

        it('should return 500 if embedding fails', async () => {
            mockGetEmbedding.mockRejectedValue(new Error('Embedding engine down'));
             const res = await request(app)
                .post('/api/memory/search')
                .send(searchQuery);
             expect(res.statusCode).toBe(500);
             expect(res.body).toHaveProperty('error', 'Failed to search memory');
        });

         it('should return 500 if Qdrant search fails', async () => {
            mockGetEmbedding.mockResolvedValue(mockQueryEmbedding);
             mockSearch.mockRejectedValue(new Error('Qdrant search error'));
             const res = await request(app)
                .post('/api/memory/search')
                .send(searchQuery);
             expect(res.statusCode).toBe(500);
             expect(res.body).toHaveProperty('error', 'Failed to search memory');
             expect(mockSetPayload).not.toHaveBeenCalled();
        });
    });
});
