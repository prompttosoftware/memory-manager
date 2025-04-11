// services/trimmingService.js
import qdrantClient from '../config/qdrantClient.js';
import { calculateTrimScore } from './memoryLogic.js';
import dotenv from 'dotenv';
dotenv.config();

const collectionName = process.env.QDRANT_COLLECTION || 'streamer_memory';
const TRIM_THRESHOLD = parseFloat(process.env.TRIM_THRESHOLD || '500000');
const TRIM_BATCH_SIZE = parseInt(process.env.TRIM_BATCH_SIZE || '100', 10);
const MIN_AGE_SECONDS = process.env.MIN_AGE_BEFORE_TRIM_SECONDS
    ? parseInt(process.env.MIN_AGE_BEFORE_TRIM_SECONDS, 10)
    : null;

export async function runTrimming() {
    console.log(`Starting memory trimming process. Threshold: ${TRIM_THRESHOLD}`);
    const currentTime = Date.now() / 1000; // Seconds
    let offset = null;
    let totalScanned = 0;
    let totalDeleted = 0;

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
            // Process deletion for this scroll batch independently.
            const idsToDeleteBatch = [];

            for (const point of points) {
                if (!point.payload) continue; // Skip if payload is missing

                const trimScore = calculateTrimScore(point.payload, currentTime);
                if (trimScore > TRIM_THRESHOLD) {
                    idsToDeleteBatch.push(point.id);
                }
            }

            // Immediately delete candidates for the current scroll batch if any.
            if (idsToDeleteBatch.length > 0) {
                console.log(`Attempting to delete ${idsToDeleteBatch.length} points...`);
                // Pass a shallow copy so that later modification (clearing the array) does not affect the deletion call.
                await qdrantClient.delete(collectionName, { points: [...idsToDeleteBatch] });
                totalDeleted += idsToDeleteBatch.length;
                console.log(`Deleted ${idsToDeleteBatch.length} points. Total deleted so far: ${totalDeleted}`);
            }

            offset = scrollResponse.next_page_offset;
        } while (offset !== null);

        console.log(`Memory trimming finished. Scanned: ${totalScanned}, Deleted: ${totalDeleted}.`);

    } catch (error) {
        console.error("Error during memory trimming:", error);
    }
}
