// --- FILE: server/expense-handler.js ---

const { makeApiCall, parseError, createJobId } = require('./utils');

let activeJobs = {};

const setActiveJobs = (jobsObject) => {
  activeJobs = jobsObject;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- HELPER: ROBUST ID EXTRACTOR ---
const findRecordId = (data) => {
    if (!data || typeof data !== 'object') return null;
    if (data.id) return data.id;
    if (data.module_record_id) return data.module_record_id;

    const keys = Object.keys(data);
    for (const key of keys) {
        if (key.endsWith('_id') && (typeof data[key] === 'string' || typeof data[key] === 'number')) {
            return data[key];
        }
    }
    for (const key of keys) {
        if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
            const found = findRecordId(data[key]);
            if (found) return found;
        }
    }
    return null;
};

// --- HELPER: Verify Log ---
const verifyExpenseLog = async (socket, params, jobId) => {
    const { activeProfile, moduleName, recordId, primaryValue, profileName, rowNumber } = params;
    
    await sleep(5000); // Wait for indexing

    if (!activeJobs[jobId]) return;

    let verifySuccess = false;
    let verifyData = null;
    let errorMessage = null;

    try {
        const url = `/v1/${moduleName}/${recordId}`;
        const response = await makeApiCall('get', url, null, activeProfile, 'expense');
        verifyData = response.data;

        if (findRecordId(verifyData)) {
            verifySuccess = true;
        } else {
            errorMessage = "Record not found (API returned empty or invalid data)";
        }

    } catch (error) {
        errorMessage = error.message;
    }

    // EMIT UPDATE
    socket.emit('expenseBulkResult', {
        rowNumber,
        identifier: primaryValue,
        success: true, 
        details: verifySuccess ? "Verified ✓" : "Created but Verify Failed ⚠",
        verifyStatus: verifySuccess ? 'success' : 'failed',
        verifyDetails: errorMessage,
        verifyResponse: verifyData || { error: errorMessage }, 
        profileName: profileName
    });
};

const handleGetExpenseFields = async (socket, data) => {
    const { activeProfile, moduleName } = data;
    let logs = [];
    
    try {
        if (!activeProfile || !activeProfile.expense) throw new Error("Expense profile missing");
        if (!moduleName) throw new Error("Module Name is required");

        let fieldsFound = [];

        // Strategy 1: Settings
        const entities = [moduleName, moduleName.slice(0, -1), moduleName + 's'];
        for (const entity of entities) {
            if (fieldsFound.length > 0) break;
            try {
                const res = await makeApiCall('get', `/v1/settings/fields?entity=${entity}`, null, activeProfile, 'expense');
                if (res.data && res.data.fields) fieldsFound = res.data.fields;
            } catch (e) { }
        }

        // Strategy 2: Sample Record
        if (fieldsFound.length === 0) {
            try {
                const listRes = await makeApiCall('get', `/v1/${moduleName}?per_page=1`, null, activeProfile, 'expense');
                let records = [];
                Object.keys(listRes.data).forEach(k => {
                    if (Array.isArray(listRes.data[k])) records = listRes.data[k];
                });
                if (records.length > 0) {
                    fieldsFound = Object.keys(records[0]).map(key => ({
                        label: key, api_name: key, data_type: 'text', is_mandatory: false
                    }));
                }
            } catch (e) { }
        }

        if (fieldsFound.length > 0) {
            const cleanFields = fieldsFound.map(f => ({
                label: f.label || f.field_name || f.api_name,
                api_name: f.api_name || f.field_name,
                data_type: f.data_type || 'text',
                is_mandatory: f.is_mandatory || false,
                default_value: f.default_value || ''
            }));
            socket.emit('expenseFieldsResult', { success: true, fields: cleanFields });
        } else {
            socket.emit('expenseFieldsResult', { success: false, error: "Could not fetch fields. Check module name.", debug_logs: logs });
        }
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('expenseFieldsResult', { success: false, error: message, debug_logs: logs });
    }
};

