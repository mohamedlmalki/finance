// --- FILE: src/App.tsx ---
import React, { useState, useEffect, createContext, useContext } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { io, Socket } from 'socket.io-client';
import { useToast } from '@/hooks/use-toast';
import NotFound from "@/pages/NotFound";
import { ProfileModal } from '@/components/dashboard/ProfileModal';
import { SaveLoadModal } from '@/components/dashboard/SaveLoadModal';

// --- INVENTORY PAGES ---
import BulkInvoices from '@/pages/BulkInvoices';
import EmailStatics from "@/pages/EmailStatics";
import CustomModuleBulk from '@/pages/CustomModuleBulk';

// --- BOOKS PAGES ---
import BooksInvoices from '@/pages/BooksInvoices';
import BooksContacts from '@/pages/BooksContacts';
import BooksEmailStatics from '@/pages/BooksEmailStatics'; 
import BooksCustomModule from '@/pages/BooksCustomModule';

// --- BILLING PAGES ---
import BillingContacts from '@/pages/BillingContacts';
import BillingCustomModule from '@/pages/BillingCustomModule';

// --- EXPENSE PAGES ---
import ExpenseCustomModule from '@/pages/ExpenseCustomModule';

// --- FLOW ---
import FlowCustomModule from '@/pages/FlowCustomModule';

// --- SHARED/GLOBAL ---
import { InvoiceResult } from '@/components/dashboard/inventory/InvoiceResultsDisplay';
import { useJobTimer } from '@/hooks/useJobTimer';
import LiveStats from '@/pages/LiveStats';

const queryClient = new QueryClient();
const SERVER_URL = "http://localhost:3009";

// --- CONTEXT DEFINITION ---
interface SaveLoadContextType {
    openSaveModal: () => void;
    openLoadModal: () => void;
}
export const SaveLoadContext = createContext<SaveLoadContextType>({
    openSaveModal: () => {},
    openLoadModal: () => {},
});

// --- INTERFACES ---
export interface Profile {
  profileName: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  cloudflareTrackingUrl?: string;
  inventory?: { orgId: string; customModuleApiName?: string; note?: string; };
  books?: { orgId: string; customModuleApiName?: string; note?: string; };
  billing?: { orgId: string; customModuleApiName?: string; note?: string; };
  expense?: { orgId: string; customModuleApiName?: string; note?: string; };
  flow?: { webhookUrl: string; note?: string; }; 
}

export interface InvoiceFormData {
  emails: string;
  subject: string;
  body: string;
  delay: number;
  displayName: string;
  sendCustomEmail: boolean;
  sendDefaultEmail: boolean;
  customEmailMethod: 'invoice' | 'contact';
  stopAfterFailures: number;
}

export interface InvoiceJobState {
  formData: InvoiceFormData;
  results: InvoiceResult[];
  isProcessing: boolean;
  isPaused: boolean;
  isComplete: boolean;
  isQueued: boolean; 
  processingStartTime: Date | null;
  processingTime: number; 
  totalToProcess: number;
  countdown: number;
  currentDelay: number;
  filterText: string;
}

export interface InvoiceJobs { [profileName: string]: InvoiceJobState; }

export interface ModuleField {
    label: string;
    api_name: string;
    data_type: string;
    is_mandatory: boolean;
}

export interface CustomModuleFormData {
    moduleApiName: string;
    bulkField: string;
    bulkData: string;
    staticData: Record<string, string>;
    delay: number;
    availableFields: ModuleField[];
    concurrency: number;
    stopAfterFailures: number;
}

export interface CustomJobResult {
    rowNumber: number;
    identifier: string;
    success: boolean;
    details: string;
    stage: 'processing' | 'complete';
    response?: any;
    fullResponse?: any; 
    timestamp?: Date;
}

