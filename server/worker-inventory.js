// --- FILE: server/worker-inventory.js ---
require('dotenv').config();
const { Worker, Queue } = require('bullmq'); 
const db = require('./postgres-inventory'); // 👈 ISOLATED DB
const { emitToWeb } = require('./redis-pubsub');
const { makeApiCall, parseError, cliColors } = require('./utils');

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

console.log(`\n${cliColors.cyanBold} =================================================== ${cliColors.reset}`);
console.log(`${cliColors.cyanBold} 🔵 PRODUCTION INVENTORY WORKER ENGINE ONLINE          ${cliColors.reset}`);
console.log(`${cliColors.cyanBold} =================================================== ${cliColors.reset}\n`);

const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT || 6379, maxRetriesPerRequest: null };
const activeWorkers = {};

async function printProgressBar(jobId, selectedProfileName) {
    try {
        const checkDb = await db.query("SELECT totaltoprocess FROM jobs WHERE id = $1", [jobId]);
        let total = checkDb.rows.length > 0 ? checkDb.rows[0].totaltoprocess : 0;
        if (!total) return;

        const countDb = await db.query("SELECT COUNT(*) as count FROM job_results WHERE jobId = $1", [jobId]);
        const processed = parseInt(countDb.rows[0].count);

        const percent = Math.min(100, Math.floor((processed / total) * 100));
        const filled = Math.round((20 * percent) / 100);
        const empty = Math.max(0, 20 - filled);
        const bar = `[${cliColors.cyan}${'█'.repeat(filled)}${cliColors.gray}${'░'.repeat(empty)}${cliColors.reset}]`;
        
        activeProgress[selectedProfileName] = { str: `   ${cliColors.gray}↳${cliColors.reset} ${bar} ${cliColors.whiteBold}${percent}%${cliColors.reset}  (${processed}/${total}) - ${selectedProfileName}` };
        clearProgressLines();
        renderAllProgress();
    } catch (e) {}
}

