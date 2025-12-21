const GameDig = require('gamedig');
const axios = require('axios');

// CONFIG
const SERVER_IP = '149.202.87.35';
const SERVER_PORT = 27015;
const API_URL = 'https://dstracker.mshstack.com/receive_data.php';
const API_KEY = 'dsgamingtrackermshstack';
const INTERVAL = 60 * 1000; // 60s

console.log("Starting Render Poller (Plan B) -> " + API_URL);

async function poll() {
    try {
        // 1. Query Game Server (Render does this)
        // 1. Query Game Server (Render does this)
        const state = await GameDig.query({
            type: 'cs16',
            host: SERVER_IP,
            port: SERVER_PORT,
            maxAttempts: 3,     // Try 3 times before failing
            socketTimeout: 5000 // Wait 5 seconds per try
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
        const axiosConfig = {
            timeout: 10000,
            headers: { 'User-Agent': 'DSGC-Tracker-Poller/1.0' }
        };
        const res = await axios.post(API_URL, payload, axiosConfig);
        console.log(`[${new Date().toLocaleTimeString()}] Sent ${state.players.length} players. Response: ${res.data}`);

    } catch (e) {
        console.error(`[${new Date().toLocaleTimeString()}] Poll Error: ${e.message}`);

        // If it's a 404, warn about the URL
        if (e.response && e.response.status === 404) {
            console.error("CRITICAL: API URL returned 404. Check if receive_data.php exists at: " + API_URL);
        }

        // If GameDig failed or network failed, tell Namecheap server is down
        try {
            await axios.post(API_URL, { key: API_KEY, error: 'down' }, {
                timeout: 5000,
                headers: { 'User-Agent': 'DSGC-Tracker-Poller/1.0' }
            });
        } catch (err) {
            console.error("Failed to report DOWN status to API.");
        }
    }
}

setInterval(poll, INTERVAL);
poll(); // Run once immediately

// Health Check
const http = require('http');
http.createServer((req, res) => { res.end('Poller Active'); }).listen(process.env.PORT || 8080);
