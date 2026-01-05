require('dotenv').config();
const GameDig = require('gamedig');
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const AFKTracker = require('./afk_tracker');

// CONFIG
const SERVER_IP = process.env.SERVER_IP || '149.202.87.35';
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 27015;
const API_URL = process.env.API_URL || 'https://dsgc.live/receive_data.php';
const API_KEY = process.env.API_KEY || 'dsgamingtrackermshstack';
const POLL_INTERVAL = 6 * 1000; // 6 seconds
const DB_FLUSH_INTERVAL = 60 * 1000; // 60 seconds

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Initialize AFK Tracker
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};
const tracker = new AFKTracker(dbConfig);

// Create persistent axios instance for Legacy PHP Sync
const apiClient = axios.create({
    timeout: 15000,
    headers: {
        'User-Agent': 'DSGC-Tracker-Poller/2.0',
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
    }
});

console.log(`[${new Date().toISOString()}] Initializing Service & Poller...`);
console.log(`[Target Game Server]: ${SERVER_IP}:${SERVER_PORT}`);

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.send('DSGC Poller & AFK Service is Running');
});

// Endpoint: Real-time Player Status (Active/AFK)
app.get('/api/players/status', (req, res) => {
    try {
        const status = tracker.getLiveStatus();
        res.json({
            timestamp: new Date().toISOString(),
            server: `${SERVER_IP}:${SERVER_PORT}`,
            count: status.length,
            players: status
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Poller Logic ---
let lastFlushTime = Date.now();

async function poll() {
    const startTime = Date.now();
    try {
        // 1. Query Game Server
        const state = await GameDig.query({
            type: 'cs16',
            host: SERVER_IP,
            port: SERVER_PORT,
            maxAttempts: 2,
            socketTimeout: 3000
        });

        // 2. Process AFK Logic
        tracker.processPoll(state.players);

        // 3. Flush to DB if interval passed
        if (Date.now() - lastFlushTime > DB_FLUSH_INTERVAL) {
            await tracker.flushToDB();
            lastFlushTime = Date.now();
        }

        // 4. Send to Legacy PHP API (Keep existing functionality)
        const payload = {
            key: API_KEY,
            name: state.name,
            map: state.map,
            players: state.players.map(p => ({
                name: p.name,
                raw: p.raw
            })),
            num_players: state.players.length,
            max_players: state.maxplayers
        };

        // We don't await this to avoid blocking the loop, but handle catch
        apiClient.post(API_URL, payload)
            .then(res => {
                // Optional: console.log(`[PHP Sync] Success`);
            })
            .catch(e => {
                console.error(`[PHP Sync] Failed: ${e.message}`);
            });

        const duration = Date.now() - startTime;
        // console.log(`[Poll] Success: ${state.players.length} players | ${duration}ms`);

    } catch (e) {
        const errorType = e.response ? `API Error (${e.response.status})` : `Network/Gamedig Error (${e.code || e.message})`;
        console.error(`[Poll] Failure: ${errorType}`);
    }
}

// Start Server
app.listen(PORT, () => {
    console.log(`[API] Server listening on port ${PORT}`);

    // Start Polling Loop
    setInterval(poll, POLL_INTERVAL);
    poll(); // Initial run
});

// Error Handling
process.on('uncaughtException', (err) => {
    console.error(`[FATAL] Uncaught Exception: ${err.message}`);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
});