async function injectBase64Tracking(html, email, selectedProfileName, config, campaignName) {
    if (!html) return html;
    let newText = String(html);
    const workerUrlRegex = /(https?:\/\/[^\s'\"<>]+workers\.dev[^\s'\"<>]*)/gi;
    let uniqueLinks = [...new Set(newText.match(workerUrlRegex) || [])];

    for (let rawUrl of uniqueLinks) {
        if (rawUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)(?:[?#].*)?$/i) || rawUrl.includes('track.gif')) continue;
        if (!rawUrl.includes('?email=') && !rawUrl.includes('&email=')) {
            const separator = rawUrl.includes('?') ? '&' : '?';
            newText = newText.split(rawUrl).join(`${rawUrl}${separator}email=${encodeURIComponent(email)}&profile=${encodeURIComponent(selectedProfileName + '_Inv')}&ticketId=${encodeURIComponent(campaignName)}`);
        }
    }

    if (config && config.cloudflareTrackingUrl) {
        const baseUrl = config.cloudflareTrackingUrl.replace(/\/$/, '').trim();
        newText += '\n' + `<img src="${baseUrl}/track.gif?email=${encodeURIComponent(email)}&ticketId=${encodeURIComponent(campaignName)}&profile=${encodeURIComponent(selectedProfileName + '_Inv')}" width="1" height="1" alt="" style="display:none;" />`;
    }
    return Buffer.from(newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8').toString('base64');
}

const processZohoJob = async (job) => {
    const { rowData, identifier, moduleApiName, actualTargetModule, selectedProfileName, delay, activeProfile, rowNumber, trackingEnabled, campaignName, targetHtmlField, appendAccountName, accountIndex, multilineFields, jobId } = job.data;

    const checkAndFreeze = async () => {
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
        return status === 'ended' ? 'abort' : 'continue';
    };

    if (await checkAndFreeze() === 'abort') return { success: false, ignored: true };
    const startTime = Date.now();

    try {
        let payloadToSubmit = { ...rowData };

        if (trackingEnabled && targetHtmlField && payloadToSubmit[targetHtmlField]) {
            payloadToSubmit[targetHtmlField] = await injectBase64Tracking(payloadToSubmit[targetHtmlField], identifier, selectedProfileName, activeProfile.inventory || {}, campaignName);
        }

        if (appendAccountName && multilineFields && multilineFields.length > 0) {
            const appendStr = `<br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br>${accountIndex || ''}`;
            multilineFields.forEach(key => {
                if (payloadToSubmit[key] !== undefined && payloadToSubmit[key] !== null) {
                    if (!String(payloadToSubmit[key]).includes(appendStr)) payloadToSubmit[key] = String(payloadToSubmit[key]) + appendStr;
                }
            });
        }

        if (await checkAndFreeze() === 'abort') return { success: false, ignored: true };

        const response = await makeApiCall('post', `/${actualTargetModule || moduleApiName}`, payloadToSubmit, activeProfile, 'inventory');
        if (await checkAndFreeze() === 'abort') return { success: false, ignored: true };

        const recordId = response.data.custom_module?.custom_module_id || response.data.data?.id || "Created";
        if (delay > 0) await new Promise(res => setTimeout(res, delay * 1000));

        const timeStr = `${Math.floor((Date.now() - startTime) / 1000)}.${((Date.now() - startTime) % 1000).toString().padStart(3, '0')}s`;

        await db.insertJobResult(jobId, { rowNumber, identifier, success: true, recordNumber: recordId, details: `Record ${recordId} created.`, fullResponse: response.data, profileName: selectedProfileName, time: timeStr });
        await db.query("UPDATE jobs SET consecutivefailures = 0 WHERE id = $1 AND status = 'running'", [jobId]);
        emitToWeb('customModuleResult', { rowNumber, identifier, stage: 'complete', success: true, details: `Record ${recordId} created.`, response: response.data, profileName: selectedProfileName, time: timeStr, timestamp: new Date() });
        await printProgressBar(jobId, selectedProfileName, 'inventory');
        return { success: true };

    } catch (error) {
        if (await checkAndFreeze() === 'abort') return { success: false, ignored: true };
        if (delay > 0) await new Promise(res => setTimeout(res, delay * 1000));

        const timeStr = `${Math.floor((Date.now() - startTime) / 1000)}.${((Date.now() - startTime) % 1000).toString().padStart(3, '0')}s`;
        const { message, fullResponse } = parseError(error);
        let stopLimit = 0; let shouldCooldown = false;

        await db.insertJobResult(jobId, { rowNumber, identifier, success: false, details: `Error: ${message}`, fullResponse, profileName: selectedProfileName, time: timeStr });

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

        emitToWeb('customModuleResult', { rowNumber, identifier, stage: 'complete', success: false, details: `Error: ${message}`, fullResponse, profileName: selectedProfileName, time: timeStr, timestamp: new Date() });
        await printProgressBar(jobId, selectedProfileName, 'inventory');

        if (shouldCooldown) {
            emitToWeb('customModuleResult', { rowNumber: 0, identifier: 'SYSTEM INFO', stage: 'complete', success: false, details: `⏳ AUTO-PAUSE: Hit ${stopLimit} failures. Cooling down...`, profileName: selectedProfileName, time: '1:00', timestamp: new Date() });
            await new Promise(res => setTimeout(res, 60000));
        }
        throw new Error(message);
    }
};

setInterval(async () => {
    try {
        if (Math.random() < 0.066) { 
            try { await db.query(`SELECT COUNT(*) FROM job_results WHERE jobId NOT IN (SELECT id FROM jobs)`); } catch (e) {} 
        }

        const dbJobs = await db.query("SELECT * FROM jobs WHERE status IN ('running', 'queued', 'paused', 'paused_queued')");
        const parsedJobs = dbJobs.rows.map(row => {
            let form = row.formdata || row.formData || {};
            if (typeof form === 'string') try { form = JSON.parse(form); } catch(e) { form = {}; }
            return { ...row, formdata: form };
        }).sort((a, b) => (Number(a.formdata?.accountIndex) || 999) - (Number(b.formdata?.accountIndex) || 999));

        const activeQueueNames = parsedJobs.map(j => `${j.jobtype}Queue_${j.profilename}`);
        for (const q of Object.keys(activeWorkers)) {
            if (!activeQueueNames.includes(q)) { await activeWorkers[q].close(); delete activeWorkers[q]; }
        }

        let runningCount = 0;
        parsedJobs.forEach(j => { if (j.status === 'running') runningCount++; });

        for (const dbJob of parsedJobs) {
            let queueName = `${dbJob.jobtype}Queue_${dbJob.profilename}`;
            let masterLimit = Number(dbJob.formdata?.masterConcurrency) || 999;

            if (dbJob.status === 'queued') {
                if (runningCount >= masterLimit) continue; 
                await db.query("UPDATE jobs SET status = 'running' WHERE id = $1", [dbJob.id]);
                emitToWeb('jobStarted', { profileName: dbJob.profilename, jobType: dbJob.jobtype });
                dbJob.status = 'running'; runningCount++;
            }

            if (dbJob.status === 'running' && !activeWorkers[queueName]) {
                try { const q = new Queue(queueName, { connection }); await q.resume(); await q.close(); } catch(e) {}
                
                console.log(`\n${cliColors.cyanBold}▶️ [INVENTORY WORKER STARTING]${cliColors.reset} Account: ${cliColors.whiteBold}${dbJob.profilename}${cliColors.reset} | ⚡ Speed: ${dbJob.formdata?.concurrency || 1}`);
                
                const worker = new Worker(queueName, async (job) => {
                    job.data.jobId = dbJob.id;
                    job.data.serviceType = 'inventory';
                    await processZohoJob(job);
                }, { connection, concurrency: Number(dbJob.formdata?.concurrency) || 1 });

                worker.on('error', (err) => { if (!err.message.includes('lock')) console.error(`⚠️ Error:`, err.message); });
                worker.on('drained', async () => {
                    const check = await db.query("SELECT status FROM jobs WHERE id = $1", [dbJob.id]);
                    if (check.rows.length > 0 && ['paused', 'ended'].includes(check.rows[0].status)) {
                        delete activeProgress[dbJob.profilename]; await worker.close(); delete activeWorkers[queueName]; return;
                    }
                    delete activeProgress[dbJob.profilename];
                    console.log(`   ${cliColors.gray}↳${cliColors.reset} ${cliColors.greenBold}✅ [FINISHED]${cliColors.reset} Account: ${cliColors.whiteBold}${dbJob.profilename}${cliColors.reset}`);
                    await db.query("UPDATE jobs SET status = 'complete' WHERE id = $1", [dbJob.id]);
                    emitToWeb('bulkComplete', { profileName: dbJob.profilename, jobType: dbJob.jobtype });
                    await worker.close(); delete activeWorkers[queueName];
                });

                activeWorkers[queueName] = worker;
            }
        }
    } catch (err) {}
}, 2000);