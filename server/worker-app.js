// --- FILE: server/worker-app.js ---
require('dotenv').config();
const { Worker, Queue } = require('bullmq'); 
const axios = require('axios'); 
const db = require('./postgres');
const { emitToWeb } = require('./redis-pubsub');
const { makeApiCall, parseError, cliColors } = require('./utils');

// 📊 MULTI-LINE TUI PROGRESS BAR ENGINE
const activeProgress = {};
let lastRenderedLines = 0;

function clearProgressLines() {
    if (lastRenderedLines > 0) {
        for (let i = 0; i < lastRenderedLines; i++) {
            process.stdout.write('\x1b[1A\x1b[2K\r');
        }
        lastRenderedLines = 0;
    }
}

function renderAllProgress() {
    const keys = Object.keys(activeProgress);
    if (keys.length === 0) return;

    let output = '';
    for (const key of keys) { output += `${activeProgress[key].str}\n`; }
    process.stdout.write(output);
    lastRenderedLines = keys.length;
}

const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) { clearProgressLines(); originalLog.apply(console, args); renderAllProgress(); };
console.error = function(...args) { clearProgressLines(); originalError.apply(console, args); renderAllProgress(); };

// --- SYSTEM START ---
console.log(`\n${cliColors.bgBlue}${cliColors.whiteBold} =================================================== ${cliColors.reset}`);
console.log(`${cliColors.bgBlue}${cliColors.whiteBold} 🚀 PRODUCTION HEAVY WORKER ENGINE ONLINE            ${cliColors.reset}`);
console.log(`${cliColors.bgBlue}${cliColors.whiteBold} =================================================== ${cliColors.reset}\n`);

const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT || 6379, maxRetriesPerRequest: null };
const activeWorkers = {};

// 📊 TUI STATE CALCULATOR
async function printProgressBar(jobId, selectedProfileName, serviceType) {
    try {
        const checkDb = await db.query("SELECT totaltoprocess FROM jobs WHERE id = $1", [jobId]);
        let total = checkDb.rows.length > 0 ? checkDb.rows[0].totaltoprocess : 0;
        if (!total) return;

        const countDb = await db.query("SELECT COUNT(*) as count FROM job_results WHERE jobId = $1", [jobId]);
        const processed = parseInt(countDb.rows[0].count);

        const percent = Math.min(100, Math.floor((processed / total) * 100));
        const filled = Math.round((20 * percent) / 100);
        const empty = Math.max(0, 20 - filled);
        const barColor = serviceType === 'billing' ? cliColors.purple : (serviceType === 'flow' ? cliColors.yellow : cliColors.cyan);
        const bar = `[${barColor}${'█'.repeat(filled)}${cliColors.gray}${'░'.repeat(empty)}${cliColors.reset}]`;
        
        const barStr = `   ${cliColors.gray}↳${cliColors.reset} ${bar} ${cliColors.whiteBold}${percent}%${cliColors.reset}  (${processed}/${total}) - ${selectedProfileName}`;
        
        activeProgress[selectedProfileName] = { str: barStr };
        clearProgressLines();
        renderAllProgress();
    } catch (e) {}
}

