// server/billing-handler.js

const { makeApiCall, parseError, createJobId } = require('./utils');

let activeJobs = {};

const setActiveJobs = (jobsObject) => {
  activeJobs = jobsObject;
};

// --- HELPER: SLEEP ---
const interruptibleSleep = (ms, jobId) => {
    return new Promise(resolve => {
        if (ms <= 0) return resolve();
        const interval = 100;
        let elapsed = 0;
        const timerId = setInterval(() => {
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') {
                clearInterval(timerId);
                return resolve();
            }
            elapsed += interval;
            if (elapsed >= ms) {
                clearInterval(timerId);
                resolve();
            }
        }, interval);
    });
};

// --- HELPER: AUTO PAUSE ---
function checkAutoPause(job, profileName, socket, type) {
    if (job && job.stopAfterFailures > 0 && job.consecutiveFailures >= job.stopAfterFailures) {
        if (job.status !== 'paused') {
            job.status = 'paused';
            socket.emit('jobPaused', { 
                profileName: profileName, 
                jobType: type, 
                reason: `Auto-paused after ${job.consecutiveFailures} consecutive failures.` 
            });
        }
    }
}

// ==========================================
// 1. ORGANIZATION DETAILS
// ==========================================

const handleGetOrgDetails = async (socket, data) => {
    try {
        const { activeProfile } = data;
        if (!activeProfile || !activeProfile.billing || !activeProfile.billing.orgId) {
            throw new Error('Billing profile or orgId not configured.');
        }
        const response = await makeApiCall('get', `/organizations/${activeProfile.billing.orgId}`, null, activeProfile, 'billing');
        
        if (response.data && response.data.organization) {
            socket.emit('orgDetailsResult', { success: true, data: response.data.organization });
        } else {
            throw new Error('Organization not found for this profile.');
        }
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('orgDetailsResult', { success: false, error: message });
    }
};

const handleUpdateOrgDetails = async (socket, data) => {
    try {
        const { displayName, activeProfile } = data;
        if (!activeProfile || !activeProfile.billing || !activeProfile.billing.orgId) {
            throw new Error('Billing profile configuration is missing.');
        }
        
        const updateData = { contact_name: displayName };
        const updateResponse = await makeApiCall('put', `/organizations/${activeProfile.billing.orgId}`, updateData, activeProfile, 'billing');
        
        if (updateResponse.data && updateResponse.data.organization) {
            socket.emit('updateOrgDetailsResult', { success: true, data: updateResponse.data.organization });
        } else {
            throw new Error('Invalid response from Billing API.');
        }
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('updateOrgDetailsResult', { success: false, error: message });
    }
};

// ==========================================
// 2. BULK INVOICES (BILLING)
// ==========================================

