const qdrantClient = require('../config/qdrantClient');
const { calculateTrimScore } = require('./memoryLogic');
require('dotenv').config();

const collectionName = process.env.QDRANT_COLLECTION || 'streamer_memory';
const TRIM_THRESHOLD = parseFloat(process.env.TRIM_THRESHOLD || '500000');
const TRIM_BATCH_SIZE = parseInt(process.env.TRIM_BATCH_SIZE || '100', 10);
const MIN_AGE_SECONDS = process.env.MIN_AGE_BEFORE_TRIM_SECONDS
    ? parseInt(process.env.MIN_AGE_BEFORE_TRIM_SECONDS, 10)
    : null;


async function runTrimming() {
    console.log(`Starting memory trimming process. Threshold: ${TRIM_THRESHOLD}`);
    const currentTime = Date.now() / 1000; // Seconds
    let offset = null;
    let totalScanned = 0;
    let totalDeleted = 0;
    const idsToDeleteBatch = [];

    // Prepare filter if minimum age is set
    let scrollFilter = null;
    if (MIN_AGE_SECONDS !== null && MIN_AGE_SECONDS > 0) {
        scrollFilter = {
            must: [
                {
                    key: "timestamp_created",
                    range: { lt: currentTime - MIN_AGE_SECONDS }
                }
            ]
        };
         console.log(`Trimming filter: Only considering points older than ${MIN_AGE_SECONDS} seconds.`);
    }


    try {
        do {
            const scrollResponse = await qdrantClient.scroll(collectionName, {
                offset: offset,
                limit: TRIM_BATCH_SIZE,
                with_payload: true, // Need payload for calculation
                with_vector: false, // Don't need vectors
                filter: scrollFilter
            });

            const points = scrollResponse.points;
            totalScanned += points.length;

            for (const point of points) {
                if (!point.payload) continue; // Skip if payload is missing

                const trimScore = calculateTrimScore(point.payload, currentTime);

                if (trimScore > TRIM_THRESHOLD) {
                    idsToDeleteBatch.push(point.id);
                }
            }

            // Delete collected IDs if batch is full or if this is the last page
            if (idsToDeleteBatch.length >= TRIM_BATCH_SIZE || (points.length === 0 && idsToDeleteBatch.length > 0) || (scrollResponse.next_page_offset === null && idsToDeleteBatch.length > 0)) {
                if (idsToDeleteBatch.length > 0) {
                    console.log(`Attempting to delete ${idsToDeleteBatch.length} points...`);
                    await qdrantClient.delete(collectionName, {
                        points: idsToDeleteBatch
                    });
                    totalDeleted += idsToDeleteBatch.length;
                    console.log(`Deleted ${idsToDeleteBatch.length} points. Total deleted so far: ${totalDeleted}`);
                    idsToDeleteBatch.length = 0; // Clear the batch
                }
            }

            offset = scrollResponse.next_page_offset;
            // Optional: Add a small delay between batches if needed
            // await new Promise(resolve => setTimeout(resolve, 50));

        } while (offset !== null); // Continue until Qdrant returns null offset

        console.log(`Memory trimming finished. Scanned: ${totalScanned}, Deleted: ${totalDeleted}.`);

    } catch (error) {
        console.error("Error during memory trimming:", error);
        // Handle potential partial failures if needed
    }
}

module.exports = { runTrimming };
