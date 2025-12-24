const GameDig = require('gamedig');
const axios = require('axios');
const http = require('http');

// CONFIG
const SERVER_IP = '149.202.87.35';
const SERVER_PORT = 27015;
const API_URL = process.env.API_URL || 'https://dstracker.mshstack.com/receive_data.php';
const API_KEY = 'dsgamingtrackermshstack';
const INTERVAL = 3 * 1000; // 3 seconds

// Create persistent axios instance for speed
const apiClient = axios.create({
    timeout: 15000,
    headers: {
        'User-Agent': 'DSGC-Tracker-Poller/2.0',
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
    }
});

console.log(`[${new Date().toISOString()}] Initializing Production Poller...`);
console.log(`[Target API]: ${API_URL}`);

async function poll() {
    const startTime = Date.now();
    try {
        // 1. Query Game Server
        const state = await GameDig.query({
            type: 'cs16',
            host: SERVER_IP,
            port: SERVER_PORT,
            maxAttempts: 3,
            socketTimeout: 3000
        });

        // 2. Prepare Data
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

        // 3. Send to Namecheap
        const res = await apiClient.post(API_URL, payload);
        const duration = Date.now() - startTime;
        console.log(`[${new Date().toLocaleTimeString()}] Poll Success: ${state.players.length} players | API Latency: ${duration}ms | Response: ${res.data}`);

    } catch (e) {
        const errorType = e.response ? `API Error (${e.response.status})` : `Network/Gamedig Error (${e.code || e.message})`;
        console.error(`[${new Date().toLocaleTimeString()}] Poll Failure: ${errorType}`);

        if (e.response && e.response.status === 404) {
            console.error("CRITICAL: API endpoint not found. Verify receive_data.php at: " + API_URL);
        }

        // Report error to API if possible
        try {
            await apiClient.post(API_URL, { key: API_KEY, error: 'down' });
        } catch (reportError) {
            // Silently ignore reporting errors to prevent loops
        }
    }
}

// Start Polling
setInterval(poll, INTERVAL);
poll();

// Anti-Crash & Health Check
process.on('uncaughtException', (err) => {
    console.error(`[FATAL] Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Health Check Server (Keep Render Alive)
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Poller is Active and Healthy');
}).listen(process.env.PORT || 8080, () => {
    console.log(`[Health Check] Server listening on port ${process.env.PORT || 8080}`);
});
