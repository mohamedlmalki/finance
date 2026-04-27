// --- FILE: server/inventory-handler.js ---
const { makeApiCall, parseError, createJobId, readProfiles } = require('./utils');
const { Queue, Worker } = require('bullmq');
const { connection, getIo } = require('./worker'); 

// Safely require database
let db;
try { db = require('./database'); } catch(e) { console.error("Database module missing."); }

let activeJobs = {};
let activeWorkers = {};

const setActiveJobs = (jobsObject) => { activeJobs = jobsObject; };

const setupInvoiceWorker = (profileName, queueName) => {
    if (activeWorkers[queueName]) return activeWorkers[queueName];

    const worker = new Worker(queueName, async (job) => {
        // ⏱️ START THE STOPWATCH
        const jobStartTime = Date.now();
        const { email, subject, body, delay, selectedProfileName, sendCustomEmail, sendDefaultEmail, customEmailMethod, activeProfile, jobId, rowNumber } = job.data;
        
        try {
            const contactName = email.split('@')[0];
            let contactId;
            let contactPersonIds = [];

            const searchResponse = await makeApiCall('get', `/v1/contacts?email=${encodeURIComponent(email)}`, null, activeProfile, 'inventory');
            if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
                contactId = searchResponse.data.contacts[0].contact_id;
            } else {
                const newContactData = { contact_name: contactName, contact_persons: [{ email: email, is_primary_contact: true }] };
                const createResponse = await makeApiCall('post', '/v1/contacts', newContactData, activeProfile, 'inventory');
                contactId = createResponse.data.contact.contact_id;
            }
            
            const contactDetailsResponse = await makeApiCall('get', `/v1/contacts/${contactId}`, null, activeProfile, 'inventory');
            const contact = contactDetailsResponse.data.contact;
            contactPersonIds = contact.contact_persons.map(p => p.contact_person_id);

            const invoiceData = { customer_id: contactId, contact_persons_associated: contactPersonIds.map(id => ({ contact_person_id: id })), line_items: [{ name: "Default Service", rate: 100.00, quantity: 1 }], notes: body, terms: subject };

            if (sendDefaultEmail) { invoiceData.custom_subject = subject; invoiceData.custom_body = body; }
            
            const invoiceUrl = `/v1/invoices${sendDefaultEmail ? '?send=true' : ''}`;
            const invoiceResponse = await makeApiCall('post', invoiceUrl, invoiceData, activeProfile, 'inventory');
            const invoiceId = invoiceResponse.data.invoice.invoice_id;
            const invoiceNumber = invoiceResponse.data.invoice.invoice_number;

            let finalDetails = `Invoice #${invoiceNumber} created.`;

            if (sendCustomEmail) {
                if (delay > 0) await new Promise(res => setTimeout(res, delay * 1000));
                if (customEmailMethod === 'contact') {
                    try { await makeApiCall('post', `/v1/invoices/${invoiceId}/status/sent`, null, activeProfile, 'inventory'); } catch(e) {}
                    await makeApiCall('post', `/v1/contacts/${contactId}/email`, { to_mail_ids: [email], subject, body }, activeProfile, 'inventory');
                    finalDetails += ` Custom Email (Contact) sent.`;
                } else {
                    await makeApiCall('post', `/v1/invoices/${invoiceId}/email`, { send_from_org_email_id: false, to_mail_ids: [email], subject, body, send_attachment: false }, activeProfile, 'inventory', { send_attachment: false });
                    finalDetails += ` Custom Email (Invoice) sent.`;
                }
            } else if (sendDefaultEmail) {
                finalDetails += ` Default email sent.`;
            }

            // ⏳ Apply standard delay BEFORE ending the clock
            if (!sendCustomEmail && delay > 0) await new Promise(res => setTimeout(res, delay * 1000));
            
            // 🛑 STOP THE STOPWATCH
            const duration = ((Date.now() - jobStartTime) / 1000).toFixed(1) + 's';

            if (db) {
                await db.insertJobResult(jobId, { email, success: true, recordNumber: invoiceNumber, details: finalDetails, fullResponse: invoiceResponse.data, profileName: selectedProfileName, time: duration });
                await db.updateJobProgress(jobId, 'running', 0);
            }

            const io = getIo();
            if (io) {
                io.emit('invoiceResult', {
                    rowNumber, email, stage: 'complete', success: true, details: finalDetails, 
                    invoiceNumber, profileName: selectedProfileName, invoiceResponse: { success: true, fullResponse: invoiceResponse.data },
                    duration, time: duration
                });
            }

            return { success: true, email, details: finalDetails, duration };

        } catch (error) {
            if (delay > 0) await new Promise(res => setTimeout(res, delay * 1000));
            const duration = ((Date.now() - jobStartTime) / 1000).toFixed(1) + 's';

            const { message, fullResponse } = parseError(error);
            const errorDetails = `Error: ${message}`;
            
            if (db) {
                await db.insertJobResult(jobId, { email, success: false, details: errorDetails, fullResponse, profileName: selectedProfileName, time: duration });
                const currentJob = await db.getJobById(jobId);
                const fails = (currentJob?.consecutiveFailures || 0) + 1;
                
                if (currentJob && currentJob.stopAfterFailures > 0 && fails >= currentJob.stopAfterFailures) {
                    await db.updateJobProgress(jobId, 'paused', fails);
                } else { await db.updateJobProgress(jobId, currentJob?.status || 'running', fails); }
            }

            const io = getIo();
            if (io) {
                io.emit('invoiceResult', {
                    rowNumber, email, stage: 'complete', success: false, details: errorDetails, 
                    fullResponse, profileName: selectedProfileName, duration, time: duration
                });
            }
            throw new Error(errorDetails);
        }
    }, { connection, concurrency: 1 });

    activeWorkers[queueName] = worker;
    return worker;
};

