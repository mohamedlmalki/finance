// --- FILE: server/utils.js ---
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data'); 

const PROFILES_PATH = path.join(__dirname, 'profiles.json');
const SAVES_DIR = path.join(__dirname, 'saves');

if (!fs.existsSync(SAVES_DIR)) {
    try { fs.mkdirSync(SAVES_DIR); } catch (e) { console.error("Could not create saves directory:", e); }
}

const tokenCache = {};

// 🎨 TERMINAL COLOR CODES
const cliColors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    cyanBold: "\x1b[1;36m",
    purple: "\x1b[35m",
    purpleBold: "\x1b[1;35m",
    yellow: "\x1b[33m",
    yellowBold: "\x1b[1;33m",
    green: "\x1b[32m",
    greenBold: "\x1b[1;32m",
    red: "\x1b[31m",
    redBold: "\x1b[1;31m",
    gray: "\x1b[90m",
    whiteBold: "\x1b[1;37m",
    bgBlue: "\x1b[44m"
};

const getModuleTheme = (moduleName) => {
    const name = (moduleName || '').toLowerCase();
    if (name.includes('billing')) return { color: cliColors.purple, bold: cliColors.purpleBold, icon: '🟣', label: 'BILLING' };
    if (name.includes('flow')) return { color: cliColors.yellow, bold: cliColors.yellowBold, icon: '⚡', label: 'FLOW' };
    return { color: cliColors.cyan, bold: cliColors.cyanBold, icon: '📦', label: 'INVENTORY' };
};

const readProfiles = () => {
    try { if (fs.existsSync(PROFILES_PATH)) return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')); } 
    catch (error) { console.error('[ERROR] Could not read profiles.json:', error); }
    return [];
};

const writeProfiles = (profiles) => {
    try { fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2)); } 
    catch (error) { console.error('[ERROR] Could not write to profiles.json:', error); }
};

const listSaveFiles = () => {
    try {
        if (!fs.existsSync(SAVES_DIR)) return [];
        const files = fs.readdirSync(SAVES_DIR).filter(file => file.endsWith('.json'));
        return files.sort((a, b) => fs.statSync(path.join(SAVES_DIR, b)).mtime.getTime() - fs.statSync(path.join(SAVES_DIR, a)).mtime.getTime());
    } catch (error) { console.error('[ERROR] Could not list save files:', error); return []; }
};

const readSaveFile = (filename) => {
    try {
        const filePath = path.join(SAVES_DIR, filename);
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        throw new Error("File not found");
    } catch (error) { console.error('[ERROR] Could not read save file:', error); throw error; }
};

const writeSaveFile = (filename, state) => {
    try {
        let safeFilename = filename;
        if (!safeFilename.endsWith('.json')) safeFilename += '.json';
        const filePath = path.join(SAVES_DIR, safeFilename);
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
        return safeFilename;
    } catch (error) { console.error('[ERROR] Could not write save file:', error); throw error; }
};

const parseError = (error) => {
    let message = 'An unknown error occurred';
    let details = null;
    let code = null;

    if (error.response) {
        code = error.response.status;
        const data = error.response.data;
        if (data && data.message) {
            message = data.message;
            if (data.code) details = `Code: ${data.code}`;
        } else if (typeof data === 'string') { message = data; }
        else { message = `API Error: ${error.response.statusText}`; details = JSON.stringify(data); }
    } else if (error.request) { message = 'No response received from Zoho API'; }
    else { message = error.message; }

    return { message, details, code };
};

const getValidAccessToken = async (profile, service = 'inventory') => {
    const { clientId, clientSecret, refreshToken } = profile;
    if (!clientId || !clientSecret || !refreshToken) throw new Error("Missing API credentials in profile.");

    const cacheKey = refreshToken; 

    if (tokenCache[cacheKey] && tokenCache[cacheKey].expiresAt > Date.now()) {
        return tokenCache[cacheKey].token;
    }

    try {
        const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }
        });
        if (response.data.error) throw new Error(response.data.error);
        const { access_token } = response.data;
        
        tokenCache[cacheKey] = { token: access_token, expiresAt: Date.now() + 3500000 }; 
        return access_token;
    } catch (error) {
        console.error(`[OAuth Error] Failed to get access token:`, error.response?.data || error.message);
        throw new Error("Failed to generate Access Token. Please check your credentials.");
    }
};

