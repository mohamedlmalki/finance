// --- FILE: server/database.js ---
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'zoho_finance_jobs.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

try {
    db.prepare(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, profileName TEXT NOT NULL, jobType TEXT NOT NULL, status TEXT NOT NULL, totalToProcess INTEGER DEFAULT 0, consecutiveFailures INTEGER DEFAULT 0, stopAfterFailures INTEGER DEFAULT 0, processingTime INTEGER DEFAULT 0, processingStartTime TEXT, formData TEXT, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)`).run();
    db.prepare(`CREATE TABLE IF NOT EXISTS job_results (id INTEGER PRIMARY KEY AUTOINCREMENT, jobId TEXT NOT NULL, rowNumber INTEGER, identifier TEXT, success INTEGER, recordNumber TEXT, details TEXT, fullResponse TEXT, profileName TEXT, time TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(jobId) REFERENCES jobs(id) ON DELETE CASCADE)`).run();
    try { db.prepare('ALTER TABLE job_results ADD COLUMN rowNumber INTEGER').run(); } catch(e) {}
} catch (err) { console.error(`[DB ERROR] Failed to initialize SQLite. Error: ${err.message}`); }

// ==========================================
// 🚀 ENTERPRISE RAM BUCKETS & SWEEPER
// ==========================================
let resultsBucket = [];
let progressBucket = new Map(); // Uses Map so we only write the LATEST progress per job
let isFlushing = false;

const forceFlush = () => {
    if (resultsBucket.length === 0 && progressBucket.size === 0) return;
    if (isFlushing) return;
    isFlushing = true;

    try {
        const insertStmt = db.prepare(`INSERT INTO job_results (jobId, rowNumber, identifier, success, recordNumber, details, fullResponse, profileName, time, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const updateStmt = db.prepare(`UPDATE jobs SET status = ?, consecutiveFailures = ? WHERE id = ?`);

        // SQLite Transaction: Writes massive amounts of data in a single flash
        const performBatch = db.transaction((results, progressMap) => {
            for (const r of results) {
                insertStmt.run(r.jobId, r.rowNumber, r.identifier, r.successInt, r.recordNumber, r.details, r.fullResponseStr, r.profileName, r.time, r.timestamp);
            }
            for (const [id, p] of progressMap.entries()) {
                updateStmt.run(p.status, p.consecutiveFailures, id);
            }
        });

        const currentResults = [...resultsBucket];
        const currentProgress = new Map(progressBucket);

        performBatch(currentResults, currentProgress);

        // Wipe the buckets clean to free up RAM
        resultsBucket.splice(0, currentResults.length);
        currentProgress.forEach((_, key) => progressBucket.delete(key));

    } catch (err) {
        console.error("[DB BATCH FLUSH ERROR]", err);
    } finally {
        isFlushing = false;
    }
};

// The Sweeper: Wakes up every 2 seconds to dump the bucket
setInterval(forceFlush, 2000);
// ==========================================