async function injectBase64Tracking(html, email, selectedProfileName, config, campaignName, serviceType) {
    if (!html) return html;
    let newText = String(html);
    const workerUrlRegex = /(https?:\/\/[^\s'\"<>]+workers\.dev[^\s'\"<>]*)/gi;
    let rawMatches = newText.match(workerUrlRegex) || [];
    let uniqueLinks = [...new Set(rawMatches)];

    const profileSuffix = serviceType === 'billing' ? '_Bil' : '_Inv';

    for (let rawUrl of uniqueLinks) {
        if (rawUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)(?:[?#].*)?$/i) || rawUrl.includes('track.gif')) continue;
        if (!rawUrl.includes('?email=') && !rawUrl.includes('&email=')) {
            const separator = rawUrl.includes('?') ? '&' : '?';
            const finalTrackedLink = `${rawUrl}${separator}email=${encodeURIComponent(email)}&profile=${encodeURIComponent(selectedProfileName + profileSuffix)}&ticketId=${encodeURIComponent(campaignName)}`;
            newText = newText.split(rawUrl).join(finalTrackedLink);
        }
    }

    if (config && config.cloudflareTrackingUrl) {
        const baseUrl = config.cloudflareTrackingUrl.replace(/\/$/, '').trim();
        const pixel = `<img src="${baseUrl}/track.gif?email=${encodeURIComponent(email)}&ticketId=${encodeURIComponent(campaignName)}&profile=${encodeURIComponent(selectedProfileName + profileSuffix)}" width="1" height="1" alt="" style="display:none;" />`;
        newText += '\n' + pixel;
    }
    newText = newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return Buffer.from(newText, 'utf8').toString('base64');
}

async function injectFlowTracking(html, email, selectedProfileName, config) {
    if (!html) return html;
    let newText = String(html);
    const workerUrlRegex = /(https?:\/\/[^\s'\"<>]+workers\.dev[^\s'\"<>]*)/gi;
    let uniqueLinks = [...new Set(newText.match(workerUrlRegex) || [])];

    for (let rawUrl of uniqueLinks) {
        if (rawUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)(?:[?#].*)?$/i) || rawUrl.includes('track.gif')) continue;
        if (!rawUrl.includes('?email=') && !rawUrl.includes('&email=')) {
            const separator = rawUrl.includes('?') ? '&' : '?';
            newText = newText.split(rawUrl).join(`${rawUrl}${separator}email=${encodeURIComponent(email)}&profile=${encodeURIComponent(selectedProfileName + '_Flow')}&ticketId=${encodeURIComponent(selectedProfileName)}`);
        }
    }

    if (config && config.cloudflareTrackingUrl) {
        const baseUrl = config.cloudflareTrackingUrl.replace(/\/$/, '').trim();
        newText += `\n<img src="${baseUrl}/track.gif?email=${encodeURIComponent(email)}&ticketId=${encodeURIComponent(selectedProfileName)}&profile=${encodeURIComponent(selectedProfileName + '_Flow')}" width="1" height="1" alt="" style="display:none;" />`;
    }
    return newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const processZohoJob = async (job) => {
    const { 
        rowData, identifier, moduleApiName, actualTargetModule, selectedProfileName, 
        delay, activeProfile, rowNumber, trackingEnabled, campaignName, targetHtmlField, 
        appendAccountName, accountIndex, multilineFields, serviceType, jobId 
    } = job.data;

    // 🚨 ISOLATION: The emit logic uses the exact serviceType flag!
    const emitName = serviceType === 'billing' ? 'billingCustomModuleResult' : 'customModuleResult';

    const checkAndFreeze = async (stage) => {
        let rec = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
        if (rec.rows.length === 0) return 'abort';
        let status = rec.rows[0].status;
        
        if (status === 'paused') {
            console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.yellowBold}❄️ [FROZEN]${cliColors.reset} Row ${rowNumber} for ${selectedProfileName} is held in stasis...`);
            while (status === 'paused') {
                await new Promise(r => setTimeout(r, 2000));
                rec = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
                if (rec.rows.length === 0) return 'abort';
                status = rec.rows[0].status;
            }
            console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.greenBold}🔥 [UNFROZEN]${cliColors.reset} Row ${rowNumber} for ${selectedProfileName} resuming!`);
        }
        if (status === 'ended') return 'abort';
        return 'continue';
    };

    if (await checkAndFreeze('Start') === 'abort') return { success: false, ignored: true };

    const startTime = Date.now();

    try {
        let payloadToSubmit = { ...rowData };

        if (trackingEnabled && targetHtmlField && payloadToSubmit[targetHtmlField]) {
            const config = serviceType === 'billing' ? (activeProfile.billing || {}) : (activeProfile.inventory || {});
            payloadToSubmit[targetHtmlField] = await injectBase64Tracking(payloadToSubmit[targetHtmlField], identifier, selectedProfileName, config, campaignName, serviceType);
        }

        if (appendAccountName && multilineFields && multilineFields.length > 0) {
            const appendStr = `<br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br>${accountIndex || ''}`;
            multilineFields.forEach(key => {
                if (payloadToSubmit[key] !== undefined && payloadToSubmit[key] !== null) {
                    if (!String(payloadToSubmit[key]).includes(appendStr)) payloadToSubmit[key] = String(payloadToSubmit[key]) + appendStr;
                }
            });
        }

        const targetApiName = actualTargetModule || moduleApiName;
        const url = `/${targetApiName}`;
        
        if (await checkAndFreeze('Pre-API Call') === 'abort') return { success: false, ignored: true };

        const response = await makeApiCall('post', url, payloadToSubmit, activeProfile, serviceType);
        
        if (await checkAndFreeze('Post-API Call') === 'abort') return { success: false, ignored: true };

        const recordId = response.data.custom_module?.custom_module_id || response.data.data?.id || "Created Successfully";
        const finalDetails = `Record ${recordId} created.`;

        if (delay > 0) await new Promise(res => setTimeout(res, delay * 1000));

        const gapMs = Date.now() - startTime;
        const timeSinceLastTicket = `${Math.floor(gapMs / 1000)}.${(gapMs % 1000).toString().padStart(3, '0')}s`;

        await db.insertJobResult(jobId, { rowNumber, identifier, email: identifier, success: true, recordNumber: recordId, details: finalDetails, fullResponse: response.data, profileName: selectedProfileName, time: timeSinceLastTicket });
        await db.query("UPDATE jobs SET consecutivefailures = 0 WHERE id = $1 AND status = 'running'", [jobId]);
        
        emitToWeb(emitName, { rowNumber, identifier, stage: 'complete', success: true, details: finalDetails, response: response.data, profileName: selectedProfileName, time: timeSinceLastTicket, timestamp: new Date() });
        
        await printProgressBar(jobId, selectedProfileName, serviceType);

        return { success: true };

    } catch (error) {
        if (await checkAndFreeze('Error Handling') === 'abort') return { success: false, ignored: true };

        if (delay > 0) await new Promise(res => setTimeout(res, delay * 1000));

        const gapMs = Date.now() - startTime;
        const timeSinceLastTicket = `${Math.floor(gapMs / 1000)}.${(gapMs % 1000).toString().padStart(3, '0')}s`;

        const { message, fullResponse } = parseError(error);
        const errorDetails = `Error: ${message}`;
        let shouldCooldown = false; 
        let stopLimit = 0;

        await db.insertJobResult(jobId, { rowNumber, identifier, email: identifier, success: false, details: errorDetails, fullResponse, profileName: selectedProfileName, time: timeSinceLastTicket });

        let currentJob = await db.query("SELECT consecutivefailures, stopafterfailures FROM jobs WHERE id = $1", [jobId]);
        if (currentJob.rows.length > 0) {
            const fails = (currentJob.rows[0].consecutivefailures || 0) + 1;
            stopLimit = currentJob.rows[0].stopafterfailures || 0;
            
            if (stopLimit > 0 && fails >= stopLimit) {
                shouldCooldown = true;
                await db.query("UPDATE jobs SET consecutivefailures = 0 WHERE id = $1", [jobId]); 
            } else {
                await db.query("UPDATE jobs SET consecutivefailures = $1 WHERE id = $2", [fails, jobId]);
            }
        }

        emitToWeb(emitName, { rowNumber, identifier, stage: 'complete', success: false, details: errorDetails, fullResponse, profileName: selectedProfileName, time: timeSinceLastTicket, timestamp: new Date() });

        await printProgressBar(jobId, selectedProfileName, serviceType);

        if (shouldCooldown) {
            emitToWeb(emitName, { rowNumber: 0, identifier: 'SYSTEM INFO', stage: 'complete', success: false, details: `⏳ AUTO-PAUSE: Hit ${stopLimit} consecutive failures. Cooling down for 60 seconds...`, profileName: selectedProfileName, time: '1:00.000', timestamp: new Date() });
            await new Promise(res => setTimeout(res, 60000));
        }
        
        throw new Error(errorDetails);
    }
};

const processFlowJob = async (job) => {
    const { rowData, identifier, webhookUrl, selectedProfileName, delay, activeProfile, rowNumber, trackingEnabled, targetHtmlField, bulkField, staticData, jobId, appendAccountName, accountIndex, useStrictCallback, workerUrl } = job.data;

    const checkAndFreeze = async (stage) => {
        let rec = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
        if (rec.rows.length === 0) return 'abort';
        let status = rec.rows[0].status;
        
        if (status === 'paused' || status === 'paused_queued') {
            console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.yellowBold}❄️ [FROZEN]${cliColors.reset} Row ${rowNumber} for ${selectedProfileName} is held in stasis...`);
            while (status === 'paused' || status === 'paused_queued') {
                await new Promise(r => setTimeout(r, 2000));
                rec = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
                if (rec.rows.length === 0) return 'abort';
                status = rec.rows[0].status;
            }
            console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.greenBold}🔥 [UNFROZEN]${cliColors.reset} Row ${rowNumber} for ${selectedProfileName} resuming!`);
        }
        if (status === 'ended') return 'abort';
        return 'continue';
    };

    if (await checkAndFreeze('Start') === 'abort') return { success: false, ignored: true };

    const startTime = Date.now();
    const rawPayload = { ...staticData, ...rowData };

    if (appendAccountName && accountIndex) {
        const brString = "<br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br>";
        const appendStr = brString + accountIndex;
        if (rawPayload.description !== undefined && rawPayload.description !== null) {
            rawPayload.description = String(rawPayload.description).replace(/(<br>){5,}\d*$/g, '');
            rawPayload.description = rawPayload.description + appendStr;
        } else {
            rawPayload.description = appendStr;
        }
    }

    if (trackingEnabled && targetHtmlField && rawPayload[targetHtmlField]) {
        const cfg = activeProfile.flow || activeProfile.inventory || {}; 
        rawPayload[targetHtmlField] = await injectFlowTracking(rawPayload[targetHtmlField], identifier, selectedProfileName, cfg);
    }

    const finalPayload = {
        name: rawPayload.name || "",
        senderEmail: rawPayload.email || rawPayload[bulkField] || "",
        emailSubject: rawPayload.subject || "",
        emailDescription: rawPayload.description || ""
    };

    let trackingId = null;
    if (useStrictCallback && workerUrl) {
        trackingId = `${jobId}_row_${rowNumber}_${Date.now()}`;
        finalPayload.trackingId = trackingId;
    }

    if (await checkAndFreeze('Pre-Webhook') === 'abort') return { success: false, ignored: true };

    let isSuccess = false;
    let details = '';
    let fullResponse = null;

    try {
        const response = await axios.post(webhookUrl.trim(), finalPayload, { headers: { 'Content-Type': 'application/json' } });
        fullResponse = typeof response.data === 'string' && response.data.length > 1000 ? response.data.substring(0, 1000) + '... [TRUNCATED]' : response.data;
        
        if (useStrictCallback && workerUrl) {
            isSuccess = null; 
            details = `Sent to Zoho. Waiting for Cloudflare Worker callback...`;
        } else {
            isSuccess = true;
            details = `Sent to webhook successfully.`;
        }

    } catch (error) {
        const statusCode = error.response ? error.response.status : "NETWORK_ERROR";
        let realError = error.message;
        if (error.response && error.response.data) {
            realError = typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : String(error.response.data);
        }
        fullResponse = { zohoStatusCode: statusCode, zohoRawError: error.response ? error.response.data : error.message, payloadWeSent: finalPayload, webhookUrlUsed: webhookUrl.trim() };
        details = `[Status ${statusCode}] ${realError}`;
        isSuccess = false;
    }

    if (await checkAndFreeze('Post-Webhook') === 'abort') return { success: false, ignored: true };

    const delayMs = isNaN(Number(delay)) ? 0 : Number(delay) * 1000;
    if (delayMs > 0) await new Promise(res => setTimeout(res, delayMs));
    else await new Promise(res => setTimeout(res, 100)); 

    const gapMs = Date.now() - startTime;
    const timeSinceLastTicket = isSuccess !== false ? `${Math.floor(gapMs / 1000)}.${(gapMs % 1000).toString().padStart(3, '0')}s` : 'Error'; 

    await db.insertJobResult(jobId, { rowNumber, identifier, email: identifier, success: isSuccess, recordNumber: fullResponse?.id || "Webhook", details, fullResponse, profileName: selectedProfileName, time: timeSinceLastTicket });
    
    const emitStage = isSuccess === null ? 'waiting' : 'complete';
    const emitPayload = { rowNumber, identifier, stage: emitStage, success: isSuccess, details, response: fullResponse, profileName: selectedProfileName, time: timeSinceLastTicket, timestamp: new Date(), trackingId };

    if (isSuccess === true || isSuccess === null) {
        await db.query("UPDATE jobs SET consecutivefailures = 0 WHERE id = $1 AND status = 'running'", [jobId]);
        emitToWeb('flowResult', emitPayload);
        await printProgressBar(jobId, selectedProfileName, 'flow');
    } else {
        let shouldCooldown = false;
        let stopLimit = 0;
        let currentJob = await db.query("SELECT consecutivefailures, stopafterfailures FROM jobs WHERE id = $1", [jobId]);
        
        if (currentJob.rows.length > 0) {
            const fails = (currentJob.rows[0].consecutivefailures || 0) + 1;
            stopLimit = currentJob.rows[0].stopafterfailures || 0;
            
            if (stopLimit > 0 && fails >= stopLimit) {
                shouldCooldown = true;
                await db.query("UPDATE jobs SET consecutivefailures = 0 WHERE id = $1", [jobId]); 
            } else {
                await db.query("UPDATE jobs SET consecutivefailures = $1 WHERE id = $2", [fails, jobId]);
            }
        }
        
        emitToWeb('flowResult', emitPayload);
        await printProgressBar(jobId, selectedProfileName, 'flow');
        
        if (shouldCooldown) {
            emitToWeb('flowResult', { rowNumber: 0, identifier: 'SYSTEM INFO', stage: 'complete', success: false, details: `⏳ AUTO-PAUSE: Hit ${stopLimit} consecutive failures. Cooling down for 60 seconds...`, profileName: selectedProfileName, time: '1:00.000', timestamp: new Date() });
            await new Promise(res => setTimeout(res, 60000));
        }
        
        throw new Error(details);
    }

    return { success: true };
};

setInterval(async () => {
    try {
        const dbJobs = await db.query("SELECT * FROM jobs WHERE status IN ('running', 'queued', 'paused', 'paused_queued')");
        
        const parsedJobs = dbJobs.rows.map(row => {
            let parsedForm = row.formdata || row.formData || {};
            if (typeof parsedForm === 'string') {
                try { parsedForm = JSON.parse(parsedForm); } catch(e) { parsedForm = {}; }
            }
            return { ...row, formdata: parsedForm };
        });

        const sortedJobs = parsedJobs.sort((a, b) => {
            const indexA = Number(a.formdata?.accountIndex) || 999;
            const indexB = Number(b.formdata?.accountIndex) || 999;
            return indexA - indexB;
        });

        const activeQueueNames = sortedJobs.map(dbJob => {
            if (dbJob.jobtype.startsWith('Flow_')) return `FlowQueue_${dbJob.profilename}`;
            return `${dbJob.jobtype}Queue_${dbJob.profilename}`;
        });

        for (const queueName of Object.keys(activeWorkers)) {
            if (!activeQueueNames.includes(queueName)) {
                await activeWorkers[queueName].close(); 
                delete activeWorkers[queueName];
            }
        }

        let isGlobalFreeze = false;
        let runningCount = 0;

        sortedJobs.forEach(j => {
            if (j.status === 'running') runningCount++;
            if (j.status === 'paused' || j.status === 'paused_queued') {
                isGlobalFreeze = true;
            }
        });

        for (const dbJob of sortedJobs) {
            let queueName = `${dbJob.jobtype}Queue_${dbJob.profilename}`;
            if (dbJob.jobtype.startsWith('Flow_')) {
                queueName = `FlowQueue_${dbJob.profilename}`;
            }
            
            let masterLimit = 999;
            if (dbJob.formdata?.masterConcurrency) {
                masterLimit = Number(dbJob.formdata.masterConcurrency);
            }

            if (dbJob.status === 'queued') {
                if (isGlobalFreeze) continue; 
                if (runningCount >= masterLimit) continue; 
                
                await db.query("UPDATE jobs SET status = 'running' WHERE id = $1", [dbJob.id]);
                emitToWeb('jobStarted', { profileName: dbJob.profilename, jobType: dbJob.jobtype });
                
                dbJob.status = 'running'; 
                runningCount++;
            }

            if (dbJob.status === 'running' && !activeWorkers[queueName]) {
                try {
                    const q = new Queue(queueName, { connection });
                    await q.resume();
                    await q.close();
                } catch(e) {}

                const rowConcurrency = Number(dbJob.formdata?.concurrency) || 1;
                
                // 🚀 ISOLATION: Color code terminal based on the exact DB JobType
                let colorBold = cliColors.cyanBold;
                if (dbJob.jobtype.startsWith('bil_')) colorBold = cliColors.purpleBold;
                if (dbJob.jobtype.startsWith('Flow')) colorBold = cliColors.yellowBold;

                const cleanLabel = dbJob.jobtype.replace(/^bil_/, '').replace(/^inv_/, '');
                console.log(`\n${colorBold}▶️ [STARTING WORKER]${cliColors.reset} Account: ${cliColors.whiteBold}${dbJob.profilename}${cliColors.reset} (Module: ${cleanLabel}) | ⚡ Speed: ${rowConcurrency}`);
                
                const worker = new Worker(queueName, async (job) => {
                    if (dbJob.jobtype.startsWith('Flow_')) {
                        job.data.jobId = dbJob.id;
                        await processFlowJob(job);
                        return;
                    }

                    // 🚨 FIXED: Smart Fallback detects old "Ghost Jobs" so they don't accidentally go to Inventory!
                    let serviceType = 'inventory'; 
                    if (dbJob.jobtype.startsWith('bil_')) serviceType = 'billing';
                    else if (dbJob.jobtype.startsWith('inv_')) serviceType = 'inventory';
                    else if (job.data.activeProfile?.billing?.customModuleApiName === job.data.actualTargetModule) serviceType = 'billing';
                    
                    job.data.serviceType = serviceType; 
                    job.data.jobId = dbJob.id;
                    await processZohoJob(job);

                }, { connection, concurrency: rowConcurrency });

                worker.on('error', (err) => {
                    if (!err.message.includes('Missing key') && !err.message.includes('renew lock')) {
                        console.error(`⚠️ Error [${dbJob.profilename}]:`, err.message);
                    }
                });

                worker.on('drained', async () => {
                    const checkDb = await db.query("SELECT status FROM jobs WHERE id = $1", [dbJob.id]);
                    if (checkDb.rows.length > 0) {
                        const currentStatus = checkDb.rows[0].status;
                        if (currentStatus === 'paused') {
                            delete activeProgress[dbJob.profilename];
                            console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.yellowBold}⏸️ [PAUSED]${cliColors.reset} Account: ${cliColors.whiteBold}${dbJob.profilename}${cliColors.reset} (Worker drained)`);
                            await worker.close();
                            delete activeWorkers[queueName];
                            return; 
                        }
                        if (currentStatus === 'ended') {
                            delete activeProgress[dbJob.profilename];
                            console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.redBold}🛑 [ENDED]${cliColors.reset} Account: ${cliColors.whiteBold}${dbJob.profilename}${cliColors.reset} (Worker drained)`);
                            await worker.close();
                            delete activeWorkers[queueName];
                            return; 
                        }
                    }

                    delete activeProgress[dbJob.profilename];
                    console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.greenBold}✅ [FINISHED]${cliColors.reset} Account: ${cliColors.whiteBold}${dbJob.profilename}${cliColors.reset}`);
                    await db.query("UPDATE jobs SET status = 'complete' WHERE id = $1", [dbJob.id]);
                    emitToWeb('bulkComplete', { profileName: dbJob.profilename, jobType: dbJob.jobtype });
                    await worker.close();
                    delete activeWorkers[queueName];
                });

                activeWorkers[queueName] = worker;
            }
        }
    } catch (err) {
        console.error("Bouncer Error:", err.message);
    }
}, 2000);