export interface CustomModuleJobState {
    formData: CustomModuleFormData;
    results: CustomJobResult[];
    isProcessing: boolean;
    isPaused: boolean;
    isComplete: boolean;
    isQueued: boolean;
    processingStartTime: Date | null;
    processingTime: number;
    totalToProcess: number;
    countdown: number;
    currentDelay: number;
    filterText: string;
}

export interface CustomModuleJobs { [profileName: string]: CustomModuleJobState; }

export interface ExpenseFormData {
    moduleName: string;
    bulkPrimaryField: string;
    bulkValues: string;
    defaultData: Record<string, any>;
    bulkDelay: number;
    concurrency: number;
    fields: any[];
    verifyLog: boolean;
    stopAfterFailures: number;
}

export interface ExpenseJobState {
    formData: ExpenseFormData;
    isProcessing: boolean;
    isPaused: boolean;
    isComplete: boolean;
    isQueued: boolean;
    processingTime: number;
    results: any[]; 
    totalToProcess: number;
    countdown: number;
    processingStartTime?: Date | null;
}

export interface ExpenseJobs { [profileName: string]: ExpenseJobState; }

export interface ContactFormData {
  emails: string;
  subject: string;
  body: string;
  delay: number;
  sendEmail: boolean;
  stopAfterFailures: number;
  displayNames?: string;
}

export interface ContactJobState {
    formData: ContactFormData;
    results: any[]; 
    isProcessing: boolean;
    isPaused: boolean;
    isComplete: boolean;
    isQueued: boolean;
    processingStartTime: Date | null;
    processingTime: number;
    totalToProcess: number;
    countdown: number;
    currentDelay: number;
    filterText: string;
}

export interface ContactJobs { [profileName: string]: ContactJobState; }

// --- INITIAL STATE FACTORIES ---
const createInitialInvoiceJobState = (): InvoiceJobState => ({
    formData: { emails: '', subject: '', body: '', delay: 1, displayName: '', sendCustomEmail: false, sendDefaultEmail: false, customEmailMethod: 'invoice', stopAfterFailures: 4 },
    results: [], isProcessing: false, isPaused: false, isComplete: false, isQueued: false, processingStartTime: null, processingTime: 0, totalToProcess: 0, countdown: 0, currentDelay: 1, filterText: '',
});

const createInitialCustomJobState = (): CustomModuleJobState => ({
    formData: { moduleApiName: '', bulkField: '', bulkData: '', staticData: {}, delay: 1, availableFields: [], concurrency: 1, stopAfterFailures: 4 },
    results: [], isProcessing: false, isPaused: false, isComplete: false, isQueued: false, processingStartTime: null, processingTime: 0, totalToProcess: 0, countdown: 0, currentDelay: 1, filterText: '',
});

const createInitialExpenseJobState = (): ExpenseJobState => ({
    formData: { moduleName: '', bulkPrimaryField: '', bulkValues: '', defaultData: {}, bulkDelay: 1, concurrency: 1, fields: [], verifyLog: false, stopAfterFailures: 4 },
    isProcessing: false, isPaused: false, isComplete: false, isQueued: false, processingTime: 0, results: [], totalToProcess: 0, countdown: 0, processingStartTime: null
});

const createInitialContactJobState = (): ContactJobState => ({
    formData: { emails: '', subject: '', body: '', delay: 1, sendEmail: false, stopAfterFailures: 4, displayNames: '' },
    results: [], isProcessing: false, isPaused: false, isComplete: false, isQueued: false, processingStartTime: null, processingTime: 0, totalToProcess: 0, countdown: 0, currentDelay: 1, filterText: '',
});

