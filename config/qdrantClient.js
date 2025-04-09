const { QdrantClient } = require('@qdrant/js-client');
require('dotenv').config();

const client = new QdrantClient({
    host: process.env.QDRANT_HOST || 'localhost',
    port: parseInt(process.env.QDRANT_PORT || '6333', 10),
    // Uncomment the line below if you have API key authentication enabled
    // apiKey: process.env.QDRANT_API_KEY,
    // You might need 'https: true' if Qdrant is served over HTTPS
});

console.log(`Qdrant client configured for ${process.env.QDRANT_HOST}:${process.env.QDRANT_PORT}`);

// Ensure the collection exists (simple check)
async function ensureCollectionExists() {
    const collectionName = process.env.QDRANT_COLLECTION || 'streamer_memory';
    try {
        await client.getCollection(collectionName);
        console.log(`Collection "${collectionName}" already exists.`);
    } catch (error) {
        // Basic check for "Not Found" - might need refinement based on exact error
        if (error.message && (error.message.includes('Not found') || error.status === 404)) {
            console.log(`Collection "${collectionName}" not found. Consider creating it.`);
            // Optionally create it here if desired, but requires vector params
            // await client.createCollection(collectionName, { vectors: { size: 384, distance: 'Cosine' } }); // Adjust size!
        } else {
            console.error("Error checking collection:", error);
        }
    }
}

// Run check on startup (don't await if startup time is critical)
ensureCollectionExists();

module.exports = client;