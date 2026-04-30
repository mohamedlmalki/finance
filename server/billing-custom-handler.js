// --- FILE: server/billing-custom-handler.js ---
const { makeApiCall, parseError, cliColors } = require('./utils');
const { Queue } = require('bullmq');
const { connection } = require('./worker'); 
const db = require('./postgres'); 

const handleFetchBillingModuleFields = async (socket, data) => {
    const { selectedProfileName, moduleApiName, activeProfile } = data;
    try {
        console.log(`\n${cliColors.purpleBold}📡 [BILLING]${cliColors.reset} Fetching fields for: ${cliColors.whiteBold}${moduleApiName}${cliColors.reset}`);
        
        let fields = [];
        
        try {
            // First attempt: Standard entity approach
            const response = await makeApiCall('get', `/settings/fields?entity=${moduleApiName}`, null, activeProfile, 'billing');
            if (response.data && response.data.fields) fields = response.data.fields;
        } catch (initialError) {
            console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.yellowBold}⚠️ Standard fetch failed, attempting ID lookup fallback...${cliColors.reset}`);
            
            // Fallback attempt: Fetch all modules, find the ID, then fetch fields
            const modulesResponse = await makeApiCall('get', `/settings/modules`, null, activeProfile, 'billing');
            const targetModule = modulesResponse.data.modules?.find(m => m.api_name === moduleApiName);
            
            if (!targetModule) throw new Error(`Module '${moduleApiName}' does not exist in Zoho Billing.`);
            
            // Zoho Billing sometimes uses the ID for the entity parameter instead of the name
            const fallbackResponse = await makeApiCall('get', `/settings/fields?entity=${targetModule.module_id}`, null, activeProfile, 'billing');
            if (fallbackResponse.data && fallbackResponse.data.fields) fields = fallbackResponse.data.fields;
        }
        
        if (fields.length === 0) throw new Error("No fields found for this module.");

        socket.emit('customModuleFieldsResult', { success: true, profileName: selectedProfileName, fields });
        console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.greenBold}✅ Success!${cliColors.reset} Found ${fields.length} fields.`);
    } catch (error) {
        const parsed = parseError(error);
        console.error(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.redBold}❌ ERROR:${cliColors.reset} ${parsed.message}`);
        socket.emit('customModuleFieldsResult', { success: false, profileName: selectedProfileName, message: parsed.message });
    }
};

const handleStartBulkBillingCustomJob = async (socket, data) => {
    // 🚨 ADDED DB SEARCH LOGIC FOR BILLING
    if (data.isSearchRequest) {
        try {
            const res = await db.query("SELECT * FROM job_results WHERE profileName = $1 AND jobId = $2 AND (identifier ILIKE $3 OR details ILIKE $3) ORDER BY timestamp DESC LIMIT 500", [data.selectedProfileName, `bil_${data.moduleApiName}_${data.selectedProfileName}`, `%${data.query}%`]);
            socket.emit('databaseSearchResults', { profileName: data.selectedProfileName, results: res.rows });
        } catch(e) {}
        return;
    }
    // 🚨 ADDED DB EXPORT LOGIC FOR BILLING
    if (data.isExportRequest) {
        try {
            const res = await db.query("SELECT * FROM job_results WHERE profileName = $1 AND jobId = $2 ORDER BY timestamp DESC", [data.selectedProfileName, `bil_${data.moduleApiName}_${data.selectedProfileName}`]);
            socket.emit('fullExportData', { profileName: data.selectedProfileName, results: res.rows });
        } catch(e) {}
        return;
    }

    const { moduleApiName, bulkData, staticData, bulkField, delay, selectedProfileName, activeProfile, concurrency, stopAfterFailures, trackingEnabled, campaignName, targetHtmlField, startingRowNumber, appendAccountName, accountIndex, multilineFields } = data;

    console.log(`\n${cliColors.purpleBold}🧠 [BILLING SINGLE BATCH]${cliColors.reset} Pushing account ${cliColors.whiteBold}${selectedProfileName}${cliColors.reset} to Redis Queue...`);

    try {
        // 🚨 ISOLATION PREFIX: bil_
        const jobType = `bil_${moduleApiName}`;
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
                    moduleApiName: jobType, // 👈 THE FIX: Pass the bil_ prefixed variable here!
                    actualTargetModule: moduleApiName, 
                    selectedProfileName, 
                    delay, activeProfile, rowNumber: baseRowNumber + index, trackingEnabled, campaignName, targetHtmlField,
                    appendAccountName, accountIndex, multilineFields
                }, 
                opts: { removeOnComplete: true, removeOnFail: true } 
            };
        });

        // 🚨 ISOLATION PREFIX: bil_
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
        socket.emit('bulkError', { message: err.message, profileName: selectedProfileName, jobType: `bil_${moduleApiName}` });
    }
};

const handleStartMasterBatch = async (socket, data) => {
    console.log(`\n=================================================`);
    console.log(`🟣 [BACKEND] 1. Socket Event 'startMasterBulkBillingCustomJob' received!`);
    
    const { payloads, concurrency: masterConcurrency, moduleApiName: masterJobTypeRaw } = data; 
    
    if (!payloads || payloads.length === 0) {
        console.log(`🔴 [BACKEND] 1B. ABORTING: Received empty payload array from frontend.`);
        return;
    }

    console.log(`🟣 [BACKEND] 2. Processing ${payloads.length} accounts for Master Batch. Raw Job Type: ${masterJobTypeRaw}`);

    try {
        for (const payloadData of payloads) {
            const { 
                selectedProfileName, bulkField, bulkData, staticData, delay, 
                stopAfterFailures, activeProfile, trackingEnabled, campaignName, 
                targetHtmlField, startingRowNumber, appendAccountName, accountIndex, multilineFields, 
                moduleApiName: specificModule 
            } = payloadData;

            // 🚨 ISOLATION PREFIX: bil_
            const masterJobType = `bil_${masterJobTypeRaw}`;
            const queueName = `${masterJobType}Queue_${selectedProfileName}`;
            const accountQueue = new Queue(queueName, { connection });

            console.log(`   👉 [BACKEND] Preparing profile: ${selectedProfileName}. Target Queue: ${queueName}`);

            let rows = [];
            try { rows = JSON.parse(bulkData); } 
            catch (e) { rows = bulkData.split('\n').filter(r => r.trim() !== '').map(val => ({ [bulkField]: val.trim() })); }

            console.log(`   👉 [BACKEND] Parsed ${rows.length} rows for ${selectedProfileName}`);

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

            const finalJobId = `${masterJobType}_${selectedProfileName}`;
            console.log(`   👉 [BACKEND] Saving job to PostgreSQL. JobID: ${finalJobId}`);

            await db.upsertJob({
                id: finalJobId, 
                profileName: selectedProfileName, jobType: masterJobType,
                status: 'queued', totalToProcess: jobs.length, consecutiveFailures: 0,
                stopAfterFailures: Number(stopAfterFailures) || 0, formData: payloadData, 
                processingStartTime: null 
            });

            console.log(`   👉 [BACKEND] Wiping old queue and adding new batch for ${selectedProfileName}...`);
            await accountQueue.drain(true).catch(() => {});
            try { await accountQueue.obliterate({ force: true }); } catch(e) {}
            await accountQueue.resume(); 

            await accountQueue.addBulk(jobs);
            console.log(`   ✅ [BACKEND] Successfully added ${jobs.length} jobs to BullMQ for ${selectedProfileName}`);
        }
        
        console.log(`🟣 [BACKEND] 3. MASTER BATCH INITIATION COMPLETE`);
        console.log(`=================================================\n`);
        
    } catch (err) {
        console.error("🔴 [BACKEND] Master Batch Error:", err);
        socket.emit('bulkError', { message: 'Failed to queue master batch.', jobType: 'Unknown' });
    }
};

module.exports = { handleFetchBillingModuleFields, handleStartMasterBatch, handleStartBulkBillingCustomJob };