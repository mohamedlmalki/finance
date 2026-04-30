// server/books-handler.js

const { makeApiCall, parseError, createJobId, readProfiles } = require('./utils');

let activeJobs = {};

const setActiveJobs = (jobsObject) => {
  activeJobs = jobsObject;
};

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

function checkAutoPause(job, profileName, socket) {
    if (job && job.stopAfterFailures > 0 && job.consecutiveFailures >= job.stopAfterFailures) {
        if (job.status !== 'paused') {
            job.status = 'paused';
            console.log(`[JOB PAUSED] ${profileName} - Reason: ${job.consecutiveFailures} consecutive failures.`);
            socket.emit('jobPaused', { 
                profileName: profileName, 
                jobType: 'books', 
                reason: `Auto-paused after ${job.consecutiveFailures} consecutive failures.` 
            });
        }
    }
}

const handleGetOrgDetails = async (socket, data) => {
    try {
        const { activeProfile } = data;
        if (!activeProfile || !activeProfile.books || !activeProfile.books.orgId) {
            throw new Error('Books profile or orgId not configured.');
        }
        const response = await makeApiCall('get', `/organizations/${activeProfile.books.orgId}`, null, activeProfile, 'books');
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
    console.log('\n\x1b[36m%s\x1b[0m', '==================================================');
    console.log('\x1b[36m%s\x1b[0m', '       🔄 START: UPDATE SENDER NAME (BOOKS)       ');
    console.log('\x1b[36m%s\x1b[0m', '==================================================');
    
    try {
        const { displayName, activeProfile } = data;
        
        console.log(`\x1b[33m[1] CONFIGURATION:\x1b[0m`);
        console.log(`   • Profile:  ${activeProfile?.profileName}`);
        console.log(`   • Org ID:   ${activeProfile?.books?.orgId}`);
        console.log(`   • Target Name: "${displayName}"`);

        if (!activeProfile || !activeProfile.books || !activeProfile.books.orgId) {
            throw new Error('Books profile configuration is missing.');
        }
        
        const updateData = { contact_name: displayName };
        
        console.log(`\n\x1b[33m[2] DATA SENT TO ZOHO (PAYLOAD):\x1b[0m`);
        console.log(JSON.stringify(updateData, null, 2));

        console.log(`\n\x1b[33m[3] EXECUTING API CALL...\x1b[0m`);
        const updateResponse = await makeApiCall('put', `/organizations/${activeProfile.books.orgId}`, updateData, activeProfile, 'books');
        
        if (updateResponse.data && updateResponse.data.organization) {
            const updatedOrg = updateResponse.data.organization;
            
            console.log(`\n\x1b[32m[4] SUCCESS! RESPONSE RECEIVED FROM ZOHO:\x1b[0m`);
            console.log('--------------------------------------------------');
            console.log(JSON.stringify(updatedOrg, null, 2));
            console.log('--------------------------------------------------');

            if (updatedOrg.contact_name === displayName) {
                 console.log(`\x1b[32m[✔] VERIFIED: Name successfully changed to "${updatedOrg.contact_name}"\x1b[0m`);
            } else {
                 console.log(`\x1b[31m[⚠] WARNING: API returned success, but name is still "${updatedOrg.contact_name}" (Expected: "${displayName}")\x1b[0m`);
                 console.log(`    This often happens if the account lacks permission to update Organization Settings.`);
            }
            
            socket.emit('updateOrgDetailsResult', { success: true, data: updatedOrg });
        } else {
            console.log('\x1b[31m[ERROR]: Invalid response structure.\x1b[0m');
            throw new Error('Invalid response from Books API.');
        }

    } catch (error) {
        const { message, fullResponse } = parseError(error);
        console.log('\n\x1b[31m[!!!] EXCEPTION OCCURRED:\x1b[0m');
        console.log(`   • Message: ${message}`);
        if (fullResponse) {
            console.log(`   • Full Error Dump:`);
            console.log(JSON.stringify(fullResponse, null, 2));
        }
        socket.emit('updateOrgDetailsResult', { success: false, error: message, fullResponse });
    } finally {
        console.log('\x1b[36m%s\x1b[0m', '==================================================\n');
    }
};

// --- UPDATED: FETCH ALL INVOICES + EMAILS ---
const handleGetInvoices = async (socket, data) => {
    try {
        const { activeProfile, status, search_text } = data;
        if (!activeProfile || !activeProfile.books) {
            throw new Error('Books profile not found.');
        }
        
        let allInvoices = [];
        let page = 1;
        let hasMore = true;
        
        // 1. Fetch ALL Invoices (Pagination Loop)
        while (hasMore) {
            let url = `/invoices?page=${page}&per_page=200&`;
            if (status) url += `status=${status}&`;
            if (search_text) url += `search_text=${search_text}&`;

            const response = await makeApiCall('get', url, null, activeProfile, 'books');
            const invoices = response.data.invoices || [];
            allInvoices = [...allInvoices, ...invoices];
            
            hasMore = response.data.page_context?.has_more_page || false;
            page++;
            // Safety break to prevent infinite loops (approx 10k items)
            if (page > 50) break; 
        }

        // 2. Extract Unique Customer IDs to fetch emails
        const uniqueCustomerIds = [...new Set(allInvoices.map(inv => inv.customer_id).filter(Boolean))];
        const emailMap = {};

        // 3. Fetch Contacts in Chunks (Batch size 5 to avoid Rate Limit)
        const CHUNK_SIZE = 5; 
        for (let i = 0; i < uniqueCustomerIds.length; i += CHUNK_SIZE) {
            const chunk = uniqueCustomerIds.slice(i, i + CHUNK_SIZE);
            
            await Promise.all(chunk.map(async (customerId) => {
                try {
                    const contactRes = await makeApiCall('get', `/contacts/${customerId}`, null, activeProfile, 'books');
                    if (contactRes.data.contact) {
                        emailMap[customerId] = contactRes.data.contact.email || '';
                    }
                } catch (e) {
                    // Ignore individual contact fetch errors to keep the process alive
                }
            }));
            
            // Tiny delay between chunks to be polite to the API
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // 4. Map Emails to Invoices
        const enrichedInvoices = allInvoices.map(invoice => ({
            ...invoice,
            email: emailMap[invoice.customer_id] || ''
        }));

        socket.emit('booksInvoicesResult', { 
            success: true, 
            invoices: enrichedInvoices,
            total_count: enrichedInvoices.length
        });
        
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('booksInvoicesResult', { success: false, error: message });
    }
};

const handleStartBulkInvoice = async (socket, data) => {
    const { 
        emails, subject, body, delay, selectedProfileName, activeProfile, 
        sendCustomEmail, sendDefaultEmail, customEmailMethod = 'invoice',
        stopAfterFailures = 0,
        processedIds // <--- ADDED: To support Resuming/Loading from Save
    } = data;
    
    const jobId = createJobId(socket.id, selectedProfileName, 'books');
    
    const delayMs = (Number(delay) || 0) * 1000;
    const failureLimit = Number(stopAfterFailures) || 0;

    activeJobs[jobId] = { 
        status: 'running',
        consecutiveFailures: 0,
        stopAfterFailures: failureLimit
    };

    // --- CREATE LOOKUP SET FOR RESUMING ---
    const processedSet = new Set(processedIds || []);

    try {
        if (!activeProfile || !activeProfile.books) {
            throw new Error('Books profile configuration is missing.');
        }

        for (let i = 0; i < emails.length; i++) {
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;
            while (activeJobs[jobId]?.status === 'paused') {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            if (i > 0 && delayMs > 0) {
                await interruptibleSleep(delayMs, jobId);
            }
            
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;

            const email = emails[i];
            
            // --- SKIP IF ALREADY PROCESSED ---
            if (processedSet.has(email)) continue;

            const rowNumber = i + 1;
            let contactResponsePayload = {};
            let contactPersonIds = [];
            let rowFailed = false;

            socket.emit('booksInvoiceResult', { rowNumber, email, stage: 'contact', details: 'Searching for contact...', profileName: selectedProfileName });
            
            const contactName = email.split('@')[0];
            let contactId;
            
            try {
                const searchResponse = await makeApiCall('get', `/contacts?email=${encodeURIComponent(email)}`, null, activeProfile, 'books');
                if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
                    contactId = searchResponse.data.contacts[0].contact_id;
                } else {
                    socket.emit('booksInvoiceResult', { rowNumber, email, stage: 'contact', details: 'Creating contact...', profileName: selectedProfileName });
                    const newContactData = { contact_name: contactName, contact_persons: [{ email: email, is_primary_contact: true }] };
                    const createResponse = await makeApiCall('post', '/contacts', newContactData, activeProfile, 'books');
                    contactId = createResponse.data.contact.contact_id;
                }
                
                const contactDetailsResponse = await makeApiCall('get', `/contacts/${contactId}`, null, activeProfile, 'books');
                const contact = contactDetailsResponse.data.contact;
                if (Array.isArray(contact.contact_persons) && contact.contact_persons.length > 0) {
                    contactPersonIds = contact.contact_persons.map(p => p.contact_person_id);
                } else {
                    throw new Error('No contact person found.');
                }
                contactResponsePayload = { success: true, fullResponse: contactDetailsResponse.data };
                socket.emit('booksInvoiceResult', { rowNumber, email, stage: 'invoice', details: 'Creating invoice...', contactResponse: contactResponsePayload, profileName: selectedProfileName });
            
            } catch (contactError) {
                const { message, fullResponse } = parseError(contactError);
                if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures++;
                checkAutoPause(activeJobs[jobId], selectedProfileName, socket);
                
                socket.emit('booksInvoiceResult', { rowNumber, email, stage: 'complete', success: false, details: `Contact Error: ${message}`, contactResponse: { success: false, fullResponse }, profileName: selectedProfileName });
                continue; 
            }

            let invoiceId;
            let invoiceNumber;
            let invoiceResponsePayload;
            
            try {
                const invoiceData = {
                    customer_id: contactId,
                    contact_persons: contactPersonIds, 
                    line_items: [{ name: "Default Service", rate: 100.00, quantity: 1 }],
                    notes: body,
                    terms: subject
                };

                if (sendDefaultEmail) {
                    invoiceData.custom_subject = subject;
                    invoiceData.custom_body = body;
                }
                
                const invoiceUrl = `/invoices${sendDefaultEmail ? '?send=true' : ''}`;
                const invoiceResponse = await makeApiCall('post', invoiceUrl, invoiceData, activeProfile, 'books');
                
                invoiceId = invoiceResponse.data.invoice.invoice_id;
                invoiceNumber = invoiceResponse.data.invoice.invoice_number;
                invoiceResponsePayload = { success: true, fullResponse: invoiceResponse.data };

                if (sendDefaultEmail) {
                     const isEmailed = invoiceResponse.data.invoice?.is_emailed;
                     if (isEmailed === false) {
                        rowFailed = true;
                        if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures++;
                        checkAutoPause(activeJobs[jobId], selectedProfileName, socket);

                        socket.emit('booksInvoiceResult', {
                             rowNumber, email, stage: 'complete', success: false,
                             details: "Invoice created but EMAIL FAILED.",
                             invoiceResponse: invoiceResponsePayload,
                             contactResponse: contactResponsePayload,
                             profileName: selectedProfileName
                         });
                     } else {
                        if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0; 
                        
                        socket.emit('booksInvoiceResult', {
                            rowNumber, email, stage: 'complete', success: true,
                            details: `Invoice created and default email sent.`,
                            invoiceResponse: invoiceResponsePayload,
                            contactResponse: contactResponsePayload,
                            emailResponse: { success: true, fullResponse: { message: "Implicitly sent via Books Invoice API" } },
                            profileName: selectedProfileName
                        });
                     }
                     continue; 
                } else {
                    socket.emit('booksInvoiceResult', {
                        rowNumber, email, stage: 'invoice', details: 'Invoice created. Sending custom email...',
                        invoiceResponse: invoiceResponsePayload,
                        contactResponse: contactResponsePayload,
                        profileName: selectedProfileName
                    });
                }
            } catch (invoiceError) {
                const { message, fullResponse } = parseError(invoiceError);
                
                if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures++;
                checkAutoPause(activeJobs[jobId], selectedProfileName, socket);

                socket.emit('booksInvoiceResult', { rowNumber, email, stage: 'complete', success: false, details: `Invoice Error: ${message}`, invoiceResponse: { success: false, fullResponse }, profileName: selectedProfileName });
                continue; 
            }

            if (sendCustomEmail && !rowFailed) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    if (customEmailMethod === 'contact') {
                        try { await makeApiCall('post', `/invoices/${invoiceId}/status/sent`, null, activeProfile, 'books'); } catch(e) {}
                        const emailData = { to_mail_ids: [email], subject: subject, body: body };
                        const emailApiUrl = `/contacts/${contactId}/email`;
                        const emailApiResponse = await makeApiCall('post', emailApiUrl, emailData, activeProfile, 'books');
                        
                        if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0; 

                        socket.emit('booksInvoiceResult', {
                            rowNumber, email, stage: 'complete', success: true,
                            details: `Custom email sent (Contact API).`,
                            invoiceNumber: invoiceNumber,
                            emailResponse: { success: true, fullResponse: emailApiResponse.data },
                            contactResponse: contactResponsePayload,
                            invoiceResponse: invoiceResponsePayload,
                            profileName: selectedProfileName
                        });

                    } else {
                        const emailData = { to_mail_ids: [email], subject: subject, body: body, send_attachment: false };
                        const emailApiUrl = `/invoices/${invoiceId}/email`;
                        const emailApiResponse = await makeApiCall('post', emailApiUrl, emailData, activeProfile, 'books');
                        
                        if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0;

                        socket.emit('booksInvoiceResult', {
                            rowNumber, email, stage: 'complete', success: true,
                            details: `Custom email sent (Invoice API).`,
                            invoiceNumber: invoiceNumber,
                            emailResponse: { success: true, fullResponse: emailApiResponse.data },
                            contactResponse: contactResponsePayload,
                            invoiceResponse: invoiceResponsePayload,
                            profileName: selectedProfileName
                        });
                    }

                } catch (emailError) {
                    const { message, fullResponse } = parseError(emailError);
                    if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures++;
                    checkAutoPause(activeJobs[jobId], selectedProfileName, socket);

                    socket.emit('booksInvoiceResult', {
                        rowNumber, email, stage: 'complete', success: false,
                        details: `Custom Email Error: ${message}`,
                        emailResponse: { success: false, fullResponse },
                        invoiceResponse: invoiceResponsePayload,
                        profileName: selectedProfileName
                    });
                }
            } else if (!sendDefaultEmail && !rowFailed) {
                if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0; 
                
                socket.emit('booksInvoiceResult', {
                    rowNumber, email, stage: 'complete', success: true,
                    details: 'Invoice created (No Email).',
                    invoiceNumber: invoiceNumber,
                    invoiceResponse: invoiceResponsePayload,
                    contactResponse: contactResponsePayload,
                    profileName: selectedProfileName
                });
            }
        }
    } catch (error) {
        socket.emit('bulkError', { message: error.message, profileName: selectedProfileName, jobType: 'books' });
    } finally {
        if (activeJobs[jobId]) {
            const finalStatus = activeJobs[jobId].status;
            if (finalStatus === 'ended') {
                socket.emit('bulkEnded', { profileName: selectedProfileName, jobType: 'books' });
            } else {
                socket.emit('bulkComplete', { profileName: selectedProfileName, jobType: 'books' });
            }
            delete activeJobs[jobId];
        }
    }
};