const handleStartBulkBillingInvoice = async (socket, data) => {
    const { formData, selectedProfileName, activeProfile, processedIds } = data; // <--- Extract processedIds
    const { emails, subject, body, delay, displayName, stopAfterFailures } = formData;

    const jobId = createJobId(socket.id, selectedProfileName, 'billing');
    const delayMs = (Number(delay) || 0) * 1000;
    const failureLimit = Number(stopAfterFailures) || 0;

    activeJobs[jobId] = { status: 'running', consecutiveFailures: 0, stopAfterFailures: failureLimit };
    const processedSet = new Set(processedIds || []); // Resume Logic

    try {
        const emailList = emails.split(/[\n,]+/).map(e => e.trim()).filter(e => e);
        if (emailList.length === 0) throw new Error("No emails provided.");

        for (let i = 0; i < emailList.length; i++) {
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;
            while (activeJobs[jobId]?.status === 'paused') await new Promise(r => setTimeout(r, 500));
            
            const email = emailList[i];
            
            // --- SKIP ALREADY PROCESSED ---
            if (processedSet.has(email)) continue;

            if (i > 0 && delayMs > 0) await interruptibleSleep(delayMs, jobId);
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;

            const rowNumber = i + 1;
            socket.emit('billingInvoiceResult', {
                rowNumber, identifier: email, stage: 'processing', details: 'Processing...', success: false, profileName: selectedProfileName
            });

            try {
                // 1. Check Contact
                let customerId = null;
                const searchRes = await makeApiCall('get', `/customers?email=${encodeURIComponent(email)}`, null, activeProfile, 'billing');
                
                if (searchRes.data.customers && searchRes.data.customers.length > 0) {
                    customerId = searchRes.data.customers[0].customer_id;
                } else {
                    const newCustomer = { 
                        display_name: displayName || email.split('@')[0], 
                        email: email 
                    };
                    const createRes = await makeApiCall('post', '/customers', newCustomer, activeProfile, 'billing');
                    customerId = createRes.data.customer.customer_id;
                }

                // 2. Create Invoice
                const invoiceData = {
                    customer_id: customerId,
                    line_items: [{ name: "Service Charge", rate: 100, quantity: 1 }]
                };
                const invRes = await makeApiCall('post', '/invoices', invoiceData, activeProfile, 'billing');
                const invoiceId = invRes.data.invoice.invoice_id;

                // 3. Email Invoice
                await makeApiCall('post', `/invoices/${invoiceId}/email`, { to_mail_ids: [email], subject, body }, activeProfile, 'billing');

                if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0;

                socket.emit('billingInvoiceResult', {
                    rowNumber, identifier: email, stage: 'complete', success: true, details: 'Sent', response: invRes.data, profileName: selectedProfileName
                });

            } catch (error) {
                const { message, fullResponse } = parseError(error);
                if (activeJobs[jobId]) {
                    activeJobs[jobId].consecutiveFailures++;
                    checkAutoPause(activeJobs[jobId], selectedProfileName, socket, 'billing');
                }
                socket.emit('billingInvoiceResult', {
                    rowNumber, identifier: email, stage: 'complete', success: false, details: message, fullResponse, profileName: selectedProfileName
                });
            }
        }
    } catch (error) {
        socket.emit('bulkError', { message: error.message, profileName: selectedProfileName, jobType: 'billing' });
    } finally {
        if (activeJobs[jobId]) {
             if (activeJobs[jobId].status === 'ended') socket.emit('bulkEnded', { profileName: selectedProfileName, jobType: 'billing' });
            else socket.emit('bulkComplete', { profileName: selectedProfileName, jobType: 'billing' });
            delete activeJobs[jobId];
        }
    }
};

// ==========================================
// 3. BULK CONTACTS (BILLING)
// ==========================================

const handleStartBulkBillingContact = async (socket, data) => {
    const { formData, selectedProfileName, activeProfile, processedIds } = data; // <--- Extract processedIds
    const { emails, displayNames, delay, stopAfterFailures } = formData;

    const jobId = createJobId(socket.id, selectedProfileName, 'billing-contact');
    const delayMs = (Number(delay) || 0) * 1000;
    const failureLimit = Number(stopAfterFailures) || 0;

    activeJobs[jobId] = { status: 'running', consecutiveFailures: 0, stopAfterFailures: failureLimit };
    const processedSet = new Set(processedIds || []); // Resume Logic

    try {
        const emailList = emails.split(/[\n,]+/).map(e => e.trim()).filter(e => e);
        const globalDisplayName = (displayNames || '').trim();

        if (emailList.length === 0) throw new Error("No emails provided.");

        for (let i = 0; i < emailList.length; i++) {
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;
            while (activeJobs[jobId]?.status === 'paused') await new Promise(r => setTimeout(r, 500));
            
            const email = emailList[i];
            
            // --- SKIP ALREADY PROCESSED ---
            if (processedSet.has(email)) continue;

            if (i > 0 && delayMs > 0) await interruptibleSleep(delayMs, jobId);
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;

            const rowNumber = i + 1;
            const finalDisplayName = globalDisplayName || email.split('@')[0];

            socket.emit('billingContactResult', {
                rowNumber, identifier: email, stage: 'processing', details: 'Creating...', success: false, profileName: selectedProfileName
            });

            try {
                // Create New Customer directly
                const newCustomer = {
                    display_name: finalDisplayName, 
                    email: email
                };

                const createRes = await makeApiCall('post', '/customers', newCustomer, activeProfile, 'billing');

                if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0;

                socket.emit('billingContactResult', {
                    rowNumber, identifier: email, stage: 'complete', success: true, details: 'Created', response: createRes.data, profileName: selectedProfileName
                });

            } catch (error) {
                const { message, fullResponse } = parseError(error);
                if (activeJobs[jobId]) {
                    activeJobs[jobId].consecutiveFailures++;
                    checkAutoPause(activeJobs[jobId], selectedProfileName, socket, 'billing-contact');
                }

                socket.emit('billingContactResult', {
                    rowNumber, identifier: email, stage: 'complete', success: false, details: message, fullResponse, profileName: selectedProfileName
                });
            }
        }
    } catch (error) {
        socket.emit('bulkError', { message: error.message, profileName: selectedProfileName, jobType: 'billing-contact' });
    } finally {
        if (activeJobs[jobId]) {
             if (activeJobs[jobId].status === 'ended') socket.emit('bulkEnded', { profileName: selectedProfileName, jobType: 'billing-contact' });
            else socket.emit('bulkComplete', { profileName: selectedProfileName, jobType: 'billing-contact' });
            delete activeJobs[jobId];
        }
    }
};

