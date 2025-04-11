import dotenv from 'dotenv';
dotenv.config();

const modelPath = process.env.EMBEDDING_MODEL_PATH || '/app/model';
const modelName = process.env.EMBEDDING_MODEL_NAME || 'Xenova/all-MiniLM-L6-v2';
let pipelineInstance = null;

// Lazy load the pipeline
async function getPipeline() {
    if (!pipelineInstance) {
        try {
            // Dynamically import transformers
            const { pipeline, env } = await import('@xenova/transformers');
            // Optional: Disable local model download progress bars
            env.allowLocalModels = true;
            env.remoteHost = ''; // Avoid checking remote availability if only using local
            env.allowRemoteModels = false;
            env.cacheDir = '/app/model'
            console.log(`Loading embedding model from: ${modelPath}... (This might take a while the first time)`);
            // 'feature-extraction' is the task for getting embeddings
            pipelineInstance = await pipeline('feature-extraction', modelName, { quantized: false, cache_dir: modelPath }); // Set quantized:true for lower RAM usage
            console.log("Embedding model loaded successfully.");
        } catch (error) {
            console.error("Fatal error loading embedding model:", error);
            process.exit(1); // Exit if model can't load - critical failure
        }
    }
    return pipelineInstance;
}

export async function getEmbedding(text) {
    if (!text || typeof text !== 'string') {
        throw new Error("Invalid input text for embedding.");
    }

    try {
        const pipe = await getPipeline();
        // The output needs processing to get the actual embedding vector
        const result = await pipe(text, { pooling: 'mean', normalize: true });
        // Convert Tensor object to a standard JavaScript array
        return Array.from(result.data);
    } catch (error) {
        console.error(`Error generating embedding for text "${text.substring(0, 50)}...":`, error);
        // Depending on severity, you might return null, throw, or handle differently
        throw new Error("Embedding generation failed.");
    }
}

// Warm up the model on startup (optional, but avoids delay on first request)
getPipeline().catch(err => console.error("Error during model warm-up:", err));

/*
// --- Example for OpenAI (requires `npm install openai`) ---
// const { OpenAI } = require('openai');
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const modelName = process.env.EMBEDDING_MODEL_NAME || 'text-embedding-ada-002';

// async function getEmbedding(text) {
//     if (!text || typeof text !== 'string') {
//         throw new Error("Invalid input text for embedding.");
//     }
//     try {
//         const response = await openai.embeddings.create({
//             model: modelName,
//             input: text,
//             encoding_format: "float", // Recommended format
//         });
//         return response.data[0].embedding;
//     } catch (error) {
//         console.error(`Error generating OpenAI embedding for text "${text.substring(0, 50)}...":`, error);
//         throw new Error("OpenAI Embedding generation failed.");
//     }
// }
// module.exports = { getEmbedding };
*/