const handleStartBulkContact = async (socket, data) => {
    const { 
        emails, subject, body, delay, selectedProfileName, activeProfile, 
        sendEmail,
        stopAfterFailures = 0,
        processedIds // <--- ADDED: To support Resuming
    } = data;
    
    const jobId = createJobId(socket.id, selectedProfileName, 'books-contact');
    
    const delayMs = (Number(delay) || 0) * 1000;
    const failureLimit = Number(stopAfterFailures) || 0;

    activeJobs[jobId] = { 
        status: 'running',
        consecutiveFailures: 0,
        stopAfterFailures: failureLimit
    };

    // --- RESUME LOGIC ---
    const processedSet = new Set(processedIds || []);

    try {
        if (!activeProfile || !activeProfile.books) {
            throw new Error('Books profile configuration is missing.');
        }

        for (let i = 0; i < emails.length; i++) {
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;
            while (activeJobs[jobId]?.status === 'paused') {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            if (i > 0 && delayMs > 0) {
                await interruptibleSleep(delayMs, jobId);
            }
            
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;

            const email = emails[i];
            
            // --- SKIP IF ALREADY PROCESSED ---
            if (processedSet.has(email)) continue;

            const rowNumber = i + 1;
            const contactName = email.split('@')[0];
            let contactId;
            let contactResponsePayload = {};

            socket.emit('booksContactResult', { 
                rowNumber, email, stage: 'contact', details: 'Processing contact...', profileName: selectedProfileName 
            });

            try {
                const searchResponse = await makeApiCall('get', `/contacts?email=${encodeURIComponent(email)}`, null, activeProfile, 'books');
                
                if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
                    contactId = searchResponse.data.contacts[0].contact_id;
                    contactResponsePayload = { success: true, message: "Contact already exists.", fullResponse: searchResponse.data };
                    socket.emit('booksContactResult', { 
                        rowNumber, email, stage: 'contact', details: 'Contact exists. Checking email...', 
                        contactResponse: contactResponsePayload, profileName: selectedProfileName 
                    });
                } else {
                    const newContactData = { 
                        contact_name: contactName, 
                        contact_persons: [{ 
                            email: email, 
                            is_primary_contact: true, 
                            first_name: contactName 
                        }],
                        language_code: "en" 
                    };
                    const createResponse = await makeApiCall('post', '/contacts', newContactData, activeProfile, 'books');
                    contactId = createResponse.data.contact.contact_id;
                    contactResponsePayload = { success: true, message: "New Contact Created.", fullResponse: createResponse.data };
                    
                    socket.emit('booksContactResult', { 
                        rowNumber, email, stage: 'contact', details: 'Contact created.', 
                        contactResponse: contactResponsePayload, profileName: selectedProfileName 
                    });
                }
            } catch (err) {
                 const { message, fullResponse } = parseError(err);
                 if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures++;
                 checkAutoPause(activeJobs[jobId], selectedProfileName, socket);
                 
                 socket.emit('booksContactResult', { 
                     rowNumber, email, stage: 'complete', success: false, 
                     details: `Contact Creation Failed: ${message}`, 
                     contactResponse: { success: false, fullResponse }, profileName: selectedProfileName 
                 });
                 continue;
            }

            if (sendEmail) {
                try {
                    await new Promise(r => setTimeout(r, 1000));
                    const emailData = { 
                        to_mail_ids: [email], 
                        subject: subject, 
                        body: body 
                    };
                    
                    const emailResponse = await makeApiCall('post', `/contacts/${contactId}/email`, emailData, activeProfile, 'books');
                    
                    if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0;

                    socket.emit('booksContactResult', { 
                        rowNumber, email, stage: 'complete', success: true, 
                        details: 'Contact processed and Email sent.', 
                        contactResponse: contactResponsePayload,
                        emailResponse: { success: true, fullResponse: emailResponse.data },
                        profileName: selectedProfileName 
                    });

                } catch (err) {
                    const { message, fullResponse } = parseError(err);
                    if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures++;
                    checkAutoPause(activeJobs[jobId], selectedProfileName, socket);

                    socket.emit('booksContactResult', { 
                        rowNumber, email, stage: 'complete', success: false, 
                        details: `Contact OK, but Email Failed: ${message}`, 
                        contactResponse: contactResponsePayload,
                        emailResponse: { success: false, fullResponse },
                        profileName: selectedProfileName 
                    });
                }
            } else {
                if (activeJobs[jobId]) activeJobs[jobId].consecutiveFailures = 0;
                
                socket.emit('booksContactResult', { 
                    rowNumber, email, stage: 'complete', success: true, 
                    details: 'Contact processed (No Email sent).', 
                    contactResponse: contactResponsePayload,
                    profileName: selectedProfileName 
                });
            }
        }
    } catch (error) {
        socket.emit('bulkError', { message: error.message, profileName: selectedProfileName, jobType: 'books-contact' });
    } finally {
        if (activeJobs[jobId]) {
            if (activeJobs[jobId].status === 'ended') {
                socket.emit('bulkEnded', { profileName: selectedProfileName, jobType: 'books-contact' });
            } else {
                socket.emit('bulkComplete', { profileName: selectedProfileName, jobType: 'books-contact' });
            }
            delete activeJobs[jobId];
        }
    }
};

const handleDeleteInvoices = async (socket, data) => {
    try {
        const { activeProfile, invoiceIds } = data;
        if (!activeProfile || !activeProfile.books) {
            throw new Error('Books profile not found.');
        }
        
        let deletedCount = 0;
        for (const invoiceId of invoiceIds) {
            await makeApiCall('delete', `/invoices/${invoiceId}`, null, activeProfile, 'books');
            deletedCount++;
            socket.emit('booksInvoiceDeleteProgress', { deletedCount, total: invoiceIds.length });
        }
        
        socket.emit('booksInvoicesDeletedResult', { success: true, deletedCount: invoiceIds.length });
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('booksInvoicesDeletedResult', { success: false, error: message });
    }
};

module.exports = {
    setActiveJobs,
    handleStartBulkInvoice,
    handleStartBulkContact,
    handleGetOrgDetails,
    handleUpdateOrgDetails,
    handleGetInvoices,
    handleDeleteInvoices,
};