// --- HANDLERS ---
const handleStartBulkInvoice = async (socket, data) => {
    const { emails, subject, body, delay, selectedProfileName, activeProfile, sendCustomEmail, sendDefaultEmail, customEmailMethod = 'invoice', stopAfterFailures = 0 } = data;
    const jobId = createJobId(socket.id, selectedProfileName, 'invoice');

    try {
        if (!activeProfile || !activeProfile.inventory) throw new Error('Inventory profile configuration is missing.');

        if (db) {
            await db.upsertJob({ id: jobId, profileName: selectedProfileName, jobType: 'invoice', status: 'running', totalToProcess: emails.length, consecutiveFailures: 0, stopAfterFailures: Number(stopAfterFailures), formData: data, processingStartTime: new Date() });
        }

        const queueName = `invoiceQueue_${selectedProfileName}`;
        const myQueue = new Queue(queueName, { connection });
        await myQueue.drain(true).catch(() => {});
        
        setupInvoiceWorker(selectedProfileName, queueName);

        const jobs = emails.map((email, index) => {
            return {
                name: 'processInvoice',
                data: { email, subject, body, delay, selectedProfileName, sendCustomEmail, sendDefaultEmail, customEmailMethod, activeProfile, jobId, rowNumber: index + 1 }, // Passed rowNumber here
                opts: { removeOnComplete: true, removeOnFail: true } 
            };
        });

        await myQueue.addBulk(jobs);
        socket.emit('jobStarted', { profileName: selectedProfileName, jobType: 'invoice' });

    } catch (error) { socket.emit('bulkError', { message: error.message || 'Server error', profileName: selectedProfileName, jobType: 'invoice' }); }
};

const handleGetOrgDetails = async (socket, data) => {
    try {
        const { activeProfile } = data;
        if (!activeProfile || !activeProfile.inventory || !activeProfile.inventory.orgId) throw new Error('Inventory profile or orgId not configured.');
        const orgId = activeProfile.inventory.orgId;
        const response = await makeApiCall('get', `/v1/organizations/${orgId}`, null, activeProfile, 'inventory');
        if (response.data && response.data.organization) socket.emit('orgDetailsResult', { success: true, data: response.data.organization });
        else throw new Error('Organization not found for this profile.');
    } catch (error) { socket.emit('orgDetailsResult', { success: false, error: parseError(error).message }); }
};

