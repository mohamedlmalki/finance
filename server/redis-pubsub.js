// --- FILE: server/redis-pubsub.js ---
const Redis = require('ioredis');

// We need TWO connections. One for listening, one for shouting.
const publisher = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const subscriber = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const CHANNEL_NAME = 'ZOHO_FINANCE_EVENTS';

module.exports = {
    // WORKER SERVER uses this to shout to the Web Server
    emitToWeb: (eventName, data) => {
        const payload = JSON.stringify({ eventName, data });
        publisher.publish(CHANNEL_NAME, payload);
    },

    // WEB SERVER uses this to listen to the Workers
    listenForWorkers: (socketIoInstance) => {
        subscriber.subscribe(CHANNEL_NAME, (err) => {
            if (err) console.error("❌ Redis Pub/Sub Subscription Failed:", err);
            else console.log("📡 Web Server Listening for Worker Events via Redis.");
        });

        // When the Web Server hears a shout, it forwards it to React!
        subscriber.on('message', (channel, message) => {
            if (channel === CHANNEL_NAME) {
                try {
                    const { eventName, data } = JSON.parse(message);
                    socketIoInstance.emit(eventName, data); // Push to Frontend
                } catch (e) {
                    console.error("PubSub Parse Error", e);
                }
            }
        });
    }
};