import dotenv from 'dotenv';
dotenv.config();
import express from'express';
import schedule from 'node-schedule';
import memoryRoutes from './routes/memory.js';
import { runTrimming } from './services/trimmingService.js';
// Ensure embedding model is loaded (optional warm-up)
import './config/embeddingHelper.js';


const app = express();
const port = process.env.PORT || 3011;

// --- Middleware ---
app.use(express.json()); // Parse JSON request bodies
// Optional: Add CORS middleware if your AI streamer app is on a different origin
// const cors = require('cors');
// app.use(cors());

// --- Routes ---
app.get('/', (req, res) => {
  res.send('Memory Manager API is running!');
});
app.use('/api/memory', memoryRoutes); // Mount memory-related routes

// --- Scheduler for Trimming ---
const trimSchedule = process.env.TRIM_SCHEDULE || '0 4 * * *'; // Default: 4 AM daily
console.log(`Scheduling memory trimming with rule: "${trimSchedule}"`);

schedule.scheduleJob(trimSchedule, async () => {
    console.log(`[${new Date().toISOString()}] Running scheduled memory trimming...`);
    try {
        await runTrimming();
        console.log(`[${new Date().toISOString()}] Scheduled memory trimming finished.`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error during scheduled memory trimming execution:`, error);
    }
});


// --- Global Error Handler (Basic) ---
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).send('Something broke!');
});


// --- Start Server ---
app.listen(port, () => {
  console.log(`Memory Manager API listening on port ${port}`);
  // Initial check to confirm Qdrant connection (client already does this)
});

// --- Graceful Shutdown (Optional but Recommended) ---
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    schedule.gracefulShutdown().then(() => {
         console.log('Scheduler shut down gracefully.');
         // Add any other cleanup here (e.g., closing DB connections if needed)
         process.exit(0);
    }).catch(err => {
         console.error('Error during scheduler shutdown:', err);
         process.exit(1);
    });

});
process.on('SIGINT', () => {
     console.log('SIGINT signal received: closing HTTP server');
      schedule.gracefulShutdown().then(() => {
         console.log('Scheduler shut down gracefully.');
         process.exit(0);
    }).catch(err => {
         console.error('Error during scheduler shutdown:', err);
         process.exit(1);
    });
});
