// --- FILE: server/queue.js ---
const IORedis = require('ioredis');
const { QueueEvents } = require('bullmq');

// Standard local Redis connection
const connection = new IORedis({
    host: '127.0.0.1',
    port: 6379,
    maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
    console.error('\x1b[31m[REDIS ERROR] Ensure Redis is running on port 6379:\x1b[0m', err.message);
});

connection.on('connect', () => {
    console.log('\x1b[32m[REDIS] Connected to Redis Queue Server.\x1b[0m');
});

// We will dynamically create QueueEvents inside the handler, 
// but we export the central connection here.
module.exports = {
    connection
};