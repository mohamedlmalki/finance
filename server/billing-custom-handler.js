// --- FILE: server/billing-custom-handler.js ---
const { makeApiCall, parseError } = require('./utils');
const { Queue } = require('bullmq');
const { connection } = require('./worker'); 
const db = require('./postgres'); 

const handleFetchBillingModuleFields = async (socket, data) => {
    const { selectedProfileName, moduleApiName, activeProfile } = data;
    try {
        console.log(`\n📡 [BILLING] Fetching fields for: ${moduleApiName}`);
        const response = await makeApiCall('get', `/settings/fields?entity=${moduleApiName}`, null, activeProfile, 'billing');
        
        let fields = [];
        if (response.data && response.data.fields) fields = response.data.fields;
        
        if (fields.length === 0) throw new Error("No fields found for this module.");

        socket.emit('customModuleFieldsResult', { success: true, profileName: selectedProfileName, fields });
        console.log(`✅ [BILLING] Success! Found ${fields.length} fields.`);
    } catch (error) {
        const parsed = parseError(error);
        console.error(`❌ [BILLING ERROR] ${parsed.message}`);
        socket.emit('customModuleFieldsResult', { success: false, profileName: selectedProfileName, message: parsed.message });
    }
};

// 📦 START SINGLE ACCOUNT
const handleStartBulkBillingCustomJob = async (socket, data) => {
    const { moduleApiName, bulkData, staticData, bulkField, delay, selectedProfileName, activeProfile, concurrency, stopAfterFailures, trackingEnabled, campaignName, targetHtmlField, startingRowNumber, appendAccountName, accountIndex, multilineFields } = data;

    console.log(`\n🧠 [BILLING SINGLE BATCH] Pushing account ${selectedProfileName} to Redis Queue...`);

    try {
        const queueName = `${moduleApiName}Queue_${selectedProfileName}`;
        const accountQueue = new Queue(queueName, { connection });

        let rows = [];
        try { 
            rows = JSON.parse(bulkData); 
            if (!Array.isArray(rows)) throw new Error("Bulk Data is not an array"); 
        } catch (e) {
            if (bulkField) rows = bulkData.split('\n').filter(x => x.trim() !== '').map(val => ({ [bulkField]: val.trim() }));
            else throw new Error("Invalid JSON and no bulk field selected.");
        }

        const baseRowNumber = Number(startingRowNumber) || 1;

        const jobs = rows.map((row, index) => {
            const payload = { ...staticData, ...row };
            let identifier = payload[bulkField] || payload.name || payload.email || `Row ${index + 1}`;
            if (typeof identifier === 'object') identifier = JSON.stringify(identifier);

            return { 
                name: 'processModule', 
                data: { 
                    rowData: payload, identifier, moduleApiName, actualTargetModule: moduleApiName, selectedProfileName, 
                    delay, activeProfile, rowNumber: baseRowNumber + index, trackingEnabled, campaignName, targetHtmlField,
                    appendAccountName, accountIndex, multilineFields
                }, 
                opts: { removeOnComplete: true, removeOnFail: true } 
            };
        });

        const jobId = `${moduleApiName}_${selectedProfileName}`;
        await db.query("DELETE FROM jobs WHERE id = $1", [jobId]); 

        await db.upsertJob({
            id: jobId, profileName: selectedProfileName, jobType: moduleApiName,
            status: 'running', totalToProcess: jobs.length, consecutiveFailures: 0,
            stopAfterFailures: Number(stopAfterFailures) || 0, formData: data, 
            processingStartTime: new Date().toISOString()
        });

        await accountQueue.pause();
        await accountQueue.drain(true).catch(() => {});
        try { await accountQueue.obliterate({ force: true }); } catch(e) {}
        await accountQueue.resume(); 

        await accountQueue.addBulk(jobs);
        socket.emit('jobStarted', { profileName: selectedProfileName, jobType: moduleApiName });
    } catch (err) {
        console.error("Single Batch Error:", err);
        socket.emit('bulkError', { message: err.message, profileName: selectedProfileName, jobType: moduleApiName });
    }
};

// 📦 START ALL ACCOUNTS (TRANSLATOR & CONCURRENCY FIX)
const handleStartMasterBatch = async (socket, data) => {
    const { payloads, concurrency: masterConcurrency, moduleApiName: masterJobType } = data; 
    console.log(`\n🧠 [BILLING MASTER BATCH] Pushing ${payloads.length} accounts to Redis Queues...`);

    try {
        for (const payloadData of payloads) {
            const { 
                selectedProfileName, bulkField, bulkData, staticData, delay, 
                stopAfterFailures, activeProfile, trackingEnabled, campaignName, 
                targetHtmlField, startingRowNumber, appendAccountName, accountIndex, multilineFields, 
                moduleApiName: specificModule 
            } = payloadData;

            // 🚨 Use Master Name so the React UI is forced to stay synced
            const queueName = `${masterJobType}Queue_${selectedProfileName}`;
            const accountQueue = new Queue(queueName, { connection });

            let rows = [];
            try { rows = JSON.parse(bulkData); } 
            catch (e) { rows = bulkData.split('\n').filter(r => r.trim() !== '').map(val => ({ [bulkField]: val.trim() })); }

            const baseRowNumber = Number(startingRowNumber) || 1;

            const jobs = rows.map((row, index) => {
                const payload = { ...staticData, ...row };
                let identifier = payload[bulkField] || payload.name || payload.email || `Row ${index + 1}`;
                if (typeof identifier === 'object') identifier = JSON.stringify(identifier);

                return { 
                    name: 'processModule', 
                    data: { 
                        rowData: payload, identifier, 
                        moduleApiName: masterJobType, // Master UI Name
                        actualTargetModule: specificModule, // 🚨 Secret True API Name for Zoho!
                        selectedProfileName, delay, activeProfile, rowNumber: baseRowNumber + index, trackingEnabled, 
                        campaignName, targetHtmlField, appendAccountName, accountIndex, multilineFields
                    }, 
                    opts: { removeOnComplete: true, removeOnFail: true } 
                };
            });

            // Save the limit for the Bouncer
            payloadData.masterConcurrency = masterConcurrency;

            // 🚨 SET TO 'queued' TO FREEZE UI TIMERS!
            await db.upsertJob({
                id: `${masterJobType}_${selectedProfileName}`, 
                profileName: selectedProfileName, jobType: masterJobType,
                status: 'queued', totalToProcess: jobs.length, consecutiveFailures: 0,
                stopAfterFailures: Number(stopAfterFailures) || 0, formData: payloadData, 
                processingStartTime: null 
            });

            await accountQueue.drain(true).catch(() => {});
            try { await accountQueue.obliterate({ force: true }); } catch(e) {}

            // 🚀 BUG 1 FIX: WAKE UP THE QUEUE! If it was paused previously, this forces it to run.
            await accountQueue.resume(); 

            await accountQueue.addBulk(jobs);
        }
    } catch (err) {
        console.error("Master Batch Error:", err);
        socket.emit('bulkError', { message: 'Failed to queue master batch.', jobType: 'Unknown' });
    }
};

module.exports = { handleFetchBillingModuleFields, handleStartMasterBatch, handleStartBulkBillingCustomJob };