const handleUpdateOrgDetails = async (socket, data) => {
    try {
        const { displayName, activeProfile } = data;
        if (!activeProfile || !activeProfile.inventory || !activeProfile.inventory.orgId) throw new Error('Inventory profile or orgId not configured.');
        
        const orgId = activeProfile.inventory.orgId;
        const getResponse = await makeApiCall('get', `/v1/organizations/${orgId}`, null, activeProfile, 'inventory');
        const organization = getResponse.data.organization;
        if (!organization) throw new Error("Could not find the organization to update.");

        const monthMap = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
        
        const updateData = { name: organization.name, contact_name: displayName, email: organization.email, is_logo_uploaded: organization.is_logo_uploaded, fiscal_year_start_month: monthMap[organization.fiscal_year_start_month], time_zone: organization.time_zone, language_code: organization.language_code, date_format: organization.date_format, field_separator: organization.field_separator, org_address: organization.org_address, remit_to_address: organization.remit_to_address, phone: organization.phone, fax: organization.fax, website: organization.website, currency_id: organization.currency_id, companyid_label: organization.company_id_label, companyid_value: organization.company_id_value, taxid_label: organization.tax_id_label, taxid_value: organization.tax_id_value, address: { street_address1: organization.address?.street_address1 || "", street_address2: organization.address?.street_address2 || "", city: organization.address?.city || "", state: organization.address?.state || "", country: organization.address?.country || "", zip: organization.address?.zip || "" }, custom_fields: organization.custom_fields || [] };
        
        const response = await makeApiCall('put', `/v1/organizations/${orgId}`, updateData, activeProfile, 'inventory');
        
        if (response.data && response.data.organization) {
            const updatedOrganization = response.data.organization;
            if (updatedOrganization.contact_name === displayName) socket.emit('updateOrgDetailsResult', { success: true, data: updatedOrganization });
            else socket.emit('updateOrgDetailsResult', { success: false, error: 'API reported success, but the name was not updated. This may be a permissions issue.', fullResponse: response.data });
        } else throw new Error('Invalid response structure from Zoho API after update.');

    } catch (error) { const { message, fullResponse } = parseError(error); socket.emit('updateOrgDetailsResult', { success: false, error: message, fullResponse }); }
};

const handleSendSingleInvoice = async (data) => {
    const { email, subject, body, selectedProfileName, sendCustomEmail, sendDefaultEmail, customEmailMethod = 'invoice' } = data;
    if (!email || !subject || !body || !selectedProfileName) return { success: false, error: 'Missing required fields.' };
    
    const profiles = readProfiles(); const activeProfile = profiles.find(p => p.profileName === selectedProfileName);
    if (!activeProfile || !activeProfile.inventory) return { success: false, error: 'Inventory profile not configured.' };

    let fullResponse = {};
    try {
        const searchResponse = await makeApiCall('get', `/v1/contacts?email=${encodeURIComponent(email)}`, null, activeProfile, 'inventory');
        let contactId, contactPersonIds = [];
        if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) { contactId = searchResponse.data.contacts[0].contact_id; fullResponse.contact = { status: 'found', data: searchResponse.data }; } 
        else { const newContactData = { contact_name: email.split('@')[0], contact_persons: [{ email: email, is_primary_contact: true }] }; const createResponse = await makeApiCall('post', '/v1/contacts', newContactData, activeProfile, 'inventory'); contactId = createResponse.data.contact.contact_id; fullResponse.contact = { status: 'created', data: createResponse.data }; }
        
        const contactDetailsResponse = await makeApiCall('get', `/v1/contacts/${contactId}`, null, activeProfile, 'inventory');
        const contact = contactDetailsResponse.data.contact;
        if (Array.isArray(contact.contact_persons) && contact.contact_persons.length > 0) contactPersonIds = contact.contact_persons.map(p => p.contact_person_id);
        else throw new Error('Could not find a contact person for the contact.');

        const invoiceData = { customer_id: contactId, contact_persons_associated: contactPersonIds.map(id => ({ contact_person_id: id })), line_items: [{ name: "Service", description: "General service provided", rate: 0.00, quantity: 1 }], notes: body, terms: subject };
        if (sendDefaultEmail) { invoiceData.custom_subject = subject; invoiceData.custom_body = body; }

        const invoiceResponse = await makeApiCall('post', `/v1/invoices${sendDefaultEmail ? '?send=true' : ''}`, invoiceData, activeProfile, 'inventory');
        const invoiceId = invoiceResponse.data.invoice.invoice_id; const invoiceNumber = invoiceResponse.data.invoice.invoice_number; fullResponse.invoice = invoiceResponse.data;
        
        if (sendDefaultEmail) {
             const apiMessage = invoiceResponse.data.message || "";
             if (apiMessage.includes("error while sending the invoice")) return { success: false, message: "Invoice created but Error Sending Email: " + apiMessage, fullResponse: fullResponse };
             if (invoiceResponse.data.invoice?.is_emailed === false) return { success: false, message: "Invoice created but EMAIL FAILED (Daily Limit likely reached or email disabled).", fullResponse: fullResponse };
        }
        
        if (sendCustomEmail) {
            if (customEmailMethod === 'contact') {
                try { await makeApiCall('post', `/v1/invoices/${invoiceId}/status/sent`, null, activeProfile, 'inventory'); } catch(e) {}
                const emailApiResponse = await makeApiCall('post', `/v1/contacts/${contactId}/email`, { to_mail_ids: [email], subject: subject, body: `${body} <br><br>Invoice Number: ${invoiceNumber}` }, activeProfile, 'inventory');
                fullResponse.email = emailApiResponse.data;
            } else {
                const emailApiResponse = await makeApiCall('post', `/v1/invoices/${invoiceId}/email`, { send_from_org_email_id: false, to_mail_ids: [email], subject: subject, body: `${body} <br><br>Invoice Number: ${invoiceNumber}`, send_attachment: false }, activeProfile, 'inventory', { send_attachment: false, send_customer_statement: false });
                fullResponse.email = emailApiResponse.data;
            }
        }
        const message = sendDefaultEmail ? `Invoice ${invoiceNumber} created and default email sent.` : sendCustomEmail ? `Invoice ${invoiceNumber} created and custom email sent (${customEmailMethod}).` : `Invoice ${invoiceNumber} created without sending email.`;
        return { success: true, message, fullResponse: fullResponse };
    } catch (error) { const { message, fullResponse: errorResponse } = parseError(error); fullResponse.error = errorResponse; return { success: false, error: message, fullResponse: fullResponse }; }
};