const handleStartBulkExpenseCreation = async (socket, data) => {
    const { 
        moduleName, primaryFieldName, bulkValues, defaultData, 
        bulkDelay, concurrency, verifyLog, stopAfterFailures,
        selectedProfileName, activeProfile, processedIds
    } = data;

    const jobId = createJobId(socket.id, selectedProfileName, 'expense');
    const workerCount = Math.max(1, Number(concurrency) || 1);
    const failureLimit = Number(stopAfterFailures) || 0;

    activeJobs[jobId] = { status: 'running', consecutiveFailures: 0, stopAfterFailures: failureLimit };
    
    // NOTE: Removed 'processedSet' check so it ALWAYS creates records (no skipping)

    try {
        const valuesList = bulkValues.split('\n').filter(v => v.trim() !== '');
        if (valuesList.length === 0) throw new Error("No bulk values provided.");

        let currentIndex = 0;

        const worker = async (workerId) => {
            while (currentIndex < valuesList.length) {
                if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;
                while (activeJobs[jobId]?.status === 'paused') await sleep(1000);

                const index = currentIndex++;
                if (index >= valuesList.length) break;

                const value = valuesList[index];
                const rowNumber = index + 1;

                const payload = { ...defaultData, [primaryFieldName]: value };
                Object.keys(payload).forEach(k => (payload[k] === "" || payload[k] == null) && delete payload[k]);

                socket.emit('expenseBulkResult', {
                    rowNumber, identifier: value, stage: 'processing', details: 'Sending...', success: false, profileName: selectedProfileName
                });

                try {
                    const response = await makeApiCall('post', `/v1/${moduleName}`, payload, activeProfile, 'expense');
                    const resData = response.data;
                    const recordId = findRecordId(resData);

                    if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0;

                    socket.emit('expenseBulkResult', {
                        rowNumber,
                        identifier: value,
                        stage: 'complete',
                        success: true,
                        details: 'Created' + (verifyLog ? ' (Verifying...)' : ''),
                        creationResponse: resData,
                        profileName: selectedProfileName
                    });

                    if (verifyLog && recordId) {
                        verifyExpenseLog(socket, {
                            activeProfile, moduleName, recordId, primaryValue: value, profileName: selectedProfileName, rowNumber
                        }, jobId);
                    } else if (verifyLog && !recordId) {
                         socket.emit('expenseBulkResult', {
                            rowNumber, identifier: value, success: true, details: "Created (Skip Verify: No ID)", profileName: selectedProfileName
                        });
                    }

                } catch (error) {
                    const { message, fullResponse } = parseError(error);
                    if (activeJobs[jobId]) {
                        activeJobs[jobId].consecutiveFailures++;
                        socket.emit('expenseBulkResult', {
                            rowNumber, identifier: value, stage: 'complete', success: false, details: message, creationResponse: fullResponse, profileName: selectedProfileName
                        });
                        if (activeJobs[jobId].stopAfterFailures > 0 && activeJobs[jobId].consecutiveFailures >= activeJobs[jobId].stopAfterFailures) {
                            activeJobs[jobId].status = 'paused';
                            socket.emit('jobPaused', { profileName: selectedProfileName, jobType: 'expense', reason: `Auto-paused after ${activeJobs[jobId].consecutiveFailures} API failures.` });
                        }
                    }
                }
                if (bulkDelay > 0) await sleep(bulkDelay * 1000);
            }
        };

        const workers = [];
        for (let w = 0; w < workerCount; w++) workers.push(worker(w));
        await Promise.all(workers);

    } catch (err) {
        socket.emit('bulkError', { message: err.message, profileName: selectedProfileName });
    } finally {
        if (activeJobs[jobId]) {
            if (activeJobs[jobId].status === 'ended') socket.emit('bulkEnded', { profileName: selectedProfileName, jobType: 'expense' });
            else socket.emit('bulkComplete', { profileName: selectedProfileName, jobType: 'expense' });
            delete activeJobs[jobId];
        }
    }
};

module.exports = { setActiveJobs, handleGetExpenseFields, handleStartBulkExpenseCreation };