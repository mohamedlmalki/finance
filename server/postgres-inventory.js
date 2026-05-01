// --- FILE: server/postgres-inventory.js ---
const { Pool } = require('pg');

// Connect to the ISOLATED INVENTORY PostgreSQL database
const pool = new Pool({
    user: process.env.PG_USER || 'postgres',
    host: process.env.PG_HOST || 'localhost',
    database: process.env.PG_INVENTORY_DB || 'zoho_inventory', // 👈 THE ISOLATION KEY
    password: process.env.PG_PASSWORD || 'admin',
    port: process.env.PG_PORT || 5432,
    max: 20,
});

const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS jobs (
                id VARCHAR PRIMARY KEY,
                profileName VARCHAR NOT NULL,
                jobType VARCHAR NOT NULL,
                status VARCHAR NOT NULL,
                totalToProcess INTEGER DEFAULT 0,
                consecutiveFailures INTEGER DEFAULT 0,
                stopAfterFailures INTEGER DEFAULT 0,
                processingTime INTEGER DEFAULT 0,
                processingStartTime TIMESTAMP,
                formData JSONB,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS job_results (
                id SERIAL PRIMARY KEY,
                jobId VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                rowNumber INTEGER,
                identifier VARCHAR,
                success BOOLEAN,
                recordNumber VARCHAR,
                details TEXT,
                fullResponse JSONB,
                profileName VARCHAR,
                time VARCHAR,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("cyanBold", "🔵 Inventory PostgreSQL Database Initialized.");
    } catch (err) {
        console.error("❌ [DB ERROR] Failed to initialize Inventory PostgreSQL:", err.message);
    }
};

initDB();

module.exports = {
    query: (text, params) => pool.query(text, params),

    upsertJob: async (job) => {
        const formDataStr = JSON.stringify(job.formData || {});
        const query = `
            INSERT INTO jobs (id, profileName, jobType, status, totalToProcess, consecutiveFailures, stopAfterFailures, formData, processingStartTime) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            ON CONFLICT (id) DO UPDATE SET 
            status = EXCLUDED.status, totalToProcess = EXCLUDED.totalToProcess, 
            consecutiveFailures = EXCLUDED.consecutiveFailures, formData = EXCLUDED.formData, 
            processingStartTime = COALESCE(EXCLUDED.processingStartTime, jobs.processingStartTime)
        `;
        await pool.query(query, [job.id, job.profileName, job.jobType, job.status, job.totalToProcess, job.consecutiveFailures, job.stopAfterFailures, formDataStr, job.processingStartTime]);
    },

    insertJobResult: async (jobId, result) => {
        const details = result.details || result.error || null;
        const success = result.success === null ? null : (result.success ? true : false);
        const fullResponseStr = result.fullResponse ? JSON.stringify(result.fullResponse) : null;
        const identifier = result.email || result.identifier || null;

        const query = `
            INSERT INTO job_results (jobId, rowNumber, identifier, success, recordNumber, details, fullResponse, profileName, time) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        await pool.query(query, [jobId, result.rowNumber || 0, identifier, success, result.recordNumber || null, details, fullResponseStr, result.profileName || null, result.time || null]);
    },

    updateJobResult: async (jobId, rowNumber, success, details) => {
        const query = `
            UPDATE job_results 
            SET success = $1, details = $2, timestamp = CURRENT_TIMESTAMP
            WHERE jobId = $3 AND rowNumber = $4
        `;
        await pool.query(query, [success, details, jobId, rowNumber]);
    },

    getAllJobs: async () => {
        // 🚨 THE REFRESH FIX FOR INVENTORY
        const { rows } = await pool.query(`
            SELECT j.*, 
            (SELECT COUNT(*) FROM job_results WHERE jobId = j.id AND success IS NOT NULL) as "processedCount",
            (SELECT COUNT(*) FROM job_results WHERE jobId = j.id AND success = true) as "successCount",
            (SELECT COUNT(*) FROM job_results WHERE jobId = j.id AND success = false) as "errorCount",
            COALESCE((
                SELECT json_agg(
                    json_build_object(
                        'rowNumber', r.rownumber,
                        'identifier', r.identifier,
                        'success', r.success,
                        'details', r.details,
                        'time', r.time,
                        'timestamp', r.timestamp,
                        'stage', 'complete'
                    )
                )
                FROM (
                    SELECT rownumber, identifier, success, details, time, timestamp 
                    FROM job_results 
                    WHERE jobid = j.id 
                    ORDER BY timestamp DESC 
                    LIMIT 500
                ) r
            ), '[]'::json) as results
            FROM jobs j
        `);
        return rows;
    },

    deleteAllJobsByType: async (jobType) => {
        const { rowCount } = await pool.query('DELETE FROM jobs WHERE jobType = $1', [jobType]);
        return { affectedRows: rowCount };
    }
};