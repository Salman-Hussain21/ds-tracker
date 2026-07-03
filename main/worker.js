// Robust Diagnostic Imports to report exact missing modules in production logs
const missingDeps = [];
let dotenv, GameDig, axios, http, https;

try { dotenv = require('dotenv'); } catch (e) { missingDeps.push('dotenv (' + e.message + ')'); }
try { GameDig = require('gamedig'); } catch (e) { missingDeps.push('gamedig (' + e.message + ')'); }
try { axios = require('axios'); } catch (e) { missingDeps.push('axios (' + e.message + ')'); }
try { http = require('http'); } catch (e) { missingDeps.push('http (' + e.message + ')'); }
try { https = require('https'); } catch (e) { missingDeps.push('https (' + e.message + ')'); }

if (missingDeps.length > 0) {
    console.error('\n======================================================');
    console.error('[FATAL STARTUP ERROR] Missing or corrupt dependencies:');
    missingDeps.forEach(dep => console.error(`  - ${dep}`));
    console.error('Please run "npm install" in the api directory or check your build step!');
    console.error('======================================================\n');
    process.exit(1);
}

// Initialize dotenv
dotenv.config();

// Keep-Alive Agents to optimize performance and prevent socket leaks
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

// CONFIG
const SERVERS = [
    { ip: '149.202.87.35', port: 27015, name: 'Public' },
    { ip: '149.202.87.35', port: 27016, name: 'AFK' },
    { ip: '149.202.87.35', port: 27018, name: 'Deathmatch' }
];

const API_URL = process.env.API_URL || 'https://dsgc.live/receive_data.php';
const API_KEY = 'dsgamingtrackermshstack';
const INTERVAL = 6 * 1000; // 6 seconds

// Create persistent axios instance for speed
const apiClient = axios.create({
    timeout: 8000, // Fail fast under heavy network latency to avoid stacking
    httpAgent,
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
    }
});

console.log(`[${new Date().toISOString()}] Initializing Multi-Server Poller...`);
console.log(`[Target API]: ${API_URL}`);
console.log(`[Targets]: ${SERVERS.length} servers configured.`);

async function pollServer(server) {
    try {
        // 1. Query Game Server (Fast query settings)
        const state = await GameDig.query({
            type: 'cs16',
            host: server.ip,
            port: server.port,
            maxAttempts: 1,
            socketTimeout: 2000
        });

        // 2. Prepare Data
        const payload = {
            key: API_KEY,
            server_port: server.port, // Critical for backend to distinguish
            name: state.name,
            map: state.map,
            players: state.players.map(p => ({
                name: p.name,
                raw: p.raw
            })),
            num_players: state.players.length,
            max_players: state.maxplayers
        };

        // 3. Send to Backend
        await apiClient.post(API_URL, payload);

    } catch (e) {
        const errorData = e.response && e.response.data ? e.response.data : e.message;
        const errorDataStr = typeof errorData === 'string' ? errorData.substring(0, 100) : JSON.stringify(errorData);
        console.error(`[${new Date().toLocaleTimeString()}] [${server.name} Error]: ${e.message} - ${errorDataStr}`);

        // Report error to API if possible (server down)
        try {
            await apiClient.post(API_URL, {
                key: API_KEY,
                server_port: server.port,
                error: 'down'
            });
        } catch (reportError) { }
    }
}

async function poll() {
    const startTime = Date.now();
    try {
        await Promise.all(SERVERS.map(s => pollServer(s)));
    } catch (err) {
        console.error(`[Poll Error]: ${err.message}`);
    } finally {
        const elapsed = Date.now() - startTime;
        const delay = Math.max(100, INTERVAL - elapsed);
        setTimeout(poll, delay);
    }
}

// Start Polling (Recursive setTimeout avoids overlapping loops)
poll();

// Anti-Crash & Health Check
process.on('uncaughtException', (err) => {
    console.error(`[FATAL] Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Health Check Server (Keep Render Alive)
const PORT = parseInt(process.env.PORT) || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Poller is Active and Healthy');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`[Health Check] Server listening on port ${PORT}`);
    
    // Auto-ping to prevent Render sleep on free tier
    const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
    if (RENDER_EXTERNAL_URL) {
        console.log(`[Keep-Alive] Setup to ping ${RENDER_EXTERNAL_URL} every 14 minutes.`);
        setInterval(async () => {
            try {
                console.log(`[Keep-Alive] Pinging self to prevent sleep...`);
                await axios.get(RENDER_EXTERNAL_URL);
            } catch (err) {
                console.error(`[Keep-Alive] Error pinging self: ${err.message}`);
            }
        }, 14 * 60 * 1000); // 14 minutes
    } else {
        console.log('[Keep-Alive] RENDER_EXTERNAL_URL not found. If on Render free tier, self-ping won\'t work unless set.');
    }
});