module.exports = {
    forceFlush, // 🚨 Exported so index.js can trigger it manually

    upsertJob: async (job) => {
        const formDataStr = JSON.stringify(job.formData || {});
        const processingStartTime = job.processingStartTime ? new Date(job.processingStartTime).toISOString().slice(0, 19).replace('T', ' ') : null;
        const stmt = db.prepare(`INSERT INTO jobs (id, profileName, jobType, status, totalToProcess, consecutiveFailures, stopAfterFailures, formData, processingStartTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, totalToProcess = excluded.totalToProcess, consecutiveFailures = excluded.consecutiveFailures, stopAfterFailures = excluded.stopAfterFailures, formData = excluded.formData, processingStartTime = COALESCE(excluded.processingStartTime, jobs.processingStartTime)`);
        stmt.run(job.id, job.profileName, job.jobType, job.status, job.totalToProcess, job.consecutiveFailures, job.stopAfterFailures, formDataStr, processingStartTime);
    },

    updateJobProgress: async (id, status, consecutiveFailures) => {
        // 🚨 Tossing data into RAM Bucket instead of writing to Hard Drive
        progressBucket.set(id, { status, consecutiveFailures });
    },

    insertJobResult: async (jobId, result) => {
        let details = result.details || result.error || null;
        let successInt = result.success ? 1 : 0;
        let fullResponseStr = result.fullResponse ? JSON.stringify(result.fullResponse) : null;
        let timestamp = result.timestamp ? new Date(result.timestamp).toISOString() : new Date().toISOString();
        let identifier = result.email || result.identifier || null;

        // 🚨 Tossing data into RAM Bucket
        resultsBucket.push({
            jobId, rowNumber: result.rowNumber || 0, identifier, successInt, 
            recordNumber: result.recordNumber || result.invoiceNumber || null, 
            details, fullResponseStr, profileName: result.profileName || null, 
            time: result.time || null, timestamp
        });

        // Hard Limit Safety Valve: If the bucket hits 500 before the 2-second timer, force dump it to protect RAM
        if (resultsBucket.length > 500) forceFlush();
    },

    updateJobStatusByProfile: async (profileName, jobType, status) => {
        forceFlush(); // Ensure pending jobs are saved before blind updating
        db.prepare(`UPDATE jobs SET status = ? WHERE profileName = ? AND jobType = ? AND status != 'ended' AND status != 'complete'`).run(status, profileName, jobType);
    },

    getJobById: async (id) => {
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        if (!job) return null;
        try { job.formData = JSON.parse(job.formData); } catch(e) { job.formData = {}; }
        const results = db.prepare('SELECT * FROM job_results WHERE jobId = ? ORDER BY id ASC').all(id);
        job.results = results.map(r => ({ ...r, email: r.identifier, success: r.success === 1, fullResponse: r.fullResponse ? JSON.parse(r.fullResponse) : null, error: r.success === 0 ? r.details : undefined }));
        return job;
    },

    getAllJobs: async () => {
        const jobs = db.prepare('SELECT * FROM jobs').all();
        return jobs.map(row => {
            let currentProcessingTime = row.processingTime || 0;
            if ((row.status === 'running' || row.status === 'paused') && row.processingStartTime) {
                const startTimestamp = new Date(row.processingStartTime + 'Z').getTime(); 
                currentProcessingTime += Math.floor((Date.now() - startTimestamp) / 1000);
            }
            const processedCount = db.prepare('SELECT COUNT(*) as count FROM job_results WHERE jobId = ?').get(row.id).count;
            const successCount = db.prepare('SELECT COUNT(*) as count FROM job_results WHERE jobId = ? AND success = 1').get(row.id).count;
            const errorCount = db.prepare('SELECT COUNT(*) as count FROM job_results WHERE jobId = ? AND success = 0').get(row.id).count;
            const results = db.prepare('SELECT * FROM job_results WHERE jobId = ? ORDER BY id DESC LIMIT 500').all(row.id);

            const safeResults = results.map((r, index) => {
                let parsedResponse = null;
                try { if (r.fullResponse) parsedResponse = JSON.parse(r.fullResponse); } catch(e){}
                const lightweight = { rowNumber: r.rowNumber, email: r.identifier, identifier: r.identifier, success: r.success === 1, recordNumber: r.recordNumber, invoiceNumber: r.recordNumber, details: r.details, profileName: r.profileName, time: r.time, timestamp: r.timestamp };
                if (!lightweight.success) lightweight.error = r.details;
                if (index <= 50) lightweight.fullResponse = parsedResponse; 
                return lightweight;
            });

            return { ...row, processingTime: currentProcessingTime, formData: JSON.parse(row.formData || "{}"), results: safeResults, processedCount, successCount, errorCount };
        });
    },

    deleteJob: async (profileName, jobType) => {
        const info = db.prepare('DELETE FROM jobs WHERE profileName = ? AND jobType = ?').run(profileName, jobType);
        return { affectedRows: info.changes };
    },

    deleteAllJobsByType: async (jobType) => {
        const info = db.prepare('DELETE FROM jobs WHERE jobType = ?').run(jobType);
        return { affectedRows: info.changes };
    },

    // 🚀 NEW: Vacuum command to physically reclaim disk space after massive deletions
    vacuumDatabase: async () => {
        try {
            console.log("🧹 Running Database VACUUM...");
            db.exec('VACUUM');
            console.log("✅ Database VACUUM Complete.");
        } catch (error) {
            console.error("[DB ERROR] Failed to vacuum database:", error);
        }
    },

    searchJobResults: async (profileName, jobType, searchTerm) => {
        forceFlush(); // Ensure latest data is dumped so the user can search it
        const job = db.prepare('SELECT id FROM jobs WHERE profileName = ? AND jobType = ?').get(profileName, jobType);
        if (!job) return [];
        const term = `%${String(searchTerm).trim()}%`;
        const results = db.prepare('SELECT * FROM job_results WHERE jobId = ? AND (identifier LIKE ? OR details LIKE ?) ORDER BY id DESC LIMIT 500').all(job.id, term, term);
        return results.map(r => ({ ...r, rowNumber: r.rowNumber, email: r.identifier, success: r.success === 1, fullResponse: r.fullResponse ? JSON.parse(r.fullResponse) : null, error: r.success === 0 ? r.details : undefined }));
    },

    getFullExport: async (profileName, jobType) => {
        forceFlush(); 
        const job = db.prepare('SELECT id FROM jobs WHERE profileName = ? AND jobType = ?').get(profileName, jobType);
        if (!job) return [];
        const results = db.prepare('SELECT rowNumber, identifier, success, details, time, timestamp FROM job_results WHERE jobId = ? ORDER BY id ASC').all(job.id);
        return results.map(r => ({ ...r, success: r.success === 1 }));
    }
};