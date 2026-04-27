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

    // 🚨 THE BUG FIX: Cache tokens by the UNIQUE Refresh Token, NOT the shared Client ID!
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
        
        // 🚨 Save it back to the cache using the Refresh Token
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

const logFrontendIntention = (moduleName, data) => {
    if (!data) return;
    const { selectedProfileName, activeProfile } = data;
    const sourceName = selectedProfileName || (activeProfile ? activeProfile.profileName : 'Unknown Profile');
    
    let extracted = {};
    let summaryParts = [];
    
    Object.keys(data).forEach(key => {
        if (key === 'selectedProfileName' || key === 'activeProfile' || key === 'socketId' || key === 'moduleApiName') return;
        const val = data[key];
        const cleanKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        
        if (Array.isArray(val)) {
            extracted[key] = val;
            if (val.length === 0) summaryParts.push(`${cleanKey}: [Empty]`);
            else if (val.length === 1) summaryParts.push(`${cleanKey}: ${val[0]}`);
            else if (val.length <= 3) summaryParts.push(`${cleanKey}: ${val.join(', ')}`);
            else summaryParts.push(`${cleanKey}: ${val[0]}, ${val[1]} ...[+${val.length - 2} more]`);
        } else if (typeof val === 'string') {
            extracted[key] = val.length > 4000 ? val.substring(0, 4000) + '\n...[Truncated]' : val;
            if (val.includes('\n')) {
                const lines = val.split('\n').filter(e => e.trim() !== '');
                if (lines.length > 1) { summaryParts.push(`${cleanKey}: [${lines.length} items]`); return; }
            }
            let cleanStr = val.replace(/<[^>]*>?/gm, '').trim(); 
            let shortStr = cleanStr.length > 45 ? cleanStr.substring(0, 45) + '...' : cleanStr;
            summaryParts.push(`${cleanKey}: ${shortStr}`);
        } else if (typeof val !== 'object') {
            extracted[key] = val; summaryParts.push(`${cleanKey}: ${val}`);
        }
    });
    
    if (Object.keys(extracted).length === 0) return; 
    const finalSummary = summaryParts.join(' | ');
    const logEntry = { source: sourceName, method: "APP_INPUT", path: "Frontend UI", status: 200, latency: 0, details: `Triggered ${moduleName} -> ${finalSummary}` };
    console.log(JSON.stringify(logEntry));
};

module.exports = {
    readProfiles, writeProfiles, parseError, getValidAccessToken, makeApiCall, createJobId,
    writeSaveFile, readSaveFile, listSaveFiles, logFrontendIntention
};