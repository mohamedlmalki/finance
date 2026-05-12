// --- FILE: server/flow-handler.js ---
const { Queue } = require('bullmq');
const { connection } = require('./worker'); 
const db = require('./postgres'); 
const { cliColors } = require('./utils');

const spawnQueueProcessor = async (socket, data, isMaster = false) => {
    if (data.isSearchRequest) {
        if (db) { 
            const res = await db.query("SELECT * FROM job_results WHERE profileName = $1 AND jobId LIKE $2 AND (identifier ILIKE $3 OR details ILIKE $3) ORDER BY timestamp DESC LIMIT 500", [data.selectedProfileName, `Flow_${data.selectedProfileName}%`, `%${data.query}%`]); 
            socket.emit('databaseSearchResults', { profileName: data.selectedProfileName, results: res.rows }); 
        }
        return;
    }
    if (data.isExportRequest) {
        if (db) { 
            const res = await db.query("SELECT * FROM job_results WHERE profileName = $1 AND jobId LIKE $2 ORDER BY timestamp DESC", [data.selectedProfileName, `Flow_${data.selectedProfileName}%`]); 
            socket.emit('fullExportData', { profileName: data.selectedProfileName, results: res.rows }); 
        }
        return;
    }

    let { webhookUrl, bulkData, staticData, bulkField, delay, selectedProfileName, activeProfile, trackingEnabled, targetHtmlField, startingRowNumber, stopAfterFailures, appendAccountName, accountIndex, useStrictCallback, workerUrl, isHeavyJob } = data;
    
    if (!isMaster) {
        console.log(`\n${cliColors.yellowBold}🧠 [FLOW BATCH]${cliColors.reset} Pushing account ${cliColors.whiteBold}${selectedProfileName}${cliColors.reset} to Redis Queue...`);
    }

    const jobType = `Flow_${selectedProfileName}`; 
    const jobId = `${jobType}_${selectedProfileName}`;
    const baseRowNumber = Number(startingRowNumber) || 1;

    try {
        let rows = [];
        try { 
            rows = JSON.parse(bulkData); 
        } catch (e) { 
            rows = bulkData.split('\n').filter(x => x.trim()).map(val => ({ [bulkField]: val.trim() })); 
        }

        const queueName = `FlowQueue_${selectedProfileName}`;
        const accountQueue = new Queue(queueName, { connection });

        const jobs = rows.map((row, index) => {
            const payload = { ...row };
            let identifier = payload[bulkField] || payload.name || payload.email || `Row ${index + 1}`;
            if (typeof identifier === 'object') identifier = JSON.stringify(identifier);

            return {
                name: 'processFlow',
                data: {
                    rowData: payload, identifier, webhookUrl, selectedProfileName, delay, activeProfile, 
                    rowNumber: baseRowNumber + index, trackingEnabled, targetHtmlField, bulkField, staticData, jobId,
                    appendAccountName, accountIndex, useStrictCallback, workerUrl, isHeavyJob 
                },
                opts: { removeOnComplete: true, removeOnFail: true }
            };
        });

        const initialStatus = isMaster ? 'queued' : 'running';

        if (db) { 
            await db.query("DELETE FROM jobs WHERE id = $1", [jobId]); 
            await db.upsertJob({ 
                id: jobId, profileName: selectedProfileName, jobType: jobType, 
                status: initialStatus, totalToProcess: rows.length, consecutiveFailures: 0, 
                stopAfterFailures: Number(stopAfterFailures) || 0, formData: data, 
                processingStartTime: new Date().toISOString() 
            }); 
        }

        await accountQueue.pause();
        await accountQueue.drain(true).catch(() => {});
        
        // 🚀 REDIS SAFETY CATCH: Prevents the BUSY Memurai error from crashing Node
        try { 
            await accountQueue.obliterate({ force: true }); 
        } catch(e) {
            console.log(`[REDIS] Obliterate busy on ${queueName}, falling back to manual deletion.`);
            const rawKeys = await connection.keys(`bull:${queueName}:*`);
            if (rawKeys.length > 0) await connection.del(...rawKeys);
        }
        
        await accountQueue.resume();
        
        // 🚀 THROTTLED CHUNKING: Protects the Lua Scripts
        const BATCH_SIZE = 250; // Dropped to 250 to keep Redis fast
        for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
            const batch = jobs.slice(i, i + BATCH_SIZE);
            await accountQueue.addBulk(batch);
            
            // Give Redis a 200ms breather so it can process pub/sub and other worker scripts
            await new Promise(resolve => setTimeout(resolve, 200)); 
        }

        if (!isMaster) {
            socket.emit('jobStarted', { profileName: selectedProfileName, jobType: jobType });
        }
        
    } catch (err) { 
        socket.emit('bulkError', { message: err.message, profileName: selectedProfileName, jobType: `Flow_${selectedProfileName}` }); 
    }
};

const handleStartMasterBatch = async (socket, data) => {
    const { payloads, concurrency: masterConcurrency } = data;
    console.log(`\n${cliColors.yellowBold}🧠 [FLOW MASTER BATCH]${cliColors.reset} Pushing ${cliColors.whiteBold}${payloads.length}${cliColors.reset} accounts to Redis Queues...`);
    for (const payload of payloads) {
        payload.masterConcurrency = masterConcurrency; 
        await spawnQueueProcessor(socket, payload, true);
    }
};

const handleStartBulkFlowJob = async (socket, data) => { 
    await spawnQueueProcessor(socket, data, false); 
};

const handleGetFailedFlowItems = async (socket, data) => {
    const { jobId, limit, offset } = data;
    try {
        if (db) {
            const results = await db.getFailedFlowItems(jobId, limit || 50, offset || 0);
            socket.emit('failedFlowItemsResult', { jobId, items: results });
        }
    } catch (error) {
        console.error("Error fetching failed items:", error);
    }
};

const killClock = async (profileName) => {
    const queueName = `FlowQueue_${profileName}`; 
    try {
        const q = new Queue(queueName, { connection });
        await q.pause();
        await q.obliterate({ force: true });
        await q.close();
    } catch(e) {}
};
const setActiveJobs = () => {}; 

module.exports = { setActiveJobs, handleStartBulkFlowJob, handleStartMasterBatch, killClock, handleGetFailedFlowItems };