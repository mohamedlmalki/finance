// --- FILE: server/worker.js ---
const IORedis = require('ioredis');

const connection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
});

connection.on('error', (err) => console.error('\x1b[31m[REDIS ERROR]\x1b[0m', err.message));
connection.on('connect', () => console.log('\x1b[32m[REDIS] Connected to Redis Queue Server.\x1b[0m'));

module.exports = {
    connection
};