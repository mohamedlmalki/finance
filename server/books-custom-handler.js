// server/books-custom-handler.js

const { makeApiCall, parseError, createJobId } = require('./utils');

let activeJobs = {};

const setActiveJobs = (jobsObject) => {
  activeJobs = jobsObject;
};

// --- UPDATED SLEEP WITH COUNTDOWN EMITTER ---
const interruptibleSleep = (ms, jobId, socket, profileName) => {
    return new Promise(resolve => {
        if (ms <= 0) return resolve();
        
        let remaining = ms;
        const intervalTime = 1000;
        
        // Emit initial full time
        if (socket && profileName) {
            socket.emit('jobCountdown', { profileName, seconds: Math.ceil(remaining / 1000) });
        }

        const timerId = setInterval(() => {
            // Check if job stopped/killed
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') {
                clearInterval(timerId);
                return resolve();
            }

            remaining -= intervalTime;

            // Emit countdown update
            if (socket && profileName && remaining > 0) {
                socket.emit('jobCountdown', { profileName, seconds: Math.ceil(remaining / 1000) });
            }

            if (remaining <= 0) {
                clearInterval(timerId);
                // Clear countdown on finish
                if (socket && profileName) {
                    socket.emit('jobCountdown', { profileName, seconds: 0 });
                }
                resolve();
            }
        }, intervalTime);
    });
};

function checkAutoPause(job, profileName, socket) {
    if (job && job.stopAfterFailures > 0 && job.consecutiveFailures >= job.stopAfterFailures) {
        if (job.status !== 'paused') {
            job.status = 'paused';
            socket.emit('jobPaused', { 
                profileName: profileName, 
                jobType: 'books-custom', 
                reason: `Auto-paused after ${job.consecutiveFailures} consecutive failures.` 
            });
        }
    }
}

// --- FIELD FETCHING ---
const handleFetchModuleFields = async (socket, data) => {
    const { activeProfile, moduleApiName } = data;
    let fieldsFound = [];
    let logs = [];

    const log = (msg) => {
        console.log(`[Books Field Fetch]: ${msg}`);
        logs.push(msg);
    };

    log(`Start fetching fields for module: '${moduleApiName}'`);

    try {
        if (!activeProfile || !activeProfile.books) throw new Error('Books profile configuration is missing.');

        // Strategy 1: Standard Settings
        try {
            const res1 = await makeApiCall('get', `/settings/modules/${moduleApiName}/fields`, null, activeProfile, 'books');
            if (res1.data && (res1.data.fields || res1.data.custom_fields)) {
                fieldsFound = res1.data.fields || res1.data.custom_fields;
            }
        } catch (e) {}

        // Strategy 2: Entity Fields
        if (fieldsFound.length === 0) {
            try {
                const res2 = await makeApiCall('get', `/settings/fields?entity=${moduleApiName}`, null, activeProfile, 'books');
                if (res2.data && res2.data.fields) fieldsFound = res2.data.fields;
            } catch (e) {}
        }

        // Strategy 3: Custom Modules List
        if (fieldsFound.length === 0) {
            try {
                let listRes;
                try { listRes = await makeApiCall('get', '/settings/custommodules', null, activeProfile, 'books'); } 
                catch(err) { listRes = await makeApiCall('get', '/settings/custom_modules', null, activeProfile, 'books'); }
                
                if (listRes.data && (listRes.data.custom_modules || listRes.data.custommodules)) {
                    const modules = listRes.data.custom_modules || listRes.data.custommodules;
                    const targetModule = modules.find(m => m.module_name === moduleApiName || m.plural_name === moduleApiName || m.module_id === moduleApiName);
                    
                    if (targetModule) {
                        const detailRes = await makeApiCall('get', `/settings/custommodules/${targetModule.module_id}`, null, activeProfile, 'books');
                        if (detailRes.data && detailRes.data.custom_module && detailRes.data.custom_module.fields) {
                            fieldsFound = detailRes.data.custom_module.fields;
                        }
                    }
                }
            } catch (e) {}
        }

        // Strategy 4: Fallback (Infer from record)
        if (fieldsFound.length === 0) {
            try {
                const endpoint = moduleApiName.startsWith('/') ? `${moduleApiName}?per_page=1` : `/${moduleApiName}?per_page=1`;
                const listRes = await makeApiCall('get', endpoint, null, activeProfile, 'books');
                const responseData = listRes.data;
                let records = [];
                if (responseData[moduleApiName]) records = responseData[moduleApiName];
                else if (Array.isArray(responseData)) records = responseData;
                else {
                    const arrayKey = Object.keys(responseData).find(k => Array.isArray(responseData[k]));
                    if (arrayKey) records = responseData[arrayKey];
                }

                if (records.length > 0) {
                    const sample = records[0];
                    fieldsFound = Object.keys(sample).map(key => ({
                        label: key, api_name: key, data_type: 'text', is_mandatory: false
                    }));
                    const systemFields = ['created_time', 'last_modified_time', 'created_by', 'updated_by', 'status_formatted', 'currency_symbol'];
                    fieldsFound = fieldsFound.filter(f => !systemFields.includes(f.api_name) && !f.api_name.endsWith('_id'));
                } else {
                    socket.emit('booksModuleFieldsResult', { success: true, fields: [], warning: "Module found but empty." });
                    return;
                }
            } catch (e) {}
        }

        if (fieldsFound.length > 0) {
            const cleanFields = fieldsFound.map(f => ({
                label: f.label || f.field_name_formatted || f.field_name || f.api_name,
                api_name: f.api_name || f.field_name || f.label,
                data_type: f.data_type || 'text',
                is_mandatory: f.is_mandatory || false
            }));
            socket.emit('booksModuleFieldsResult', { success: true, fields: cleanFields });
        } else {
            socket.emit('booksModuleFieldsResult', { success: false, error: `Could not fetch fields.`, debug_logs: logs });
        }

    } catch (error) {
        const { message } = parseError(error);
        socket.emit('booksModuleFieldsResult', { success: false, error: message });
    }
};

