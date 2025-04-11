import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import qdrantClient from '../config/qdrantClient.js';
import { getEmbedding } from '../config/embeddingHelper.js';
import { calculateInitialSpecificity, calculateAccessSpecificity } from '../services/memoryLogic.js';
import { setLastRetrievalCount, getLastRetrievalCount } from '../utils/state.js';

const router = express.Router();
const collectionName = process.env.QDRANT_COLLECTION || 'streamer_memory';

// POST /api/memory - Ingest a new memory
router.post('/', async (req, res) => {
    const { content, memory_type, source_id } = req.body;

    if (!content || !memory_type) {
        return res.status(400).json({ error: 'Missing required fields: content, memory_type' });
    }

    try {
        const embedding = await getEmbedding(content);
        const currentTime = Date.now() / 1000; // Use seconds for consistency
        const lastK = getLastRetrievalCount();
        const initialSpecificity = calculateInitialSpecificity(lastK);
        const initialWeightedScore = initialSpecificity; // Start score based on context specificity

        const point = {
            id: uuidv4(),
            vector: embedding,
            payload: {
                content: content,
                timestamp_created: currentTime,
                timestamp_last_accessed: currentTime,
                weighted_access_score: initialWeightedScore,
                memory_type: memory_type,
                ...(source_id && { source_id: source_id }) // Include source_id only if provided
            }
        };

        await qdrantClient.upsertPoints(collectionName, { points: [point] });
        console.log(`Ingested memory: ${point.id} (Type: ${memory_type}, Initial Score: ${initialWeightedScore.toFixed(2)})`);
        res.status(201).json({ id: point.id, message: 'Memory ingested successfully' });

    } catch (error) {
        console.error("Error ingesting memory:", error);
        res.status(500).json({ error: 'Failed to ingest memory', details: error.message });
    }
});

// POST /api/memory/search - Search memories and update retrieved ones
router.post('/search', async (req, res) => {
    const { query, top_k = 50, retrieve_n = 10 } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Missing required field: query' });
    }
    if (retrieve_n > top_k) {
         return res.status(400).json({ error: 'retrieve_n cannot be greater than top_k' });
    }

    try {
        const queryEmbedding = await getEmbedding(query);

        const searchResults = await qdrantClient.search(collectionName, {
            vector: queryEmbedding,
            limit: top_k,
            with_payload: true, // Need payload to update score and return content
            // score_threshold: 0.5 // Optional: Add a minimum similarity threshold
        });

        const k = searchResults.length; // Actual number found
        setLastRetrievalCount(k); // Update global state

        const selectedResults = searchResults.slice(0, retrieve_n);

        if (selectedResults.length > 0) {
            const accessSpecificity = calculateAccessSpecificity(k);
            const currentTime = Date.now() / 1000;
            const pointsToUpdate = [];

            selectedResults.forEach(result => {
                const currentScore = result.payload?.weighted_access_score || 0;
                pointsToUpdate.push({
                    id: result.id,
                    payload: {
                        weighted_access_score: currentScore + accessSpecificity,
                        timestamp_last_accessed: currentTime
                    }
                });
            });

            // Update scores and timestamps asynchronously (fire and forget for lower latency)
            // If guaranteed update is needed, await this.
            qdrantClient.setPayload(collectionName, {
                payload: pointsToUpdate[0].payload, // setPayload seems to expect a single payload structure? Let's try updating one by one or check batch update method.
                points: pointsToUpdate.map(p => p.id), // Specify which points
                 wait: false // Don't wait for confirmation if latency sensitive
            }).catch(updateError => {
                console.error("Error updating retrieved memory scores/timestamps:", updateError);
                // Log this error, but don't fail the search response
            });

            console.log(`Search returned ${k} raw results. Updated ${selectedResults.length} memories with specificity ${accessSpecificity.toFixed(2)}.`);

        } else {
            console.log(`Search returned 0 results for query: "${query.substring(0,50)}..."`);
        }


        // Return the selected results (including payload)
        res.status(200).json(selectedResults);

    } catch (error) {
        console.error("Error searching memory:", error);
        res.status(500).json({ error: 'Failed to search memory', details: error.message });
    }
});

export default router;