const MainApp = () => {
    const { toast } = useToast();
    
    // UI Lock States for Database Wipes
    const [isWiping, setIsWiping] = useState(false);
    const [wipeProgress, setWipeProgress] = useState("");

    // State for all Job Types
    const [invoiceJobs, setInvoiceJobs] = useState<InvoiceJobs>({});
    const [booksJobs, setBooksJobs] = useState<InvoiceJobs>({}); 
    const [booksContactJobs, setBooksContactJobs] = useState<ContactJobs>({});
    const [customJobs, setCustomJobs] = useState<CustomModuleJobs>({});
    const [booksCustomJobs, setBooksCustomJobs] = useState<CustomModuleJobs>({});
    const [expenseJobs, setExpenseJobs] = useState<ExpenseJobs>({}); 

    // --- BILLING STATE ---
    const [billingJobs, setBillingJobs] = useState<InvoiceJobs>({});
    const [billingContactJobs, setBillingContactJobs] = useState<ContactJobs>({});
    const [billingCustomJobs, setBillingCustomJobs] = useState<CustomModuleJobs>({});
    
    // --- FLOW STATE ---
    const [flowJobs, setFlowJobs] = useState<CustomModuleJobs>({});
    
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

    // Save/Load Modal State
    const [isSaveLoadOpen, setIsSaveLoadOpen] = useState(false);
    const [saveLoadMode, setSaveLoadMode] = useState<'save'|'load'>('save');

    // Timers
    useJobTimer(invoiceJobs, setInvoiceJobs, 'invoice');
    useJobTimer(booksJobs, setBooksJobs, 'books'); 
    useJobTimer(booksContactJobs, setBooksContactJobs, 'books-contact');
    useJobTimer(billingContactJobs, setBillingContactJobs, 'billing-contact');

    // Custom & Expense Job Timer
    useEffect(() => {
        const interval = setInterval(() => {
            const updateTime = (prev: any) => {
                const newJobs = { ...prev };
                let changed = false;
                Object.keys(newJobs).forEach(key => {
                    const job = newJobs[key];
                    if (job.isProcessing && !job.isPaused) {
                        newJobs[key] = { ...job, processingTime: job.processingTime + 1 };
                        changed = true;
                    }
                });
                return changed ? newJobs : prev;
            };
            setCustomJobs(updateTime);
            setBooksCustomJobs(updateTime);
            setExpenseJobs(updateTime);
            setBillingCustomJobs(updateTime);
            setFlowJobs(updateTime);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Socket Connection
    useEffect(() => {
        const newSocket = io(SERVER_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => {
            toast({ title: "Connected to server!" });
        });

        // 🚀 BULLETPROOF WIPE UI LISTENER
        newSocket.on('wipeProgress', (data: { profileName?: string, jobType: string, message: string, error?: boolean }) => {
            setIsWiping(true);
            setWipeProgress(data.message);
            if (data.error) {
                toast({ title: "Wipe Error", description: data.message, variant: "destructive" });
                setIsWiping(false); 
            }
        });
        
        const handleInvoiceLikeResult = (result: InvoiceResult & { profileName: string }, setFunc: React.Dispatch<React.SetStateAction<InvoiceJobs>>) => {
            setFunc(prevJobs => {
                const profileJob = prevJobs[result.profileName] || createInitialInvoiceJobState();
                const existingIndex = profileJob.results.findIndex(r => r.rowNumber === result.rowNumber);
                const resultWithTime = { ...result, timestamp: result.timestamp || new Date() };
                let newResults;
                if (existingIndex >= 0) {
                    newResults = [...profileJob.results];
                    newResults[existingIndex] = { ...newResults[existingIndex], ...resultWithTime };
                } else {
                    newResults = [...profileJob.results, resultWithTime];
                }
                const isLast = newResults.length >= profileJob.totalToProcess && result.stage === 'complete';
                return {
                    ...prevJobs,
                    [result.profileName]: {
                        ...profileJob,
                        results: newResults,
                        countdown: isLast ? 0 : profileJob.currentDelay,
                    }
                };
            });
        };

        const handleContactLikeResult = (result: CustomJobResult & { profileName: string }, setFunc: React.Dispatch<React.SetStateAction<ContactJobs>>) => {
            setFunc(prevJobs => {
                const profileJob = prevJobs[result.profileName] || createInitialContactJobState();
                const existingIndex = profileJob.results.findIndex(r => r.rowNumber === result.rowNumber);
                const resultWithTime = { ...result, timestamp: new Date() };
                let newResults;
                if (existingIndex >= 0) {
                    newResults = [...profileJob.results];
                    newResults[existingIndex] = { ...newResults[existingIndex], ...resultWithTime };
                } else {
                    newResults = [...profileJob.results, resultWithTime];
                }
                const isLast = newResults.length >= profileJob.totalToProcess && result.stage === 'complete';
                return {
                    ...prevJobs,
                    [result.profileName]: {
                        ...profileJob,
                        results: newResults,
                        countdown: isLast ? 0 : profileJob.currentDelay,
                    }
                };
            });
        };

        const handleCustomModuleLikeResult = (result: CustomJobResult & { profileName: string }, setFunc: React.Dispatch<React.SetStateAction<CustomModuleJobs>>) => {
             setFunc(prevJobs => {
                const profileJob = prevJobs[result.profileName] || createInitialCustomJobState();
                const existingIndex = profileJob.results.findIndex(r => r.rowNumber === result.rowNumber);
                const resultWithTime = { ...result, timestamp: new Date() };
                let newResults;
                if (existingIndex >= 0) {
                    newResults = [...profileJob.results];
                    newResults[existingIndex] = { ...newResults[existingIndex], ...resultWithTime };
                } else {
                    newResults = [...profileJob.results, resultWithTime];
                }
                const isLast = newResults.length >= profileJob.totalToProcess && result.stage === 'complete';
                return {
                    ...prevJobs,
                    [result.profileName]: {
                        ...profileJob,
                        results: newResults,
                        countdown: 0,
                        isComplete: isLast && !profileJob.isProcessing ? true : profileJob.isComplete 
                    }
                };
             });
        };

        newSocket.on('invoiceResult', (result) => handleInvoiceLikeResult(result, setInvoiceJobs));
        newSocket.on('booksInvoiceResult', (result) => handleInvoiceLikeResult(result, setBooksJobs)); 
        newSocket.on('booksContactResult', (result) => handleContactLikeResult(result, setBooksContactJobs));
        newSocket.on('customModuleResult', (result) => handleCustomModuleLikeResult(result, setCustomJobs));
        newSocket.on('booksCustomModuleResult', (result) => handleCustomModuleLikeResult(result, setBooksCustomJobs));
        newSocket.on('billingInvoiceResult', (result) => handleInvoiceLikeResult(result, setBillingJobs));
        newSocket.on('billingContactResult', (result) => handleContactLikeResult(result, setBillingContactJobs));
        newSocket.on('billingCustomModuleResult', (result) => handleCustomModuleLikeResult(result, setBillingCustomJobs));
        
        newSocket.on('flowResult', (result) => handleCustomModuleLikeResult(result, setFlowJobs));

        newSocket.on('expenseBulkResult', (result: any) => {
             setExpenseJobs(prev => {
                const job = prev[result.profileName] || createInitialExpenseJobState();
                const formattedResult = {
                    ...result,
                    primaryValue: result.value || result.primaryValue || 'Unknown',
                    timestamp: result.timestamp || new Date() 
                };
                const existingIndex = job.results.findIndex(r => r.rowNumber === result.rowNumber);
                let newResults;
                if (existingIndex >= 0) {
                    newResults = [...job.results];
                    newResults[existingIndex] = { ...newResults[existingIndex], ...formattedResult };
                } else {
                    newResults = [...job.results, formattedResult];
                }
                return { ...prev, [result.profileName]: { ...job, results: newResults } };
             });
        });

        const updateJobStatus = (setFunc: any, data: any, updates: any) => {
             setFunc((prev: any) => { 
                 if(prev[data.profileName]) return { ...prev, [data.profileName]: { ...prev[data.profileName], ...updates } }; 
                 return prev; 
             });
        }

        newSocket.on('jobPaused', (data: { profileName: string, reason: string, jobType?: string, isQueued?: boolean }) => {
             const updates = { isPaused: true, isQueued: data.isQueued || false };
             if (!data.jobType || data.jobType === 'invoice') updateJobStatus(setInvoiceJobs, data, updates);
             else if (data.jobType === 'books') updateJobStatus(setBooksJobs, data, updates); 
             else if (data.jobType === 'books-contact') updateJobStatus(setBooksContactJobs, data, updates);
             else if (data.jobType === 'books-custom' || data.jobType?.startsWith('books_')) updateJobStatus(setBooksCustomJobs, data, updates);
             else if (data.jobType === 'expense') updateJobStatus(setExpenseJobs, data, updates);
             else if (data.jobType === 'billing' || data.jobType === 'billing-invoice') updateJobStatus(setBillingJobs, data, updates);
             else if (data.jobType === 'billing-contact') updateJobStatus(setBillingContactJobs, data, updates);
             else if (data.jobType === 'billing-custom' || data.jobType?.startsWith('billing_')) updateJobStatus(setBillingCustomJobs, data, updates);
             else if (data.jobType?.startsWith('Flow_')) updateJobStatus(setFlowJobs, data, updates);
             else updateJobStatus(setCustomJobs, data, updates);
             toast({ title: "Job Paused", description: data.reason, variant: "destructive" });
        });

        newSocket.on('jobResumed', (data: { profileName: string, jobType?: string, isQueued?: boolean }) => {
             const updates = { isPaused: false, isQueued: data.isQueued || false };
             if (!data.jobType || data.jobType === 'invoice') updateJobStatus(setInvoiceJobs, data, updates);
             else if (data.jobType === 'books') updateJobStatus(setBooksJobs, data, updates); 
             else if (data.jobType === 'books-contact') updateJobStatus(setBooksContactJobs, data, updates);
             else if (data.jobType === 'books-custom' || data.jobType?.startsWith('books_')) updateJobStatus(setBooksCustomJobs, data, updates);
             else if (data.jobType === 'expense') updateJobStatus(setExpenseJobs, data, updates);
             else if (data.jobType === 'billing' || data.jobType === 'billing-invoice') updateJobStatus(setBillingJobs, data, updates);
             else if (data.jobType === 'billing-contact') updateJobStatus(setBillingContactJobs, data, updates);
             else if (data.jobType === 'billing-custom' || data.jobType?.startsWith('billing_')) updateJobStatus(setBillingCustomJobs, data, updates);
             else if (data.jobType?.startsWith('Flow_')) updateJobStatus(setFlowJobs, data, updates);
             else updateJobStatus(setCustomJobs, data, updates);
             toast({ title: "Job Resumed", description: "Processing continued." });
        });

        const handleJobCompletion = (data: {profileName: string, jobType?: string}, title: string, description: string, variant?: "destructive") => {
            const updates = { isProcessing: false, isPaused: false, isComplete: true, countdown: 0, isQueued: false };
            const { jobType } = data;
            if (!jobType || jobType === 'invoice') updateJobStatus(setInvoiceJobs, data, updates);
            else if (jobType === 'books') updateJobStatus(setBooksJobs, data, updates); 
            else if (jobType === 'books-contact') updateJobStatus(setBooksContactJobs, data, updates);
            else if (jobType === 'books-custom' || jobType?.startsWith('books_')) updateJobStatus(setBooksCustomJobs, data, updates);
            else if (jobType === 'expense') updateJobStatus(setExpenseJobs, data, updates);
            else if (jobType === 'billing' || jobType === 'billing-invoice') updateJobStatus(setBillingJobs, data, updates);
            else if (jobType === 'billing-contact') updateJobStatus(setBillingContactJobs, data, updates);
            else if (jobType === 'billing-custom' || jobType?.startsWith('billing_')) updateJobStatus(setBillingCustomJobs, data, updates);
            else if (jobType?.startsWith('Flow_')) updateJobStatus(setFlowJobs, data, updates);
            else updateJobStatus(setCustomJobs, data, updates);
            toast({ title, description, variant });
        };

        newSocket.on('bulkComplete', (data) => handleJobCompletion(data, `Processing Complete`, "All items processed."));
        newSocket.on('bulkEnded', (data) => handleJobCompletion(data, `Job Stopped`, "Process stopped by user.", "destructive"));
        newSocket.on('bulkError', (data) => handleJobCompletion(data, `Error`, data.message, "destructive"));

        newSocket.on('jobCleared', (data: { profileName: string, jobType: string }) => {
            // RELEASE WIPE UI LOCK
            setIsWiping(false);
            setWipeProgress("");

            const clearState = (setFunc: any) => {
                setFunc((prev: any) => {
                    const newState = { ...prev };
                    delete newState[data.profileName];
                    return newState;
                });
            };
            
            const { jobType } = data;
            if (!jobType || jobType === 'invoice') clearState(setInvoiceJobs);
            else if (jobType === 'books') clearState(setBooksJobs);
            else if (jobType === 'books-contact') clearState(setBooksContactJobs);
            else if (jobType === 'books-custom' || jobType.startsWith('books_')) clearState(setBooksCustomJobs);
            else if (jobType === 'expense') clearState(setExpenseJobs);
            else if (jobType === 'billing' || jobType === 'billing-invoice') clearState(setBillingJobs);
            else if (jobType === 'billing-contact') clearState(setBillingContactJobs);
            else if (jobType === 'billing-custom' || jobType.startsWith('billing_')) clearState(setBillingCustomJobs);
            else if (jobType.startsWith('Flow_')) clearState(setFlowJobs);
            else clearState(setCustomJobs);
            
            toast({ title: "Account Wiped", description: `${data.profileName} cleared from screen.` });
        });

        newSocket.on('allJobsCleared', (data: { jobType: string }) => {
            // RELEASE WIPE UI LOCK
            setIsWiping(false);
            setWipeProgress("");

            const { jobType } = data;
            
            if (!jobType || jobType === 'invoice') setInvoiceJobs({});
            else if (jobType === 'books') setBooksJobs({});
            else if (jobType === 'books-contact') setBooksContactJobs({});
            else if (jobType === 'books-custom' || jobType.startsWith('books_')) setBooksCustomJobs({});
            else if (jobType === 'expense') setExpenseJobs({});
            else if (jobType === 'billing' || jobType === 'billing-invoice') setBillingJobs({});
            else if (jobType === 'billing-contact') setBillingContactJobs({});
            else if (jobType === 'billing-custom' || jobType.startsWith('billing_')) setBillingCustomJobs({});
            else if (jobType.startsWith('Flow_')) setFlowJobs({}); 
            else setCustomJobs({});
            
            toast({ title: "Master Wipe Complete", description: "All active screens cleared." });
        });

        return () => { newSocket.disconnect(); };
    }, [toast]);
    
    // --- SAVE / LOAD HANDLERS ---
    const openSaveModal = () => { setSaveLoadMode('save'); setIsSaveLoadOpen(true); };
    const openLoadModal = () => { setSaveLoadMode('load'); setIsSaveLoadOpen(true); };

    const handleSaveAll = async (filename: string) => {
        const fullState = {
            invoiceJobs, booksJobs, booksContactJobs,
            billingJobs, billingContactJobs, billingCustomJobs,
            customJobs, booksCustomJobs, expenseJobs,
            flowJobs,
            timestamp: new Date().toISOString()
        };

        try {
            const res = await fetch(`${SERVER_URL}/api/save-state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, state: fullState }),
            });
            const data = await res.json();
            if (data.success) toast({ title: "Saved", description: `Progress saved to ${filename}` });
            else throw new Error(data.error);
        } catch (e: any) {
            toast({ title: "Save Failed", description: e.message, variant: "destructive" });
        }
    };

    const handleLoadAll = async (filename: string) => {
        try {
            const res = await fetch(`${SERVER_URL}/api/load-state/${filename}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            const loadedState = data.state;
            if (!loadedState) throw new Error("Invalid save file.");

            const sanitize = (jobMap: any) => {
                const clean: any = {};
                Object.keys(jobMap).forEach(key => {
                    const hasResults = jobMap[key].results?.length > 0;
                    const hasTotal = jobMap[key].totalToProcess > 0;
                    clean[key] = { ...jobMap[key], isProcessing: (hasResults || hasTotal), isPaused: true, isQueued: false }; 
                });
                return clean;
            };

            if(loadedState.invoiceJobs) setInvoiceJobs(sanitize(loadedState.invoiceJobs));
            if(loadedState.booksJobs) setBooksJobs(sanitize(loadedState.booksJobs));
            if(loadedState.booksContactJobs) setBooksContactJobs(sanitize(loadedState.booksContactJobs));
            
            if(loadedState.billingJobs) setBillingJobs(sanitize(loadedState.billingJobs));
            if(loadedState.billingContactJobs) setBillingContactJobs(sanitize(loadedState.billingContactJobs));
            if(loadedState.billingCustomJobs) setBillingCustomJobs(sanitize(loadedState.billingCustomJobs));

            if(loadedState.customJobs) setCustomJobs(sanitize(loadedState.customJobs));
            if(loadedState.booksCustomJobs) setBooksCustomJobs(sanitize(loadedState.booksCustomJobs));
            if(loadedState.expenseJobs) setExpenseJobs(sanitize(loadedState.expenseJobs));
            if(loadedState.flowJobs) setFlowJobs(sanitize(loadedState.flowJobs));

            toast({ title: "Loaded", description: "Progress restored. Jobs are currently PAUSED." });

        } catch (e: any) {
            toast({ title: "Load Failed", description: e.message, variant: "destructive" });
        }
    };

    // Profile Handlers
    const handleOpenAddProfile = () => { setEditingProfile(null); setIsProfileModalOpen(true); };
    const handleOpenEditProfile = (profile: Profile) => { setEditingProfile(profile); setIsProfileModalOpen(true); };
    const handleSaveProfile = async (profileData: Profile, originalProfileName?: string) => {
        const isEditing = !!originalProfileName;
        const url = isEditing ? `${SERVER_URL}/api/profiles/${encodeURIComponent(originalProfileName)}` : `${SERVER_URL}/api/profiles`;
        try {
            const response = await fetch(url, {
                method: isEditing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profileData),
            });
            const result = await response.json();
            if (result.success) {
                toast({ title: "Success", description: "Profile saved." });
                queryClient.invalidateQueries({ queryKey: ['profiles'] });
                setIsProfileModalOpen(false);
            } else {
                toast({ title: "Error", description: result.error, variant: "destructive" });
            }
        } catch (e) { toast({ title: "Error", description: "Connection failed.", variant: "destructive" }); }
    };
    const handleDeleteProfile = async (profileNameToDelete: string) => {
        try {
            const response = await fetch(`${SERVER_URL}/api/profiles/${encodeURIComponent(profileNameToDelete)}`, { method: 'DELETE' });
            const result = await response.json();
            if(result.success) {
                toast({ title: "Deleted", description: "Profile removed." });
                queryClient.invalidateQueries({ queryKey: ['profiles'] });
            }
        } catch (e) { toast({ title: "Error", variant: "destructive" }); }
    };

    return (
        <SaveLoadContext.Provider value={{ openSaveModal, openLoadModal }}>
            <BrowserRouter>
                <Routes>
                    {/* INVENTORY */}
                    <Route path="/bulk-invoices" element={<BulkInvoices jobs={invoiceJobs} setJobs={setInvoiceJobs} socket={socket} createInitialJobState={createInitialInvoiceJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    <Route path="/email-statics" element={<EmailStatics onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    
                    {/* 🚀 ADDED WIPE PROPS TO INVENTORY CUSTOM MODULES ROUTE */}
                    <Route path="/custom-modules" element={<CustomModuleBulk jobs={customJobs} setJobs={setCustomJobs} socket={socket} createInitialJobState={createInitialCustomJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} isWiping={isWiping} wipeProgress={wipeProgress} />} />
                    
                    {/* BOOKS */}
                    <Route path="/books-invoices" element={<BooksInvoices jobs={booksJobs} setJobs={setBooksJobs} socket={socket} createInitialJobState={createInitialInvoiceJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    <Route path="/books-contacts" element={<BooksContacts jobs={booksContactJobs} setJobs={setBooksContactJobs} socket={socket} createInitialJobState={createInitialContactJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    <Route path="/books-email-statics" element={<BooksEmailStatics onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    <Route path="/books-custom-modules" element={<BooksCustomModule jobs={booksCustomJobs} setJobs={setBooksCustomJobs} socket={socket} createInitialJobState={createInitialCustomJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    
                    {/* BILLING */}
                    <Route path="/billing-contacts" element={<BillingContacts jobs={billingContactJobs} setJobs={setBillingContactJobs} socket={socket} createInitialJobState={createInitialContactJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    
                    {/* 🚀 ADDED WIPE PROPS TO BILLING CUSTOM MODULES ROUTE */}
                    <Route path="/billing-custom-modules" element={<BillingCustomModule jobs={billingCustomJobs} setJobs={setBillingCustomJobs} socket={socket} createInitialJobState={createInitialCustomJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} isWiping={isWiping} wipeProgress={wipeProgress} />} />

                    {/* EXPENSE */}
                    <Route path="/expense" element={<ExpenseCustomModule jobs={expenseJobs} setJobs={setExpenseJobs} socket={socket} createInitialJobState={createInitialExpenseJobState} onAddProfile={handleOpenAddProfile} onEditProfile={handleOpenEditProfile} onDeleteProfile={handleDeleteProfile} />} />
                    
                    {/* FLOW */}
<Route path="/flow-bulk" element={
    <FlowCustomModule
        onAddProfile={handleOpenAddProfile}
        onEditProfile={handleOpenEditProfile}
        onDeleteProfile={handleDeleteProfile}
        jobs={flowJobs}
        setJobs={setFlowJobs}
        socket={socket}
        createInitialJobState={createInitialCustomJobState}
        isWiping={isWiping}
        wipeProgress={wipeProgress}
  />
} />
                   
                    {/* SHARED */}
                    <Route path="/live-stats" element={
                        <LiveStats 
                            invoiceJobs={invoiceJobs}
                            booksJobs={booksJobs}
                            booksContactJobs={booksContactJobs}
                            booksCustomJobs={booksCustomJobs}
                            billingJobs={billingJobs}
                            billingContactJobs={billingContactJobs}
                            billingCustomJobs={billingCustomJobs}
                            customJobs={customJobs}
                            expenseJobs={expenseJobs}
                            onAddProfile={handleOpenAddProfile}
                            onEditProfile={handleOpenEditProfile}
                            onDeleteProfile={handleDeleteProfile}
                            socket={socket} 
                        />
                    } />
                    
                    <Route path="/" element={<Navigate to="/bulk-invoices" replace />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
                <ProfileModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} onSave={handleSaveProfile} profile={editingProfile} socket={socket} />
                
                {/* GLOBAL SAVE LOAD MODAL */}
                <SaveLoadModal 
                    isOpen={isSaveLoadOpen} 
                    onClose={() => setIsSaveLoadOpen(false)} 
                    mode={saveLoadMode}
                    onSave={handleSaveAll}
                    onLoad={handleLoadAll}
                />
            </BrowserRouter>
        </SaveLoadContext.Provider>
    );
};

const App = () => (
    <QueryClientProvider client={queryClient}>
        <TooltipProvider>
            <Toaster />
            <Sonner />
            <MainApp />
        </TooltipProvider>
    </QueryClientProvider>
);

export default App;