const handleGetInvoices = async (socket, data) => {
    try {
        const { activeProfile, status, search_text, page, per_page } = data;
        if (!activeProfile || !activeProfile.inventory) throw new Error('Inventory profile not found for fetching invoices.');
        let url = `/v1/invoices?page=${page}&per_page=${per_page}&`; if (status) url += `status=${status}&`; if (search_text) url += `search_text=${search_text}&`;
        const response = await makeApiCall('get', url, null, activeProfile, 'inventory');
        const enrichedInvoices = await Promise.all(response.data.invoices.map(async (invoice) => {
            if (invoice.customer_id) { try { const contactResponse = await makeApiCall('get', `/v1/contacts/${invoice.customer_id}`, null, activeProfile, 'inventory'); return { ...invoice, email: contactResponse.data.contact.email }; } catch (error) { return invoice; } } return invoice;
        }));
        socket.emit('invoicesResult', { success: true, invoices: enrichedInvoices, page_context: response.data.page_context });
    } catch (error) { socket.emit('invoicesResult', { success: false, error: parseError(error).message }); }
};

const handleDeleteInvoices = async (socket, data) => {
    try {
        const { activeProfile, invoiceIds } = data;
        if (!activeProfile || !activeProfile.inventory) throw new Error('Inventory profile not found for deleting invoices.');
        if (!invoiceIds || invoiceIds.length === 0) throw new Error('No invoices selected for deletion.');
        let deletedCount = 0;
        for (const invoiceId of invoiceIds) { await makeApiCall('delete', `/v1/invoices/${invoiceId}`, null, activeProfile, 'inventory'); deletedCount++; socket.emit('invoiceDeleteProgress', { deletedCount, total: invoiceIds.length }); }
        socket.emit('invoicesDeletedResult', { success: true, deletedCount: invoiceIds.length });
    } catch (error) { socket.emit('invoicesDeletedResult', { success: false, error: parseError(error).message }); }
};

module.exports = { setActiveJobs, handleStartBulkInvoice, handleGetOrgDetails, handleUpdateOrgDetails, handleSendSingleInvoice, handleGetInvoices, handleDeleteInvoices };