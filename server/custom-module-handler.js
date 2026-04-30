// --- FILE: server/custom-module-handler.js ---
const { makeApiCall, parseError, cliColors } = require('./utils');
const { Queue } = require('bullmq');
const { connection } = require('./worker'); 
const db = require('./postgres'); 

const handleFetchModuleFields = async (socket, data) => {
    const { selectedProfileName, moduleApiName, activeProfile } = data;
    try {
        console.log(`\n${cliColors.cyanBold}📡 [INVENTORY]${cliColors.reset} Fetching fields for: ${cliColors.whiteBold}${moduleApiName}${cliColors.reset}`);
        const response = await makeApiCall('get', `/settings/fields?entity=${moduleApiName}`, null, activeProfile, 'inventory');
        
        let fields = [];
        if (response.data && response.data.fields) fields = response.data.fields;
        
        if (fields.length === 0) throw new Error("No fields found for this module.");

        socket.emit('customModuleFieldsResult', { success: true, profileName: selectedProfileName, fields });
        console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.greenBold}✅ Success!${cliColors.reset} Found ${fields.length} fields.`);
    } catch (error) {
        const parsed = parseError(error);
        console.error(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.redBold}❌ ERROR:${cliColors.reset} ${parsed.message}`);
        socket.emit('customModuleFieldsResult', { success: false, profileName: selectedProfileName, message: parsed.message });
    }
};

const handleStartBulkCustomJob = async (socket, data) => {
    // 🚨 ADDED DB SEARCH LOGIC FOR INVENTORY
    if (data.isSearchRequest) {
        try {
            const res = await db.query("SELECT * FROM job_results WHERE profileName = $1 AND jobId = $2 AND (identifier ILIKE $3 OR details ILIKE $3) ORDER BY timestamp DESC LIMIT 500", [data.selectedProfileName, `inv_${data.moduleApiName}_${data.selectedProfileName}`, `%${data.query}%`]);
            socket.emit('databaseSearchResults', { profileName: data.selectedProfileName, results: res.rows });
        } catch(e) {}
        return;
    }
    // 🚨 ADDED DB EXPORT LOGIC FOR INVENTORY
    if (data.isExportRequest) {
        try {
            const res = await db.query("SELECT * FROM job_results WHERE profileName = $1 AND jobId = $2 ORDER BY timestamp DESC", [data.selectedProfileName, `inv_${data.moduleApiName}_${data.selectedProfileName}`]);
            socket.emit('fullExportData', { profileName: data.selectedProfileName, results: res.rows });
        } catch(e) {}
        return;
    }

    const { moduleApiName, bulkData, staticData, bulkField, delay, selectedProfileName, activeProfile, concurrency, stopAfterFailures, trackingEnabled, campaignName, targetHtmlField, startingRowNumber, appendAccountName, accountIndex, multilineFields } = data;

    console.log(`\n${cliColors.cyanBold}🧠 [INVENTORY SINGLE BATCH]${cliColors.reset} Pushing account ${cliColors.whiteBold}${selectedProfileName}${cliColors.reset} to Redis Queue...`);

    try {
        // 🚨 ISOLATION PREFIX: inv_
        const jobType = `inv_${moduleApiName}`;
        const queueName = `${jobType}Queue_${selectedProfileName}`;
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
                    rowData: payload, 
                    identifier, 
                    moduleApiName: jobType, // 👈 THE FIX: Pass the inv_ prefixed variable here!
                    actualTargetModule: moduleApiName, 
                    selectedProfileName, 
                    delay, activeProfile, rowNumber: baseRowNumber + index, trackingEnabled, campaignName, targetHtmlField,
                    appendAccountName, accountIndex, multilineFields
                }, 
                opts: { removeOnComplete: true, removeOnFail: true } 
            };
        });

        // 🚨 ISOLATION PREFIX: inv_
        const jobId = `${jobType}_${selectedProfileName}`;
        await db.query("DELETE FROM jobs WHERE id = $1", [jobId]); 

        await db.upsertJob({
            id: jobId, profileName: selectedProfileName, jobType: jobType,
            status: 'running', totalToProcess: jobs.length, consecutiveFailures: 0,
            stopAfterFailures: Number(stopAfterFailures) || 0, formData: data, 
            processingStartTime: new Date().toISOString()
        });

        await accountQueue.pause();
        await accountQueue.drain(true).catch(() => {});
        try { await accountQueue.obliterate({ force: true }); } catch(e) {}
        await accountQueue.resume(); 

        await accountQueue.addBulk(jobs);
        socket.emit('jobStarted', { profileName: selectedProfileName, jobType: jobType });
    } catch (err) {
        console.error("Single Batch Error:", err);
        socket.emit('bulkError', { message: err.message, profileName: selectedProfileName, jobType: `inv_${moduleApiName}` });
    }
};

const handleStartMasterBatch = async (socket, data) => {
    const { payloads, concurrency: masterConcurrency, moduleApiName: masterJobTypeRaw } = data; 
    console.log(`\n${cliColors.cyanBold}🧠 [INVENTORY MASTER BATCH]${cliColors.reset} Pushing ${cliColors.whiteBold}${payloads.length}${cliColors.reset} accounts to Redis Queues...`);

    try {
        for (const payloadData of payloads) {
            const { 
                selectedProfileName, bulkField, bulkData, staticData, delay, stopAfterFailures, activeProfile, trackingEnabled, 
                campaignName, targetHtmlField, startingRowNumber, appendAccountName, accountIndex, multilineFields, 
                moduleApiName: specificModule 
            } = payloadData;

            // 🚨 ISOLATION PREFIX: inv_
            const masterJobType = `inv_${masterJobTypeRaw}`;
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
                        moduleApiName: masterJobType, 
                        actualTargetModule: specificModule,
                        selectedProfileName, delay, activeProfile, rowNumber: baseRowNumber + index, trackingEnabled, 
                        campaignName, targetHtmlField, appendAccountName, accountIndex, multilineFields
                    }, 
                    opts: { removeOnComplete: true, removeOnFail: true } 
                };
            });

            payloadData.masterConcurrency = masterConcurrency;

            await db.upsertJob({
                id: `${masterJobType}_${selectedProfileName}`, 
                profileName: selectedProfileName, jobType: masterJobType,
                status: 'queued', totalToProcess: jobs.length, consecutiveFailures: 0,
                stopAfterFailures: Number(stopAfterFailures) || 0, formData: payloadData, 
                processingStartTime: null 
            });

            await accountQueue.drain(true).catch(() => {});
            try { await accountQueue.obliterate({ force: true }); } catch(e) {}
            await accountQueue.resume(); 

            await accountQueue.addBulk(jobs);
        }
    } catch (err) {
        console.error("Master Batch Error:", err);
        socket.emit('bulkError', { message: 'Failed to queue master batch.', jobType: data.moduleApiName });
    }
};

module.exports = { handleFetchModuleFields, handleStartMasterBatch, handleStartBulkCustomJob };