const handleStartBulkBooksCustomJob = async (socket, data) => {
	
	// --- ADD THESE DEBUG LOGS ---
    console.log("------------------------------------------------");
    console.log("[SERVER] RECEIVED 'startBulkBooksCustomJob' EVENT");
    console.log(`[SERVER] Profile: ${data.selectedProfileName}`);
    console.log(`[SERVER] Items to Skip (Processed): ${data.processedIds ? data.processedIds.length : 0}`);
    console.log("------------------------------------------------");
    // ----------------------------
	
    const { 
        moduleApiName, bulkData, staticData, bulkField, 
        delay, selectedProfileName, activeProfile, stopAfterFailures,
        concurrency = 1,
        processedIds // <--- ADDED for Resume logic
    } = data;

    const jobId = createJobId(socket.id, selectedProfileName, 'books-custom');
    
    // Ensure concurrency is at least 1
    const batchSize = Math.max(1, Number(concurrency) || 1);
    const delayMs = (Number(delay) || 0) * 1000;
    const failureLimit = Number(stopAfterFailures) || 0;

    activeJobs[jobId] = { 
        status: 'running', 
        consecutiveFailures: 0,
        stopAfterFailures: failureLimit
    };

    // Create a Set for O(1) lookup of processed identifiers
    const processedSet = new Set(processedIds || []);

    try {
        let rows = [];

        // Parse Data
        if (bulkField && typeof bulkData === 'string') {
             const lines = bulkData.split('\n').filter(line => line.trim() !== '');
             rows = lines.map(line => ({ ...staticData, [bulkField]: line.trim() }));
        } else {
             rows = JSON.parse(bulkData);
        }

        if (!Array.isArray(rows) || rows.length === 0) throw new Error("Invalid bulk data or empty list.");

        // --- CONCURRENCY LOOP ---
        for (let i = 0; i < rows.length; i += batchSize) {
            // Check control flags
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;
            while (activeJobs[jobId]?.status === 'paused') await new Promise(r => setTimeout(r, 500));

            // Prepare Batch
            const batch = rows.slice(i, i + batchSize);
            
            // Wait for Delay (Only if not the first batch)
            if (i > 0 && delayMs > 0) {
                // Pass socket and profileName to emit countdown events
                await interruptibleSleep(delayMs, jobId, socket, selectedProfileName);
            }

            // Check control flags again after sleep
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;

            // Process Batch in Parallel
            const promises = batch.map(async (row, index) => {
                const rowNumber = i + index + 1;
                const payload = { ...staticData, ...row };
                
                // Clean empty keys
                Object.keys(payload).forEach(k => (payload[k] === "" || payload[k] == null) && delete payload[k]);

                // Determine Identifier
                let identifier = 
                    payload.email || 
                    payload.contact_email || 
                    payload.vendor_email || 
                    payload.name || 
                    payload.customer_name || 
                    payload.item_name;

                if (!identifier && bulkField && payload[bulkField] && typeof payload[bulkField] === 'string') {
                    identifier = payload[bulkField];
                }
                if (!identifier) identifier = `Row ${rowNumber}`;

                // --- SKIP IF ALREADY PROCESSED ---
                if (processedSet.has(identifier)) {
                    return; // Skip this promise
                }

                socket.emit('booksCustomModuleResult', {
                    rowNumber, identifier, stage: 'processing', details: 'Sending...', success: false, profileName: selectedProfileName
                });

                try {
                    const endpoint = moduleApiName.startsWith('/') ? moduleApiName : `/${moduleApiName}`;
                    const response = await makeApiCall('post', endpoint, payload, activeProfile, 'books');
                    
                    if (activeJobs[jobId]) {
                        // Only reset counter if we are NOT currently paused by another failure in this batch
                        if (activeJobs[jobId].status !== 'paused') {
                            activeJobs[jobId].consecutiveFailures = 0;
                        }
                    }

                    socket.emit('booksCustomModuleResult', {
                        rowNumber, identifier, stage: 'complete', success: true, details: 'Created.', response: response.data, profileName: selectedProfileName
                    });
                } catch (error) {
                    const { message, fullResponse } = parseError(error);
                    
                    if (activeJobs[jobId]) {
                        activeJobs[jobId].consecutiveFailures++;
                        // Check auto-pause IMMEDIATELY
                        checkAutoPause(activeJobs[jobId], selectedProfileName, socket);
                    }
                    
                    socket.emit('booksCustomModuleResult', {
                        rowNumber, identifier, stage: 'complete', success: false, details: message, fullResponse: fullResponse, profileName: selectedProfileName
                    });
                }
            });

            // Wait for all requests in this batch to finish
            await Promise.all(promises);
        }

    } catch (error) {
        socket.emit('bulkError', { message: error.message, profileName: selectedProfileName, jobType: 'books-custom' });
    } finally {
        if (activeJobs[jobId]) {
            // Ensure countdown is cleared
            socket.emit('jobCountdown', { profileName: selectedProfileName, seconds: 0 });
            
            if (activeJobs[jobId].status === 'ended') socket.emit('bulkEnded', { profileName: selectedProfileName, jobType: 'books-custom' });
            else socket.emit('bulkComplete', { profileName: selectedProfileName, jobType: 'books-custom' });
            delete activeJobs[jobId];
        }
    }
};

module.exports = { setActiveJobs, handleFetchModuleFields, handleStartBulkBooksCustomJob };