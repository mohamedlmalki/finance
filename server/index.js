// --- FILE: server/index.js ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const crypto = require('crypto');
const { 
    readProfiles, writeProfiles, parseError, getValidAccessToken, makeApiCall, createJobId,
    writeSaveFile, readSaveFile, listSaveFiles, logFrontendIntention, cliColors
} = require('./utils');

// --- ENGINE IMPORTS ---
const db = require('./postgres'); 
const { listenForWorkers } = require('./redis-pubsub');

// --- HANDLER IMPORTS ---
const inventoryHandler = require('./inventory-handler');
const booksHandler = require('./books-handler');
const customModuleHandler = require('./custom-module-handler');
const expenseHandler = require('./expense-handler');
const booksCustomHandler = require('./books-custom-handler');
const billingHandler = require('./billing-handler');
const billingCustomHandler = require('./billing-custom-handler');
const flowHandler = require('./flow-handler');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } }); 

listenForWorkers(io);

const port = process.env.PORT || 3009; 
const REDIRECT_URI = `http://localhost:${port}/api/zoho/callback`;

const authStates = {};
const connectionCache = {}; 

app.use(cors());
app.use(express.json({ limit: '50mb' })); 

app.post('/api/zoho/auth', (req, res) => {
    const { clientId, clientSecret, socketId } = req.body;
    if (!clientId || !clientSecret || !socketId) return res.status(400).send('Credentials required.');

    const state = crypto.randomBytes(16).toString('hex');
    authStates[state] = { clientId, clientSecret, socketId };
    setTimeout(() => delete authStates[state], 300000); 

    const combinedScopes = [
        'ZohoInventory.contacts.ALL', 'ZohoInventory.invoices.ALL', 'ZohoInventory.settings.ALL',
        'ZohoInventory.settings.READ', 'ZohoInventory.settings.UPDATE', 'ZohoInventory.custommodules.ALL', 
        'ZohoInventory.custommodules.CREATE', 'ZohoInventory.custommodules.READ', 'ZohoInventory.custommodules.UPDATE',
        'ZohoInventory.FullAccess.all', 'ZohoBooks.custommodules.ALL', 'ZohoBooks.custommodules.CREATE',
        'ZohoBooks.custommodules.READ', 'ZohoBooks.custommodules.UPDATE', 'ZohoBooks.fullaccess.all', 
        'ZohoExpense.fullaccess.all', 'ZohoSubscriptions.customers.CREATE', 'ZohoSubscriptions.customers.UPDATE',
        'ZohoSubscriptions.customers.READ', 'ZohoSubscriptions.invoices.CREATE', 'ZohoSubscriptions.invoices.UPDATE',
        'ZohoSubscriptions.invoices.READ', 'ZohoSubscriptions.settings.READ', 'ZohoSubscriptions.custommodules.CREATE',
        'ZohoSubscriptions.custommodules.READ', 'ZohoSubscriptions.custommodules.UPDATE', 'ZohoSubscriptions.custommodules.DELETE'
    ].join(',');
    
    const authUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=${combinedScopes}&client_id=${clientId}&response_type=code&access_type=offline&redirect_uri=${REDIRECT_URI}&prompt=consent&state=${state}`;
    res.json({ authUrl });
});

app.get('/api/zoho/callback', async (req, res) => {
    const { code, state } = req.query;
    const authData = authStates[state];
    if (!authData) return res.status(400).send('<h1>Error</h1><p>Invalid or expired session state.</p>');
    delete authStates[state];

    try {
        const axios = require('axios');
        const tokenUrl = 'https://accounts.zoho.com/oauth/v2/token';
        const params = new URLSearchParams();
        params.append('code', code);
        params.append('client_id', authData.clientId);
        params.append('client_secret', authData.clientSecret);
        params.append('redirect_uri', REDIRECT_URI);
        params.append('grant_type', 'authorization_code');
        
        const response = await axios.post(tokenUrl, params);
        const { refresh_token } = response.data;
        if (!refresh_token) throw new Error('Refresh token not found.');

        io.to(authData.socketId).emit('zoho-refresh-token', { refreshToken: refresh_token });
        res.send('<h1>Success!</h1><p>Token received. You can close this window.</p><script>window.close();</script>');
    } catch (error) {
        const { message } = parseError(error);
        io.to(authData.socketId).emit('zoho-refresh-token-error', { error: message });
        res.status(500).send(`<h1>Error</h1><p>${message}</p>`);
    }
});

app.post('/api/invoices/single', async (req, res) => {
    try { res.json(await inventoryHandler.handleSendSingleInvoice(req.body)); } 
    catch (error) { res.status(500).json({ success: false, error: 'Server error.' }); }
});

app.post('/api/save-state', (req, res) => {
    try {
        const { filename, state } = req.body;
        if (!filename || !state) return res.status(400).json({ success: false, error: "Filename and state required" });
        const savedName = writeSaveFile(filename, state);
        res.json({ success: true, filename: savedName });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/list-saves', (req, res) => {
    try { res.json({ success: true, files: listSaveFiles() }); } 
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/load-state/:filename', (req, res) => {
    try { res.json({ success: true, state: readSaveFile(req.params.filename) }); } 
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/profiles', (req, res) => res.json(readProfiles()));

app.post('/api/profiles', (req, res) => {
    try {
        const newProfile = req.body; 
        const profiles = readProfiles();
        let baseName = newProfile.profileName;
        let currentName = baseName;
        let counter = 1;
        while (profiles.some(p => p.profileName === currentName)) {
            currentName = `${baseName} (${counter})`;
            counter++;
        }
        newProfile.profileName = currentName;
        profiles.push(newProfile); 
        writeProfiles(profiles);
        res.json({ success: true, profiles });
    } catch (error) { res.status(500).json({ success: false, error: "Failed to add profile." }); }
});

app.put('/api/profiles/:profileNameToUpdate', (req, res) => {
    try {
        const { profileNameToUpdate } = req.params; const updatedProfileData = req.body;
        const profiles = readProfiles(); const profileIndex = profiles.findIndex(p => p.profileName === profileNameToUpdate);
        if (profileIndex === -1) return res.status(404).json({ success: false, error: "Not found." });
        profiles[profileIndex] = { ...profiles[profileIndex], ...updatedProfileData }; writeProfiles(profiles);
        res.json({ success: true, profiles });
    } catch (error) { res.status(500).json({ success: false, error: "Failed to update." }); }
});

app.delete('/api/profiles/:profileNameToDelete', (req, res) => {
    try {
        const { profileNameToDelete } = req.params; const profiles = readProfiles();
        const newProfiles = profiles.filter(p => p.profileName !== profileNameToDelete); writeProfiles(newProfiles);
        res.json({ success: true, profiles: newProfiles });
    } catch (error) { res.status(500).json({ success: false, error: "Failed to delete." }); }
});

io.on('connection', (socket) => {
    socket.on('checkApiStatus', async (data) => {
        try {
            const { selectedProfileName, service: requestedService } = data; 
            const profiles = readProfiles();
            const activeProfile = profiles.find(p => p.profileName === selectedProfileName);
            if (!activeProfile) return socket.emit('apiStatusResult', { success: false, message: "Profile not found." });
            
            let service = requestedService || 'inventory';
            if (!requestedService) {
                if (activeProfile.books?.orgId) service = 'books';
                else if (activeProfile.expense?.orgId) service = 'expense';
                else if (activeProfile.billing?.orgId) service = 'billing';
            }

            const cacheKey = `${selectedProfileName}_${service}`;
            const now = Date.now();
            if (connectionCache[cacheKey] && connectionCache[cacheKey].expiresAt > now) {
                return socket.emit('apiStatusResult', connectionCache[cacheKey].data);
            }

            const tokenResponse = await getValidAccessToken(activeProfile, service);
            const endpoint = '/organizations';
            const orgsResponse = await makeApiCall('get', endpoint, null, activeProfile, service);
            const targetOrgId = activeProfile[service]?.orgId;
            const currentOrg = orgsResponse.data.organizations.find(org => org.organization_id === targetOrgId);
            
            if (!currentOrg) throw new Error(`${service.toUpperCase()} Org ID invalid.`);

            let agentInfo = null;
            try {
                const userRes = await makeApiCall('get', '/users/me', null, activeProfile, service);
                if (userRes.data && userRes.data.user) {
                    const fullName = userRes.data.user.name || "Unknown Agent";
                    const nameParts = fullName.split(' ');
                    agentInfo = { firstName: nameParts[0], lastName: nameParts.slice(1).join(' ') || '' };
                }
            } catch (userErr) {}
            
            const successPayload = { success: true, message: `Connected to ${service.toUpperCase()}`, fullResponse: { ...tokenResponse, orgName: currentOrg.name, agentInfo } };
            connectionCache[cacheKey] = { data: successPayload, expiresAt: now + (55 * 60 * 1000) };
            socket.emit('apiStatusResult', successPayload);
        } catch (error) {
            socket.emit('apiStatusResult', { success: false, message: `Failed: ${parseError(error).message}` });
        }
    });

    socket.on('requestDatabaseSync', async () => {
        try {
            const allJobs = await db.getAllJobs();
            socket.emit('databaseSync', allJobs);
        } catch (error) { console.error('DB Sync Error:', error); }
    }); 

    socket.on('updateFlowResult', async (data) => {
        try {
            const { jobId, rowNumber, success, details, profileName } = data;
            await db.updateJobResult(jobId, rowNumber, success, details);
            io.emit('flowResultUpdate', data); 
        } catch (error) {
            console.error("Failed to update postgres from frontend worker poll:", error);
        }
    });

    socket.on('fetchOrgs', async (data) => {
        const { profile, service, requestId } = data || {};
        try {
            if (!profile?.clientId || !profile?.clientSecret || !profile?.refreshToken) {
                return socket.emit('fetchOrgsResult', { success: false, requestId, message: "Please enter Client ID, Secret, and Refresh Token first." });
            }
            const endpoint = '/organizations';
            const orgsResponse = await makeApiCall('get', endpoint, null, profile, service);
            socket.emit('fetchOrgsResult', { success: true, requestId, organizations: orgsResponse.data.organizations });
        } catch (error) {
            socket.emit('fetchOrgsResult', { success: false, requestId, message: parseError(error).message });
        }
    });

    socket.on('fetchCustomModules', async (data) => {
        const { profile, service, requestId } = data || {};
        try {
            if (!profile?.clientId || !profile?.clientSecret || !profile?.refreshToken || !profile[service]?.orgId) {
                return socket.emit('fetchCustomModulesResult', { success: false, requestId, message: "Please enter your keys and fetch an Org ID first." });
            }
            const modulesResponse = await makeApiCall('get', '/settings/modules', null, profile, service);
            socket.emit('fetchCustomModulesResult', { success: true, requestId, modules: modulesResponse.data.modules || [] });
        } catch (error) {
            socket.emit('fetchCustomModulesResult', { success: false, requestId, message: parseError(error).message });
        }
    });

    socket.on('clearJob', async (data) => {
        const { profileName, jobType } = data;
        try {
            socket.emit('wipeProgress', { profileName, jobType, message: `Initiating wipe for ${profileName}...` });
            await db.query("UPDATE jobs SET status = 'ended' WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
            
            if (jobType.startsWith('Flow_')) {
                const jobId = `${jobType}_${profileName}`;
                if (flowHandler.killClock) flowHandler.killClock(jobId);
            } else {
                const { Queue } = require('bullmq');
                const { connection } = require('./worker');
                const queueName = `${jobType}Queue_${profileName}`;
                const targetQueue = new Queue(queueName, { connection });
                try {
                    await targetQueue.pause(); 
                    await targetQueue.obliterate({ force: true }); 
                } catch (e) {
                    const rawKeys = await connection.keys(`bull:${queueName}:*`);
                    if (rawKeys.length > 0) await connection.del(...rawKeys);
                } finally {
                    await targetQueue.close();
                }
            }
            await db.query("DELETE FROM jobs WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
            socket.emit('jobCleared', { profileName, jobType });
        } catch (error) {
            socket.emit('wipeProgress', { profileName, jobType, message: `Error: ${error.message}`, error: true });
        }
    });

    socket.on('clearAllJobs', async (data) => {
        const { jobType } = data;
        try {
            let targetJobTypes = [jobType];
            if (jobType && jobType.startsWith('cm_')) {
                const profiles = readProfiles();
                const allCustomModules = new Set([jobType]);
                profiles.forEach(p => {
                    if (p.billing?.customModuleApiName && p.billing.customModuleApiName.startsWith('cm_')) allCustomModules.add(p.billing.customModuleApiName);
                    if (p.inventory?.customModuleApiName && p.inventory.customModuleApiName.startsWith('cm_')) allCustomModules.add(p.inventory.customModuleApiName);
                });
                targetJobTypes = Array.from(allCustomModules);
            }
            
            for (const currentJobType of targetJobTypes) {
                await db.query("UPDATE jobs SET status = 'ended' WHERE jobtype = $1", [currentJobType]);
                
                if (currentJobType.startsWith('Flow_')) {
                    const profiles = readProfiles();
                    profiles.forEach(p => {
                        if (flowHandler.killClock) flowHandler.killClock(`Flow_${p.profileName}_${p.profileName}`);
                    });
                } else {
                    const { Queue } = require('bullmq');
                    const { connection } = require('./worker');
                    const metaKeys = await connection.keys(`bull:${currentJobType}Queue_*:meta`);
                    if (metaKeys.length > 0) {
                        for (const metaKey of metaKeys) {
                            const queueName = metaKey.replace('bull:', '').replace(':meta', '');
                            const profileName = queueName.replace(`${currentJobType}Queue_`, '');
                            socket.emit('wipeProgress', { jobType, message: `🧹 Obliterating Account: ${profileName}...` });
                            const q = new Queue(queueName, { connection });
                            try {
                                await q.pause(); 
                                await q.obliterate({ force: true }); 
                            } catch (e) {
                                const rawKeys = await connection.keys(`bull:${queueName}:*`);
                                if (rawKeys.length > 0) await connection.del(...rawKeys);
                            } finally {
                                await q.close();
                            }
                        }
                    }
                }
                await db.query("DELETE FROM jobs WHERE jobtype = $1", [currentJobType]);
            }
            socket.emit('allJobsCleared', { jobType });
        } catch (error) {
            socket.emit('wipeProgress', { jobType, message: `Fatal Error during wipe: ${error.message}`, error: true });
        }
    });

    socket.on('pauseJob', async ({ profileName, jobType }) => {
        try {
            const jobRecord = await db.query("SELECT status FROM jobs WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
            if (jobRecord.rows.length === 0) return;
            const currentStatus = jobRecord.rows[0].status;
            let isQueued = false;

            if (currentStatus === 'queued') {
                await db.query("UPDATE jobs SET status = 'paused_queued' WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
                isQueued = true;
            } else if (currentStatus === 'running') {
                await db.query("UPDATE jobs SET status = 'paused' WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
                
                if (!jobType.startsWith('Flow_')) {
                    try {
                        const { Queue } = require('bullmq'); const { connection } = require('./worker');
                        const accountQueue = new Queue(`${jobType}Queue_${profileName}`, { connection });
                        await accountQueue.pause(); await accountQueue.close(); 
                    } catch(e) {}
                }
                isQueued = false;
            }
            socket.emit('jobPaused', { profileName, jobType, reason: 'Paused by user', isQueued });
        } catch (error) {}
    });

    socket.on('resumeJob', async ({ profileName, jobType }) => {
        try {
            const jobRecord = await db.query("SELECT status FROM jobs WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
            if (jobRecord.rows.length === 0) return;
            const currentStatus = jobRecord.rows[0].status;
            let isQueued = false;

            if (currentStatus === 'paused_queued') {
                await db.query("UPDATE jobs SET status = 'queued' WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
                isQueued = true;
            } else if (currentStatus === 'paused') {
                await db.query("UPDATE jobs SET status = 'running' WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
                
                if (!jobType.startsWith('Flow_')) {
                    try {
                        const { Queue } = require('bullmq'); const { connection } = require('./worker');
                        const accountQueue = new Queue(`${jobType}Queue_${profileName}`, { connection });
                        await accountQueue.resume(); await accountQueue.close(); 
                    } catch(e) {}
                }
                isQueued = false;
            }
            socket.emit('jobResumed', { profileName, jobType, isQueued });
        } catch (error) {}
    });

    socket.on('endJob', async ({ profileName, jobType }) => {
        try {
            await db.query("UPDATE jobs SET status = 'ended' WHERE profilename = $1 AND jobtype = $2", [profileName, jobType]);
            if (jobType.startsWith('Flow_')) {
                const jobId = `${jobType}_${profileName}`;
                if (flowHandler.killClock) flowHandler.killClock(jobId);
            } else {
                try {
                    const { Queue } = require('bullmq'); const { connection } = require('./worker');
                    const accountQueue = new Queue(`${jobType}Queue_${profileName}`, { connection });
                    await accountQueue.pause(); await accountQueue.close();
                } catch(e) {}
            }
            socket.emit('bulkEnded', { profileName, jobType });
        } catch(error) {}
    });

    // --- MODULE HANDLERS ---
    const inventoryListeners = { 'startBulkInvoice': inventoryHandler.handleStartBulkInvoice, 'getOrgDetails': inventoryHandler.handleGetOrgDetails, 'updateOrgDetails': inventoryHandler.handleUpdateOrgDetails, 'getInvoices': inventoryHandler.handleGetInvoices, 'deleteInvoices': inventoryHandler.handleDeleteInvoices };
    for (const [event, handler] of Object.entries(inventoryListeners)) { socket.on(event, (data) => { const profiles = readProfiles(); const activeProfile = data ? profiles.find(p => p.profileName === data.selectedProfileName) : null; if (activeProfile) { if (event.startsWith('startBulk')) io.emit('jobStarted', { profileName: data.selectedProfileName, jobType: 'invoice' }); handler(socket, { ...data, activeProfile }); } }); }

    socket.on('fetchModuleFields', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if(activeProfile) customModuleHandler.handleFetchModuleFields(socket, { ...data, activeProfile, moduleApiName: data.moduleApiName || activeProfile.inventory?.customModuleApiName }); });
    socket.on('startBulkCustomJob', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if(activeProfile) { io.emit('jobStarted', { profileName: data.selectedProfileName, jobType: data.moduleApiName }); customModuleHandler.handleStartBulkCustomJob(socket, { ...data, activeProfile }); } });
    
    socket.on('startMasterBatchCustomJob', (data) => { customModuleHandler.handleStartMasterBatch(socket, data); });

    socket.on('startBulkBillingInvoice', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingHandler.handleStartBulkBillingInvoice(socket, { ...data, activeProfile }); });
    socket.on('getBillingInvoices', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingHandler.handleGetInvoices(socket, { ...data, activeProfile }); });
    socket.on('deleteBillingInvoices', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingHandler.handleDeleteInvoices(socket, { ...data, activeProfile }); });
    socket.on('getBillingOrgDetails', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingHandler.handleGetOrgDetails(socket, { ...data, activeProfile }); });
    socket.on('updateBillingOrgDetails', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingHandler.handleUpdateOrgDetails(socket, { ...data, activeProfile }); });
    socket.on('startBulkBillingContact', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingHandler.handleStartBulkBillingContact(socket, { ...data, activeProfile }); });

    socket.on('fetchBillingModuleFields', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingCustomHandler.handleFetchBillingModuleFields(socket, { ...data, activeProfile, moduleApiName: data.moduleApiName || activeProfile.billing?.customModuleApiName }); });
    socket.on('startBulkBillingCustomJob', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) billingCustomHandler.handleStartBulkBillingCustomJob(socket, { ...data, activeProfile }); });

    socket.on('startMasterBulkBillingCustomJob', (data) => { billingCustomHandler.handleStartMasterBatch(socket, data); });

    const booksListeners = { 'startBulkBooksInvoice': booksHandler.handleStartBulkInvoice, 'startBulkBooksContact': booksHandler.handleStartBulkContact, 'getBooksOrgDetails': booksHandler.handleGetOrgDetails, 'updateBooksOrgDetails': booksHandler.handleUpdateOrgDetails, 'getBooksInvoices': booksHandler.handleGetInvoices, 'deleteBooksInvoices': booksHandler.handleDeleteInvoices };
    for (const [event, handler] of Object.entries(booksListeners)) { socket.on(event, (data) => { const profiles = readProfiles(); const activeProfile = data ? profiles.find(p => p.profileName === data.selectedProfileName) : null; if (activeProfile) handler(socket, { ...data, activeProfile }); }); }
    socket.on('fetchBooksModuleFields', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if(activeProfile) booksCustomHandler.handleFetchModuleFields(socket, { ...data, activeProfile, moduleApiName: data.moduleApiName || activeProfile.books?.customModuleApiName }); });
    socket.on('startBulkBooksCustomJob', (data) => { booksCustomHandler.handleStartBulkBooksCustomJob(socket, data); });

    socket.on('getExpenseFields', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) expenseHandler.handleGetExpenseFields(socket, { ...data, activeProfile }); });
    socket.on('startBulkExpenseCreation', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) expenseHandler.handleStartBulkExpenseCreation(socket, { ...data, activeProfile }); });

    socket.onAny((eventName, ...args) => {
        if (eventName.toLowerCase().includes('start')) {
            const moduleName = eventName.replace(/handleStartBulk|startBulk|handleStart|start/gi, '');
            logFrontendIntention(moduleName, args[0]);
        }
    });
    
    // ⚡ FLOW / WEBHOOKS
    socket.on('startBulkFlowJob', (data) => { const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === data.selectedProfileName); if (activeProfile) flowHandler.handleStartBulkFlowJob(socket, { ...data, activeProfile }); });
    socket.on('startMasterBatchFlowJob', (data) => { flowHandler.handleStartMasterBatch(socket, data); });
});

server.listen(port, () => {
    console.log(`\n${cliColors.greenBold}🚀 Distributed Web API Server is running on http://localhost:${port}${cliColors.reset}\n`);
});