const makeApiCall = async (method, endpoint, data, profile, service = 'inventory', headers = {}, params = {}) => {
    const accessToken = await getValidAccessToken(profile, service);
    let baseUrl = 'https://www.zohoapis.com/inventory/v1';
    let defaultParams = { organization_id: profile.inventory?.orgId };

    if (service === 'books') {
        baseUrl = 'https://www.zohoapis.com/books/v3';
        defaultParams = { organization_id: profile.books?.orgId };
    } else if (service === 'billing') {
        baseUrl = 'https://www.zohoapis.com/billing/v1';
        defaultParams = { organization_id: profile.billing?.orgId };
    } else if (service === 'expense') {
        baseUrl = 'https://www.zohoapis.com/expense/v1';
        defaultParams = { organization_id: profile.expense?.orgId };
    }

    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
    
    let isFormData = false;
    let requestData = data;

    if (data instanceof FormData) {
        isFormData = true;
        headers = { ...headers, ...data.getHeaders() };
    }

    const config = {
        method, url, data: requestData,
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, ...headers },
        params: { ...defaultParams, ...params }
    };

    if (isFormData) config.maxBodyLength = Infinity;

    return axios(config);
};

const createJobId = (socketId, profileName, jobType) => `${socketId}_${profileName}_${jobType}`;

// 🚀 BEAUTIFUL ASCII DASHBOARD RENDERER
const logFrontendIntention = (moduleName, data) => {
    if (!data) return;
    const { selectedProfileName, activeProfile } = data;
    const sourceName = selectedProfileName || (activeProfile ? activeProfile.profileName : 'Master Batch');
    
    const theme = getModuleTheme(moduleName);
    
    let extracted = {};
    Object.keys(data).forEach(key => {
        if (key === 'selectedProfileName' || key === 'activeProfile' || key === 'socketId' || key === 'moduleApiName' || key === 'isSearchRequest' || key === 'isExportRequest') return;
        
        const val = data[key];
        const cleanKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        
        if (Array.isArray(val)) {
            if (val.length === 0) extracted[cleanKey] = '[Empty]';
            else if (val.length === 1) extracted[cleanKey] = val[0];
            else if (val.length <= 3) extracted[cleanKey] = val.join(', ');
            else extracted[cleanKey] = `${val[0]}, ${val[1]} ...[+${val.length - 2} more]`;
        } else if (typeof val === 'string') {
            if (val.includes('\n')) {
                const lines = val.split('\n').filter(e => e.trim() !== '');
                extracted[cleanKey] = `[${lines.length} items]`;
            } else {
                let cleanStr = val.replace(/<[^>]*>?/gm, '').trim(); 
                extracted[cleanKey] = cleanStr.length > 55 ? cleanStr.substring(0, 55) + '...' : cleanStr;
            }
        } else if (typeof val !== 'object') {
            extracted[cleanKey] = String(val);
        }
    });

    if (Object.keys(extracted).length === 0) return;

    const width = 65;
    let box = `\n${theme.bold}╭${'─'.repeat(width)}${cliColors.reset}\n`;
    box += `${theme.bold}│${cliColors.reset} ${theme.icon} ${cliColors.whiteBold}INITIATING JOB: ${theme.label} (${moduleName})${cliColors.reset}\n`;
    box += `${theme.bold}├${'─'.repeat(width)}${cliColors.reset}\n`;
    box += `${theme.bold}│${cliColors.reset} 👤 ${cliColors.gray}${'Profile'.padEnd(16, ' ')}:${cliColors.reset} ${cliColors.whiteBold}${sourceName}${cliColors.reset}\n`;
    
    Object.keys(extracted).forEach(key => {
        let icon = '▪️ ';
        if (key.includes('Data') || key.includes('Field')) icon = '🗃️ ';
        else if (key.includes('Delay') || key.includes('Time')) icon = '⏱️ ';
        else if (key.includes('Concurrency') || key.includes('Speed')) icon = '⚡';
        else if (key.includes('Url') || key.includes('Webhook')) icon = '🔗';
        else if (key.includes('Tracking')) icon = '🎯';
        
        box += `${theme.bold}│${cliColors.reset} ${icon} ${cliColors.gray}${key.padEnd(16, ' ')}:${cliColors.reset} ${extracted[key]}\n`;
    });

    box += `${theme.bold}╰${'─'.repeat(width)}${cliColors.reset}\n`;
    console.log(box);
};

module.exports = {
    readProfiles, writeProfiles, parseError, getValidAccessToken, makeApiCall, createJobId,
    writeSaveFile, readSaveFile, listSaveFiles, logFrontendIntention, cliColors, getModuleTheme
};