// ==========================================
// 4. STATICS & MANAGEMENT
// ==========================================

const handleGetInvoices = async (socket, data) => {
    try {
        const { activeProfile, status, search_text } = data;
        if (!activeProfile || !activeProfile.billing) throw new Error('Billing profile not found.');
        
        let allInvoices = [];
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
            let url = `/invoices?page=${page}&per_page=200&`;
            if (status) url += `status=${status}&`;
            if (search_text) url += `search_text=${search_text}&`;

            const response = await makeApiCall('get', url, null, activeProfile, 'billing');
            const invoices = response.data.invoices || [];
            allInvoices = [...allInvoices, ...invoices];
            
            hasMore = response.data.page_context?.has_more_page || false;
            page++;
            if (page > 50) break;
        }

        const uniqueCustomerIds = [...new Set(allInvoices.map(inv => inv.customer_id).filter(Boolean))];
        const emailMap = {};

        const CHUNK_SIZE = 5; 
        for (let i = 0; i < uniqueCustomerIds.length; i += CHUNK_SIZE) {
            const chunk = uniqueCustomerIds.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (customerId) => {
                try {
                    const custRes = await makeApiCall('get', `/customers/${customerId}`, null, activeProfile, 'billing');
                    if (custRes.data.customer) {
                        emailMap[customerId] = custRes.data.customer.email || '';
                    }
                } catch (e) {}
            }));
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        const enrichedInvoices = allInvoices.map(invoice => ({
            ...invoice,
            email: emailMap[invoice.customer_id] || ''
        }));

        socket.emit('billingInvoicesResult', { success: true, invoices: enrichedInvoices });
        
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('billingInvoicesResult', { success: false, error: message });
    }
};

const handleDeleteInvoices = async (socket, data) => {
    try {
        const { activeProfile, invoiceIds } = data;
        if (!activeProfile || !activeProfile.billing) throw new Error('Billing profile not found.');
        
        let deletedCount = 0;
        for (const invoiceId of invoiceIds) {
            await makeApiCall('delete', `/invoices/${invoiceId}`, null, activeProfile, 'billing');
            deletedCount++;
            socket.emit('billingInvoiceDeleteProgress', { deletedCount, total: invoiceIds.length });
        }
        
        socket.emit('billingInvoicesDeletedResult', { success: true, deletedCount: invoiceIds.length });
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('billingInvoicesDeletedResult', { success: false, error: message });
    }
};

module.exports = { 
    setActiveJobs, 
    handleGetOrgDetails,
    handleUpdateOrgDetails,
    handleStartBulkBillingContact,
    handleStartBulkBillingInvoice,
    handleGetInvoices,
    handleDeleteInvoices
};