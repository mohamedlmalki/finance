// --- FILE: src/pages/FlowCustomModule.tsx ---
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { FlowCustomModuleApplyAllModal } from '@/components/dashboard/FlowCustomModuleApplyAllModal';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { cn, formatTime } from '@/lib/utils';
import { Socket } from 'socket.io-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Profile, CustomModuleJobs, CustomModuleJobState } from '@/App';
import { 
    Loader2, Database, Play, Pause, Square, CheckCircle2, XCircle, AlertCircle, 
    Search, FileText, BarChart3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, 
    Eye, RotateCcw, Trash2, AlertTriangle, Zap, CopyCheck, AlertOctagon
} from 'lucide-react';

const SERVER_URL = "http://localhost:3009";
const ITEMS_PER_PAGE = 10;
const MAX_BUFFER_SIZE = 500; 

interface FlowCustomModuleProps {
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
  jobs: CustomModuleJobs;
  setJobs: React.Dispatch<React.SetStateAction<CustomModuleJobs>>;
  socket: Socket | null;
  createInitialJobState: () => CustomModuleJobState;
  isWiping?: boolean;
  wipeProgress?: string;
}

const FlowCustomModule: React.FC<FlowCustomModuleProps> = ({ 
    onAddProfile, onEditProfile, onDeleteProfile, jobs, setJobs, socket, createInitialJobState, isWiping, wipeProgress
}) => {
    const { toast } = useToast();
    const [activeProfileName, setActiveProfileName] = useState<string | null>(() => localStorage.getItem('flowCustomModuleActiveProfile') || null);
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [isApplyAllModalOpen, setIsApplyAllModalOpen] = useState(false); 
    const [dbSearchResults, setDbSearchResults] = useState<any[] | null>(null);
    const [isSearchingDB, setIsSearchingDB] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [masterBatchConcurrency, setMasterBatchConcurrency] = useState(() => Number(localStorage.getItem('flowMasterBatchConcurrency')) || 1);
    const [filterText, setFilterText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
    const [currentPage, setCurrentPage] = useState(1);
    
    const autoLoadAttemptedRef = useRef<Record<string, boolean>>({});
    const isAutoLoadingRef = useRef<Record<string, boolean>>({});
    const resultBufferRef = useRef<any[]>([]);

    const [apiStatus] = useState<{ status: 'success', message: string }>({ status: 'success', message: 'Ready: Webhooks do not require persistent Zoho tokens.' });

    const { data: profiles = [] } = useQuery<Profile[]>({
        queryKey: ['profiles'],
        queryFn: async () => {
            const res = await fetch(`${SERVER_URL}/api/profiles`);
            if (!res.ok) throw new Error("Failed to fetch profiles");
            return res.json();
        },
    });

    const flowProfiles = profiles.filter(p => p.flow?.webhookUrl);
    const selectedProfile = flowProfiles.find(p => p.profileName === activeProfileName) || null;

    // 🚨 Calculate dynamic index & set 36 exactly <br> tags
    const activeAccIndex = flowProfiles.findIndex(p => p.profileName === activeProfileName) + 1;
    const BR_STRING = "<br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br>";

    useEffect(() => {
        if (activeProfileName) localStorage.setItem('flowCustomModuleActiveProfile', activeProfileName);
        localStorage.setItem('flowMasterBatchConcurrency', masterBatchConcurrency.toString());
    }, [activeProfileName, masterBatchConcurrency]);

    useEffect(() => {
        if (flowProfiles.length > 0 && !activeProfileName) { setActiveProfileName(flowProfiles[0].profileName); } 
        else if (activeProfileName && !flowProfiles.find(p => p.profileName === activeProfileName)) { setActiveProfileName(flowProfiles.length > 0 ? flowProfiles[0].profileName : null); }
    }, [flowProfiles, activeProfileName]);

    useEffect(() => {
        try {
            const savedForms = localStorage.getItem('flowCustomModuleForms_v1');
            if (savedForms) {
                const parsed = JSON.parse(savedForms);
                setJobs(prev => {
                    const next = { ...prev };
                    let hasChanges = false;
                    Object.keys(parsed).forEach(profileName => {
                        const existingJob = next[profileName] || createInitialJobState();
                        next[profileName] = { ...existingJob, formData: { ...existingJob.formData, ...parsed[profileName] } };
                        hasChanges = true;
                    });
                    return hasChanges ? next : prev;
                });
            }
        } catch (error) {}
    }, []); 

    useEffect(() => {
        try {
            const formsToSave: Record<string, any> = {};
            let hasData = false;
            Object.keys(jobs).forEach(profileName => {
                if (jobs[profileName]?.formData) { formsToSave[profileName] = jobs[profileName].formData; hasData = true; }
            });
            if (hasData) localStorage.setItem('flowCustomModuleForms_v1', JSON.stringify(formsToSave));
        } catch (error) {}
    }, [jobs]);

    const getSafeJob = (prevJobs: CustomModuleJobs, profileName: string): CustomModuleJobState => {
        if (prevJobs && prevJobs[profileName]) return prevJobs[profileName];
        return createInitialJobState();
    };

    useEffect(() => {
        if (!socket || !activeProfileName) return;
        const currentJob = jobs[activeProfileName];
        if (currentJob && (currentJob.isProcessing || currentJob.isPaused) && currentJob.results.length === 0) {
            if (!autoLoadAttemptedRef.current[activeProfileName]) {
                autoLoadAttemptedRef.current[activeProfileName] = true; 
                isAutoLoadingRef.current[activeProfileName] = true;     
                socket.emit('startBulkFlowJob', { isSearchRequest: true, selectedProfileName: activeProfileName, query: '' });
            }
        }
    }, [activeProfileName, jobs, socket]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (resultBufferRef.current.length > 0) {
                const resultsToProcess = [...resultBufferRef.current];
                resultBufferRef.current = []; 
                setJobs(prev => {
                    let next = { ...prev };
                    let changed = false;
                    const grouped: Record<string, any[]> = {};
                    resultsToProcess.forEach(r => {
                        if (!grouped[r.profileName]) grouped[r.profileName] = [];
                        grouped[r.profileName].push(r);
                    });
                    Object.keys(grouped).forEach(profileName => {
                        const currentJob = getSafeJob(next, profileName);
                        let newResults = [...currentJob.results];
                        let newProcessed = currentJob.processedCount || 0;
                        let newSuccess = currentJob.successCount || 0;
                        let newError = currentJob.errorCount || 0;
                        grouped[profileName].forEach(result => {
                            const existingIndex = newResults.findIndex(r => r.rowNumber === result.rowNumber);
                            if (result.stage === 'complete') {
                                if (existingIndex === -1 || newResults[existingIndex].stage !== 'complete') {
                                    newProcessed++;
                                    if (result.success) newSuccess++;
                                    else newError++;
                                }
                            }
                            if (existingIndex >= 0) newResults[existingIndex] = { ...newResults[existingIndex], ...result };
                            else newResults.unshift(result);
                        });
                        newResults = newResults.sort((a, b) => (b.rowNumber || 0) - (a.rowNumber || 0)).slice(0, MAX_BUFFER_SIZE);
                        const isDone = newProcessed >= currentJob.totalToProcess && currentJob.totalToProcess > 0;
                        next[profileName] = { ...currentJob, results: newResults, processedCount: newProcessed, successCount: newSuccess, errorCount: newError, _ignition: true, _isQueued: false, isProcessing: isDone ? false : currentJob.isProcessing, isComplete: isDone, isPaused: isDone ? false : currentJob.isPaused } as any;
                        changed = true;
                    });
                    return changed ? next : prev;
                });
            }
        }, 1000); 
        return () => clearInterval(interval);
    }, [setJobs]);

    useEffect(() => {
        if (!socket) return;
        const handleBufferedResult = (result: any) => { resultBufferRef.current.push(result); };
        const handleSync = (allJobs: any[]) => {
            setJobs(prev => {
                const next = { ...prev };
                let hasChanges = false;
                allJobs.forEach(dbJob => {
                    if (!dbJob.jobtype?.startsWith('Flow_') && !dbJob.jobType?.startsWith('Flow_')) return;
                    const profileName = dbJob.profilename || dbJob.profileName;
                    const existingJob = getSafeJob(next, profileName);
                    if ((existingJob as any)._isQueued || (existingJob.isProcessing && (existingJob as any)._ignition === false)) return;
                    const newProcessed = Math.max(existingJob.processedCount || 0, dbJob.processedCount || dbJob.processedcount || 0);
                    const newSuccess = Math.max(existingJob.successCount || 0, dbJob.successCount || dbJob.successcount || 0);
                    const newError = Math.max(existingJob.errorCount || 0, dbJob.errorCount || dbJob.errorcount || 0);
                    const newTotal = dbJob.totalToProcess || dbJob.totaltoprocess || existingJob.totalToProcess || 0;
                    const isDone = newProcessed >= newTotal && newTotal > 0;
                    let backendIsProcessing = false; let backendIsQueued = false; let backendIsPaused = dbJob.status === 'paused';
                    if (existingJob.isPaused && dbJob.status === 'running') { backendIsPaused = true; }
                    if (!isDone) {
                        if (backendIsPaused) { backendIsProcessing = true; }
                        else if (dbJob.status === 'running') { backendIsProcessing = true; }
                        else if (dbJob.status === 'queued') { backendIsQueued = true; }
                    }
                    if ((existingJob as any)._forceStopped) { backendIsProcessing = false; backendIsPaused = false; } 
                    let mergedResults = [...(existingJob.results || [])];
                    if (dbJob.results && Array.isArray(dbJob.results)) {
                        dbJob.results.forEach(dbResult => {
                            const idx = mergedResults.findIndex(r => r.rowNumber === dbResult.rowNumber);
                            if (idx === -1) mergedResults.push(dbResult);
                            else mergedResults[idx] = { ...mergedResults[idx], ...dbResult };
                        });
                        mergedResults.sort((a, b) => { const numA = a.rowNumber || a.fallbackRowNumber || 0; const numB = b.rowNumber || b.fallbackRowNumber || 0; return numB - numA; });
                        mergedResults = mergedResults.slice(0, MAX_BUFFER_SIZE);
                    }
                    if ( existingJob.processedCount !== newProcessed || existingJob.totalToProcess !== newTotal || existingJob.isProcessing !== backendIsProcessing || existingJob.isPaused !== backendIsPaused ) {
                        next[profileName] = { ...existingJob, isProcessing: backendIsProcessing, isPaused: backendIsPaused, _isQueued: backendIsQueued, isComplete: isDone, totalToProcess: newTotal, processedCount: newProcessed, successCount: newSuccess, errorCount: newError, results: mergedResults } as any;
                        hasChanges = true;
                    }
                });
                return hasChanges ? next : prev;
            });
        };
        const handleJobStarted = (data: any) => { if (data.jobType?.startsWith('Flow_')) setJobs(prev => ({ ...prev, [data.profileName]: { ...getSafeJob(prev, data.profileName), isProcessing: true, _isQueued: false, _forceStopped: false, isPaused: false } as any })); };
        const handleBulkComplete = (data: any) => { if (data.jobType?.startsWith('Flow_')) setJobs(prev => ({ ...prev, [data.profileName]: { ...getSafeJob(prev, data.profileName), isProcessing: false, isComplete: true } as any })); };
        const handleBulkEnded = (data: any) => { if (data.jobType?.startsWith('Flow_')) setJobs(prev => ({ ...prev, [data.profileName]: { ...getSafeJob(prev, data.profileName), isProcessing: false, _forceStopped: true } as any })); };
        const handleJobCleared = (data: any) => { if (data.jobType?.startsWith('Flow_')) { setJobs(prev => { const safeJob = getSafeJob(prev, data.profileName); return { ...prev, [data.profileName]: { ...safeJob, results: [], totalToProcess: 0, isProcessing: false, isPaused: false, isComplete: false, processedCount: 0, successCount: 0, errorCount: 0, _forceStopped: true, _isQueued: false, formData: { ...safeJob.formData, bulkData: '' } } as any }; }); } };
        
        socket.on('databaseSync', handleSync); socket.on('jobStarted', handleJobStarted); socket.on('bulkComplete', handleBulkComplete); socket.on('bulkEnded', handleBulkEnded); socket.on('jobCleared', handleJobCleared); socket.on('flowResult', handleBufferedResult); 
        socket.emit('requestDatabaseSync'); const heartbeat = setInterval(() => { socket.emit('requestDatabaseSync'); }, 2500);
        return () => { clearInterval(heartbeat); socket.off('databaseSync', handleSync); socket.off('jobStarted', handleJobStarted); socket.off('bulkComplete', handleBulkComplete); socket.off('bulkEnded', handleBulkEnded); socket.off('jobCleared', handleJobCleared); socket.off('flowResult', handleBufferedResult); };
    }, [socket, setJobs, createInitialJobState]); 

    useEffect(() => {
        if (!socket || !activeProfileName) return;
        const handleDbSearch = (data: any) => { 
            if (data.profileName === activeProfileName) {
                if (isAutoLoadingRef.current[activeProfileName]) {
                    isAutoLoadingRef.current[activeProfileName] = false;
                    setJobs(prev => { const j = getSafeJob(prev, data.profileName); const sortedHistory = [...data.results].sort((a, b) => (b.rowNumber || 0) - (a.rowNumber || 0)); if (j.results.length === 0) return { ...prev, [data.profileName]: { ...j, results: sortedHistory } }; return prev; });
                } else {
                    setIsSearchingDB(false); setDbSearchResults(data.results); toast({ title: "Database Search Complete", description: `Found ${data.results.length} items.` }); 
                }
            } 
        };
        const handleExport = (data: any) => { if (data.profileName === activeProfileName) { setIsExporting(false); const content = data.results.map((r:any) => `${r.identifier} - ${r.success ? 'Success' : 'Error'} - ${r.details}`).join('\n'); const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `FULL_EXPORT_${activeProfileName}_${new Date().toISOString().slice(0,10)}.txt`; document.body.appendChild(link); link.click(); document.body.removeChild(link); toast({ title: "Export Complete" }); } };
        socket.on('databaseSearchResults', handleDbSearch); socket.on('fullExportData', handleExport);
        return () => { socket.off('databaseSearchResults', handleDbSearch); socket.off('fullExportData', handleExport); };
    }, [socket, activeProfileName, setJobs, toast]);

    const updateFormData = (updates: any) => { 
        if (!activeProfileName) return; 
        setJobs(prev => ({ ...prev, [activeProfileName]: { ...getSafeJob(prev, activeProfileName), formData: { ...getSafeJob(prev, activeProfileName).formData, ...updates } } })); 
    };

    const handleClearJob = () => { if (!activeProfileName || !socket) return; if (window.confirm(`⚠️ Are you sure you want to completely WIPE all data for ${activeProfileName}?`)) { socket.emit('clearJob', { profileName: activeProfileName, jobType: `Flow_${activeProfileName}` }); } };
    const handleClearAllJobs = () => { if (!socket) return; if (window.confirm(`🚨 DANGER: Are you sure you want to completely WIPE ALL databases for EVERY profile on Flow?`)) { flowProfiles.forEach(p => socket.emit('clearJob', { profileName: p.profileName, jobType: `Flow_${p.profileName}` })); setJobs({}); toast({ title: "Master Wipe Initiated", description: "All Flow accounts are being cleared." }); } };

    const jobState = getSafeJob(jobs as any, activeProfileName || '');
    const { formData, results } = jobState;
    const webhookUrl = selectedProfile?.flow?.webhookUrl || '';
    const trackingEnabled = (formData as any).trackingEnabled || false;
    const targetHtmlField = (formData as any).targetHtmlField || 'description';
    const eligibleProfilesCount = useMemo(() => flowProfiles.length, [flowProfiles]);
    const recordCount = useMemo(() => { if (!formData.bulkData) return 0; return formData.bulkData.split('\n').filter(line => line.trim() !== '').length; }, [formData.bulkData]);

    const handleStartJob = () => {
        if (!activeProfileName || !webhookUrl || !formData.bulkData) { return toast({ title: "Missing Info", description: "Webhook URL and Bulk Data are required.", variant: "destructive" }); }
        let rows: any[] = []; try { rows = JSON.parse(formData.bulkData); } catch (e) { rows = formData.bulkData.split('\n').filter(x => x.trim()).map(val => ({ email: val.trim() })); }
        setJobs(prev => ({ ...prev, [activeProfileName]: { ...getSafeJob(prev, activeProfileName), isProcessing: true, isPaused: false, isComplete: false, _forceStopped: false, _isQueued: false, _ignition: false, totalToProcess: rows.length, results: [], processedCount: 0, successCount: 0, errorCount: 0 } as any }));
        socket?.emit('startBulkFlowJob', { selectedProfileName: activeProfileName, webhookUrl, bulkField: 'email', bulkData: formData.bulkData, staticData: formData.staticData, delay: formData.delay, concurrency: formData.concurrency, stopAfterFailures: (formData as any).stopAfterFailures || 0, appendAccountName: (formData as any).appendAccountName || false, accountIndex: activeAccIndex, trackingEnabled, targetHtmlField, startingRowNumber: 1 });
    };

    const handleApplyAllFlow = () => {
        if (!window.confirm(`Copy this mapping configuration to ALL ${eligibleProfilesCount} eligible accounts?`)) return;
        setJobs(prev => { 
            const next = { ...prev }; 
            flowProfiles.forEach(p => { 
                const targetAccIndex = flowProfiles.findIndex(fp => fp.profileName === p.profileName) + 1;
                let desc = formData.staticData?.description || '';
                
                // Smartly adjusts the <br> string and correct index for every copied account!
                if ((formData as any).appendAccountName) {
                    desc = desc.replace(/(<br>){5,}\d*$/g, '');
                    desc = desc + BR_STRING + targetAccIndex;
                } else {
                    desc = desc.replace(/(<br>){5,}\d*$/g, '');
                }

                next[p.profileName] = { 
                    ...getSafeJob(next, p.profileName), 
                    formData: { 
                        ...getSafeJob(next, p.profileName).formData, 
                        bulkField: 'email', 
                        bulkData: formData.bulkData, 
                        staticData: { ...formData.staticData, description: desc }, 
                        delay: formData.delay, 
                        concurrency: formData.concurrency,
                        stopAfterFailures: (formData as any).stopAfterFailures || 0,
                        appendAccountName: (formData as any).appendAccountName || false,
                        trackingEnabled, 
                        targetHtmlField 
                    } as any 
                }; 
            }); 
            return next; 
        });
        toast({ title: "Settings Applied", description: `Copied configuration to all valid accounts.` });
    };

    // 🚨 MODAL APPLY ALL - Dynamically writes exact index into each Description textbox!
    const handleApplyAll = (selectedProfiles: string[], modalFormData: any, modalTrackingData: any, applyOptions: any) => {
        setJobs(prev => {
            const next = { ...prev };
            selectedProfiles.forEach(pName => {
                const existingJob = getSafeJob(next, pName);
                let updatedFormData = { ...existingJob.formData } as any;
                const targetAccIndex = flowProfiles.findIndex(p => p.profileName === pName) + 1;

                if (applyOptions.iterator) {
                    updatedFormData.bulkField = 'email'; 
                    updatedFormData.bulkData = modalFormData.bulkData;
                }
                if (applyOptions.staticFields) {
                    updatedFormData.staticData = { ...modalFormData.staticData };
                }
                if (applyOptions.execution) {
                    updatedFormData.delay = modalFormData.delay;
                    updatedFormData.concurrency = modalFormData.concurrency;
                    updatedFormData.stopAfterFailures = modalFormData.stopAfterFailures; 
                }
                if (applyOptions.tracking) {
                    updatedFormData.trackingEnabled = modalTrackingData.trackingEnabled;
                    updatedFormData.targetHtmlField = modalTrackingData.targetHtmlField;
                    updatedFormData.appendAccountName = modalTrackingData.appendAccountName; 
                }

                if (applyOptions.staticFields || applyOptions.tracking) {
                    let desc = updatedFormData.staticData?.description || '';
                    if (updatedFormData.appendAccountName) {
                        desc = desc.replace(/(<br>){5,}\d*$/g, '');
                        desc = desc + BR_STRING + targetAccIndex;
                    } else if (applyOptions.tracking) {
                        desc = desc.replace(/(<br>){5,}\d*$/g, '');
                    }
                    updatedFormData.staticData = { ...updatedFormData.staticData, description: desc };
                }

                next[pName] = { ...existingJob, formData: updatedFormData };
            });
            return next;
        });
        toast({ title: "Settings Applied", description: `Applied to ${selectedProfiles.length} accounts successfully.` });
    };

    const handlePauseResume = () => {
        if (!socket || !activeProfileName) return; const isPaused = jobState.isPaused; socket.emit(isPaused ? 'resumeJob' : 'pauseJob', { profileName: activeProfileName, jobType: `Flow_${activeProfileName}` }); setJobs(prev => ({ ...prev, [activeProfileName]: { ...getSafeJob(prev, activeProfileName), isPaused: !isPaused, isProcessing: true } as any })); toast({ title: isPaused ? "Job Resumed!" : "Job Paused." }); 
    };

    const activeMasterJobs = useMemo(() => {
        let running = 0; let paused = 0; let queued = 0;
        flowProfiles.forEach(p => { const job = jobs[p.profileName]; if (job && job.isProcessing) { if (job.isPaused) paused++; else running++; } else if ((job as any)?._isQueued) queued++; });
        return { running, paused, queued, totalProcessing: running + paused + queued };
    }, [jobs, flowProfiles]);

    const handleMasterBatchStart = () => {
        const idleProfiles = flowProfiles.filter(p => !jobs[p.profileName]?.isProcessing && !(jobs[p.profileName] as any)?._isQueued);
        if (idleProfiles.length === 0) return toast({ title: "All Active", description: "Accounts are already running.", variant: "default" });
        const payloads: any[] = [];
        idleProfiles.forEach(profileData => {
            const pName = profileData.profileName; const job = jobs[pName]; const url = profileData.flow?.webhookUrl;
            let safeStatic = {}; let safeBulk = '';
            if (pName === activeProfileName) { safeStatic = formData.staticData; safeBulk = formData.bulkData; } 
            else if (typeof job?.formData?.bulkData === 'string' && job.formData.bulkData.trim().length > 0) { safeStatic = job.formData.staticData || {}; safeBulk = job.formData.bulkData; } 
            else return;
            if (!url || !safeBulk.trim()) return;
            
            const accIndex = flowProfiles.findIndex(p => p.profileName === pName) + 1;
            
            payloads.push({ selectedProfileName: pName, webhookUrl: url, bulkField: 'email', bulkData: safeBulk, staticData: safeStatic, delay: formData.delay || 0, concurrency: formData.concurrency || 1, stopAfterFailures: (job?.formData as any)?.stopAfterFailures || 0, appendAccountName: (job?.formData as any)?.appendAccountName || false, accountIndex: accIndex, activeProfile: profileData, trackingEnabled: (job?.formData as any)?.trackingEnabled || false, targetHtmlField: (job?.formData as any)?.targetHtmlField || 'description', startingRowNumber: 1 });
        });
        if (payloads.length === 0) return toast({ title: "No Data", description: "No accounts have data to process.", variant: "destructive" });
        setJobs(prev => { const next = { ...prev }; payloads.forEach(p => { next[p.selectedProfileName] = { ...getSafeJob(next, p.selectedProfileName), isProcessing: false, isPaused: false, _isQueued: true, results: [], totalToProcess: p.bulkData.split('\n').filter((x: string) => x.trim()).length, processedCount: 0, successCount: 0, errorCount: 0 } as any; }); return next; });
        socket?.emit('startMasterBatchFlowJob', { concurrency: masterBatchConcurrency, payloads }); toast({ title: "Master Batch Started" });
    };

    const handleMasterPauseAll = () => { flowProfiles.forEach(p => { const job = jobs[p.profileName]; if (job && job.isProcessing && !job.isPaused) { setJobs(prev => ({ ...prev, [p.profileName]: { ...getSafeJob(prev, p.profileName), isPaused: true } as any })); socket?.emit('pauseJob', { profileName: p.profileName, jobType: `Flow_${p.profileName}` }); } }); toast({ title: "Master Batch Paused" }); };
    const handleMasterForceResume = () => { flowProfiles.forEach(p => { const job = jobs[p.profileName]; if (job && job.isProcessing && job.isPaused) { setJobs(prev => ({ ...prev, [p.profileName]: { ...getSafeJob(prev, p.profileName), isPaused: false } as any })); socket?.emit('resumeJob', { profileName: p.profileName, jobType: `Flow_${p.profileName}` }); } }); toast({ title: "Master Batch Resumed" }); };
    const handleMasterStopAll = () => { flowProfiles.forEach(p => { const job = jobs[p.profileName]; if (job && (job.isProcessing || (job as any)?._isQueued)) { socket?.emit('endJob', { profileName: p.profileName, jobType: `Flow_${p.profileName}` }); setJobs(prev => ({ ...prev, [p.profileName]: { ...getSafeJob(prev, p.profileName), isProcessing: false, _forceStopped: true } as any })); } }); toast({ title: "Master Batch Stopped", variant: "destructive" }); };
    const handleRetryFailed = () => { if (!activeProfileName) return; const failed = results.filter(r => !r.success && r.stage === 'complete').map(r => r.identifier).join('\n'); if (!failed) return toast({ title: "No failed items" }); updateFormData({ bulkData: failed }); setJobs(prev => ({ ...prev, [activeProfileName]: { ...getSafeJob(prev, activeProfileName), isProcessing: false, totalToProcess: failed.split('\n').length, results: [], processedCount: 0, successCount: 0, errorCount: 0 } as any })); toast({ title: "Ready for Retry" }); };

    const completedCount = (jobState as any).processedCount || 0; const successCount = (jobState as any).successCount || 0; const errorCount = (jobState as any).errorCount || 0;
    const progressPercent = jobState.totalToProcess > 0 ? (completedCount / jobState.totalToProcess) * 100 : 0; const remainingCount = Math.max(0, jobState.totalToProcess - completedCount);

    const filteredResults = useMemo(() => {
        let res = [...results].sort((a, b) => { const numA = a.rowNumber || a.fallbackRowNumber || 0; const numB = b.rowNumber || b.fallbackRowNumber || 0; return numB - numA; });
        if (statusFilter === 'success') res = res.filter(r => r.success && r.stage === 'complete'); else if (statusFilter === 'error') res = res.filter(r => !r.success && r.stage === 'complete');
        if (filterText) { const l = filterText.toLowerCase(); res = res.filter(r => r.identifier.toLowerCase().includes(l) || (r.details || '').toLowerCase().includes(l) ); }
        return res;
    }, [results, filterText, statusFilter]);

    const activeResultsList = dbSearchResults !== null ? dbSearchResults : filteredResults;
    const totalPages = Math.ceil(activeResultsList.length / ITEMS_PER_PAGE);
    const paginatedResults = useMemo(() => { const s = (currentPage - 1) * ITEMS_PER_PAGE; return activeResultsList.slice(s, s + ITEMS_PER_PAGE); }, [activeResultsList, currentPage]);
    const formatExactTime = (dateInput?: Date | string) => { if (!dateInput) return '-'; const date = new Date(dateInput); const hours = date.getHours().toString().padStart(2, '0'); const minutes = date.getMinutes().toString().padStart(2, '0'); const seconds = date.getSeconds().toString().padStart(2, '0'); const milliseconds = date.getMilliseconds().toString().padStart(3, '0'); return `${hours}:${minutes}:${seconds}.${milliseconds}`; };

    return (
        <>
            <DashboardLayout 
                onAddProfile={onAddProfile} profiles={flowProfiles} selectedProfile={selectedProfile} onProfileChange={setActiveProfileName} jobs={jobs} socket={socket} onEditProfile={onEditProfile} onDeleteProfile={onDeleteProfile} service="flow" apiStatus={apiStatus} onManualVerify={() => {}} onShowStatus={() => setIsStatusModalOpen(true)} isWiping={isWiping} wipeProgress={wipeProgress}
            >
                <div className="space-y-6">
                    <Card className="shadow-medium">
                        <CardHeader>
                            <CardTitle className="flex items-center space-x-2"><Zap className="h-5 w-5 text-yellow-500 fill-yellow-500" /><span>Flow / Webhook Manager</span></CardTitle>
                            <div className="text-sm text-muted-foreground flex items-center justify-between w-full mt-2">
                                {webhookUrl ? (
                                    <div className="flex items-center justify-between w-full gap-4 flex-wrap">
                                        <span className="flex items-center gap-2">Target Account: <span className="font-bold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded border border-yellow-200">{activeProfileName}</span></span>
                                        <div className="flex items-center gap-2">
                                            <Button variant="outline" size="sm" className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50" onClick={handleClearJob}><Trash2 className="h-3 w-3 mr-1.5" /> Wipe Account</Button>
                                            <Button variant="destructive" size="sm" className="h-7 text-xs font-bold bg-red-600 hover:bg-red-700" onClick={handleClearAllJobs}><AlertTriangle className="h-3 w-3 mr-1.5" /> Wipe ALL</Button>
                                            <div className="w-px h-4 bg-border mx-1 hidden sm:block"></div>
                                            <Button variant="outline" size="sm" className="h-7 text-xs bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100" onClick={() => setIsApplyAllModalOpen(true)} disabled={jobState.isProcessing || (jobState as any)._isQueued}><CopyCheck className="h-3 w-3 mr-1.5" /> Apply Config to All</Button>
                                        </div>
                                    </div>
                                ) : ( "No Webhook configured." )}
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {!webhookUrl && (<Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Configuration Required</AlertTitle><AlertDescription>Please configure a Webhook URL in Settings.</AlertDescription></Alert>)}
                            {webhookUrl && (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="space-y-4 border-r pr-0 lg:pr-8">
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center mb-1">
                                                <Label className="text-primary font-bold">Bulk Emails</Label>
                                                {jobState.isProcessing && !formData.bulkData && <span className="text-xs text-muted-foreground italic text-amber-600">Restored from DB</span>}
                                                <Badge variant="secondary" className="text-xs font-mono">{recordCount > 0 ? recordCount : jobState.totalToProcess} Records</Badge>
                                            </div>
                                            <Textarea className="min-h-[300px] font-mono mt-1 mb-2 bg-muted/30" value={formData.bulkData} onChange={e => updateFormData({ bulkData: e.target.value })} disabled={jobState.isProcessing || (jobState as any)._isQueued} placeholder="admin@example.com&#10;sales@example.com" />
                                            <div className="flex gap-2">
                                                {!jobState.isProcessing && !(jobState as any)._isQueued && (<Button size="sm" className="w-full" onClick={handleStartJob} disabled={!formData.bulkData}><Play className="mr-2 h-4 w-4" /> Start Single Job</Button>)}
                                                {(jobState.isProcessing || (jobState as any)._isQueued) && (
                                                    <>
                                                        <Button size="sm" className={cn("flex-1 font-bold transition-colors", jobState.isPaused ? "bg-green-600 hover:bg-green-700 text-white shadow-[0_0_15px_rgba(22,163,74,0.4)]" : "")} variant={jobState.isPaused ? "default" : "outline"} onClick={handlePauseResume} disabled={(jobState as any)._isQueued}>{jobState.isPaused ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}{jobState.isPaused ? "Resume" : "Pause"}</Button>
                                                        <Button size="sm" variant="destructive" className="flex-1" onClick={() => { socket?.emit('endJob', { profileName: activeProfileName, jobType: `Flow_${activeProfileName}` }); setJobs(prev => ({ ...prev, [activeProfileName]: { ...getSafeJob(prev, activeProfileName), isProcessing: false, _forceStopped: true } as any })); }}><Square className="mr-1 h-3 w-3" /> Stop</Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <Label className="text-primary font-bold">Static Payload Details</Label>
                                        <div className="space-y-3 p-1 pr-2">
                                            <div className="grid gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">Name</Label><Input value={formData.staticData['name'] || ''} onChange={e => updateFormData({ staticData: { ...formData.staticData, name: e.target.value } })} placeholder="e.g., John Doe" disabled={jobState.isProcessing || (jobState as any)._isQueued}/></div>
                                            <div className="grid gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">Subject</Label><Input value={formData.staticData['subject'] || ''} onChange={e => updateFormData({ staticData: { ...formData.staticData, subject: e.target.value } })} placeholder="Email Subject" disabled={jobState.isProcessing || (jobState as any)._isQueued}/></div>
                                            <div className="grid gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">Description / Body</Label><Textarea value={formData.staticData['description'] || ''} onChange={e => updateFormData({ staticData: { ...formData.staticData, description: e.target.value } })} placeholder="Main email content..." disabled={jobState.isProcessing || (jobState as any)._isQueued} rows={4}/></div>
                                        </div>
                                        <div className="p-3 border rounded-lg space-y-3 mt-4">
                                            <div className="flex items-center space-x-2"><Checkbox id="enableTracking" checked={trackingEnabled} onCheckedChange={(c) => updateFormData({ trackingEnabled: !!c })} disabled={jobState.isProcessing || (jobState as any)._isQueued || !selectedProfile?.cloudflareTrackingUrl} /><Label htmlFor="enableTracking" className="font-medium cursor-pointer flex items-center gap-2 text-muted-foreground">Enable Link Injection & Tracking {!selectedProfile?.cloudflareTrackingUrl && <span className="text-[10px] text-destructive font-bold">(URL missing in Profile)</span>}</Label></div>
                                            {trackingEnabled && (<div className="pl-6"><Input placeholder="JSON Key for HTML Body injection (e.g., description)" value={targetHtmlField} onChange={(e) => updateFormData({ targetHtmlField: e.target.value })} className="h-8 text-xs font-mono" disabled={jobState.isProcessing || (jobState as any)._isQueued} /></div>)}
                                            
                                            {/* 🚨 VISUAL UI CHECKBOX */}
                                            <div className="flex items-center space-x-2 pt-2 border-t mt-2">
                                                <Checkbox 
                                                    id="appendAccountName" 
                                                    checked={(formData as any).appendAccountName || false} 
                                                    onCheckedChange={(c) => {
                                                        let desc = formData.staticData?.description || '';
                                                        if (c) {
                                                            // Removes old tags safely and appends 36 tags + the correct active index immediately!
                                                            desc = desc.replace(/(<br>){5,}\d*$/g, '');
                                                            desc = desc + BR_STRING + activeAccIndex;
                                                        } else {
                                                            desc = desc.replace(/(<br>){5,}\d*$/g, '');
                                                        }
                                                        updateFormData({ 
                                                            appendAccountName: !!c,
                                                            staticData: { ...formData.staticData, description: desc }
                                                        });
                                                    }} 
                                                    disabled={jobState.isProcessing || (jobState as any)._isQueued} 
                                                />
                                                <Label htmlFor="appendAccountName" className="font-medium cursor-pointer text-muted-foreground text-sm">Append Account Index to Description</Label>
                                            </div>
                                        </div>
                                        <div className="pt-4 border-t grid grid-cols-3 gap-4">
                                            <div><Label className="text-xs">Delay (s)</Label><Input type="number" value={formData.delay} onChange={e => updateFormData({ delay: Number(e.target.value) })} className="mt-1 h-8 text-sm" disabled={jobState.isProcessing || (jobState as any)._isQueued} min={0}/></div>
                                            <div><Label className="text-xs">Concurrency</Label><Input type="number" value={formData.concurrency} onChange={e => updateFormData({ concurrency: Number(e.target.value) })} className="mt-1 h-8 text-sm" disabled min={1} max={10}/></div>
                                            <div><Label className="text-xs text-red-600/80 flex items-center"><AlertOctagon className="h-3 w-3 mr-1" /> Pause At</Label><Input type="number" value={(formData as any).stopAfterFailures || ''} onChange={e => updateFormData({ stopAfterFailures: Number(e.target.value) })} className="mt-1 h-8 text-sm bg-background" disabled={jobState.isProcessing || (jobState as any)._isQueued} min={0} placeholder="0 (Off)"/></div>
                                        </div>

                                        <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                                            <div className="bg-muted/30 p-2 rounded"><div className="text-xl font-bold font-mono">{formatTime(jobState.processingTime)}</div><div className="text-[10px] text-muted-foreground uppercase">Elapsed</div></div>
                                            <div className="bg-muted/30 p-2 rounded"><div className="text-xl font-bold">{remainingCount}</div><div className="text-[10px] text-muted-foreground uppercase">Remaining</div></div>
                                            <div className="bg-green-500/10 p-2 rounded text-green-700"><div className="text-xl font-bold">{successCount}</div><div className="text-[10px] uppercase">Success</div></div>
                                            <div className="bg-red-500/10 p-2 rounded text-red-700"><div className="text-xl font-bold">{errorCount}</div><div className="text-[10px] uppercase">Failed</div></div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="pt-6 border-t space-y-4 mt-6">
                                {errorCount > 0 && !jobState.isProcessing && !(jobState as any)._isQueued && (<Button size="sm" variant="outline" className="w-full text-red-600 border-red-200" onClick={handleRetryFailed}><RotateCcw className="mr-2 h-4 w-4" /> Load Failed ({errorCount})</Button>)}
                                <div className="space-y-3 pt-2">
                                    <div className="flex items-center justify-between"><Label className="text-xs font-bold text-muted-foreground uppercase">All Accounts ({eligibleProfilesCount})</Label><div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground">Concurrent Batch:</Label><Input type="number" min={1} max={100} value={masterBatchConcurrency} onChange={(e) => setMasterBatchConcurrency(Number(e.target.value))} className="w-16 h-7 text-xs" disabled={activeMasterJobs.totalProcessing > 0} /></div></div>
                                    <div className="flex gap-2">
                                        <Button size="sm" className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white" onClick={handleMasterBatchStart} disabled={activeMasterJobs.totalProcessing > 0 || eligibleProfilesCount === 0}><Zap className="h-4 w-4 mr-2" /> Start Master Blast</Button>
                                        <Button size="sm" variant="outline" className="flex-1" onClick={handleMasterPauseAll} disabled={activeMasterJobs.running === 0}><Pause className="h-4 w-4 mr-1" /> Pause All</Button>
                                        <Button size="sm" variant="outline" className="flex-1" onClick={handleMasterForceResume} disabled={activeMasterJobs.paused === 0}><Play className="h-4 w-4 mr-1" /> Resume All</Button>
                                        <Button size="sm" variant="destructive" className="flex-1" onClick={handleMasterStopAll} disabled={activeMasterJobs.totalProcessing === 0}><Square className="h-4 w-4 mr-1" /> End All</Button>
                                    </div>
                                    {(activeMasterJobs.totalProcessing > 0) && (<div className="flex items-center gap-6 text-xs font-medium pt-1"><span className="text-primary animate-pulse">Flowing: {activeMasterJobs.running}</span><span className="text-amber-600">Paused: {activeMasterJobs.paused}</span>{activeMasterJobs.queued > 0 && <span className="text-blue-500">Queued: {activeMasterJobs.queued}</span>}</div>)}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {((jobState as any)._isQueued || results.length > 0 || jobState.isProcessing) && (
                        <Card className="shadow-medium">
                            <CardHeader className="pb-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2"><BarChart3 className="h-5 w-5 text-primary" /><CardTitle className="text-lg">Webhook Results <span className="text-xs text-muted-foreground ml-2 font-normal">(Showing latest {Math.min(filteredResults.length, MAX_BUFFER_SIZE)} items)</span></CardTitle></div>
                                    <div className="flex items-center space-x-3 select-none">
                                        <Badge variant="outline" className={cn("cursor-pointer", statusFilter === 'all' ? "bg-primary text-primary-foreground" : "text-muted-foreground")} onClick={() => setStatusFilter('all')}>All: {results.length}</Badge>
                                        <Badge variant="outline" className={cn("bg-green-500/10 text-green-600 cursor-pointer border-transparent", statusFilter === 'success' && "ring-2 ring-green-500")} onClick={() => setStatusFilter(statusFilter === 'success' ? 'all' : 'success')}><CheckCircle2 className="h-3 w-3 mr-1" /> {results.filter(r => r.success && r.stage === 'complete').length} Success</Badge>
                                        <Badge variant="destructive" className={cn("bg-destructive/10 cursor-pointer border-transparent", statusFilter === 'error' && "ring-2 ring-destructive")} onClick={() => setStatusFilter(statusFilter === 'error' ? 'all' : 'error')}><XCircle className="h-3 w-3 mr-1" /> {results.filter(r => !r.success && r.stage === 'complete').length} Errors</Badge>
                                    </div>
                                </div>
                                <CardDescription>{jobState.isProcessing ? `Transmitting... ${completedCount} / ${jobState.totalToProcess} complete.` : (jobState as any)._isQueued ? <span className="text-amber-600 font-medium animate-pulse">⏳ Waiting in Engine Queue...</span> : `Completed.`}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {(jobState.isProcessing || (jobState as any)._isQueued) && (<div className="w-full bg-muted rounded-full h-2 mb-6"><div className={cn("h-2 rounded-full transition-all duration-300", jobState.isPaused ? "bg-amber-500" : "bg-primary")} style={{ width: `${progressPercent}%` }}/></div>)}
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Filter recent or search DB..." value={filterText} onChange={(e) => setFilterText(e.target.value)} className="pl-10 pr-24" /><Button size="sm" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 text-xs text-blue-600 font-bold hover:bg-blue-50" onClick={() => { setIsSearchingDB(true); socket?.emit('startBulkFlowJob', { isSearchRequest: true, selectedProfileName: activeProfileName, query: filterText }); }}>{isSearchingDB ? <Loader2 className="h-3 w-3 animate-spin"/> : "Search DB"}</Button></div>
                                        {dbSearchResults !== null && (<Button size="sm" variant="outline" className="text-red-500 border-red-200 bg-red-50 hover:bg-red-100 h-9" onClick={() => setDbSearchResults(null)}>Clear DB Search</Button>)}
                                        <div className="text-sm text-muted-foreground font-medium whitespace-nowrap">Found: {activeResultsList.length}</div>
                                    </div>
                                    <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => { const content = filteredResults.map(r => `${r.identifier} - ${r.success ? 'Success' : 'Error'} - ${r.details}`).join('\n'); const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `flow_results.txt`; document.body.appendChild(link); link.click(); document.body.removeChild(link); }}><FileText className="h-4 w-4 mr-2"/> Export (Recent)</Button><Button variant="default" size="sm" onClick={() => { setIsExporting(true); socket?.emit('startBulkFlowJob', { isExportRequest: true, selectedProfileName: activeProfileName }); }} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">{isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <Database className="h-4 w-4 mr-2"/>} Export Entire DB</Button></div>
                                </div>
                                <ScrollArea className="h-[550px] w-full rounded-lg border">
                                    <table className="w-full">
                                        <thead className="bg-muted/50 sticky top-0 z-10"><tr><th className="p-3 text-left text-xs font-medium text-muted-foreground w-16">Row #</th><th className="p-3 text-left text-xs font-medium text-muted-foreground">Identifier</th><th className="p-3 text-left text-xs font-medium text-muted-foreground">Status / Details</th><th className="p-3 text-center text-xs font-medium text-muted-foreground uppercase w-24">Time</th><th className="p-3 text-center text-xs font-medium text-muted-foreground w-24">Result</th></tr></thead>
                                        <tbody className="bg-card divide-y divide-border">
                                            {(jobState as any)._isQueued ? (<tr><td colSpan={5} className="p-8 text-center text-amber-600 font-medium">Waiting for previous accounts to finish before starting...</td></tr>) : paginatedResults.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No results.</td></tr>) : (paginatedResults.map((result: any) => (
                                                <tr key={result.rowNumber} className={cn("transition-colors duration-300", result.stage === 'complete' && !result.success ? 'bg-destructive/5' : '')}>
                                                    <td className="p-3 text-sm font-mono text-center text-muted-foreground">{result.rowNumber}</td>
                                                    <td className="p-3 text-sm font-mono">{result.identifier}</td>
                                                    <td className={cn("p-3 text-sm font-medium", result.stage === 'complete' && !result.success ? 'text-destructive' : 'text-muted-foreground')}>{result.details}</td>
                                                    <td className="px-4 py-2 text-sm text-center font-mono"><div className="flex flex-col items-center justify-center"><span className="text-blue-600 dark:text-blue-400 font-bold text-xs">{result.time}</span><span className="text-muted-foreground text-[11px]">{formatExactTime(result.timestamp)}</span></div></td>
                                                    <td className="p-3 text-center">
                                                        <Dialog>
                                                            <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-8 px-3 border shadow-sm transition-all hover:scale-105">{result.success ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />}<Eye className="h-3 w-3 text-muted-foreground ml-2" /></Button></DialogTrigger>
                                                            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col"><DialogHeader><DialogTitle>Raw Server Response</DialogTitle></DialogHeader><ScrollArea className="flex-1 mt-2 rounded-md bg-zinc-950 p-4"><pre className="text-xs font-mono text-green-400">{JSON.stringify(result.response || result.fullResponse || { status: "No response body recorded." }, null, 2)}</pre></ScrollArea></DialogContent>
                                                        </Dialog>
                                                    </td>
                                                </tr>
                                            )))}
                                        </tbody>
                                    </table>
                                </ScrollArea>
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between py-4 border-t mt-4">
                                        <div className="text-xs text-muted-foreground">Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, activeResultsList.length)} of {activeResultsList.length} entries</div>
                                        <div className="flex items-center space-x-2">
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}><ChevronsLeft className="h-4 w-4" /></Button>
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                                            <div className="text-sm font-medium mx-2">Page {currentPage} of {totalPages}</div>
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}><ChevronRight className="h-4 w-4" /></Button>
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}><ChevronsRight className="h-4 w-4" /></Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </DashboardLayout>

            <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
                <DialogContent><DialogHeader><DialogTitle>Webhook Connection Status</DialogTitle></DialogHeader><div className="p-4 rounded-md border bg-green-50/50 border-green-200"><p className="font-bold text-lg flex items-center gap-2 text-green-700"><CheckCircle2 className="h-5 w-5" /> Ready</p></div></DialogContent>
            </Dialog>

            <FlowCustomModuleApplyAllModal 
                isOpen={isApplyAllModalOpen} 
                onClose={() => setIsApplyAllModalOpen(false)} 
                onApply={handleApplyAll} 
                profiles={flowProfiles} 
                initialData={{ 
                    bulkData: formData.bulkData, 
                    staticData: formData.staticData || {}, 
                    delay: formData.delay || 0, 
                    concurrency: formData.concurrency || 1, 
                    stopAfterFailures: (formData as any).stopAfterFailures || 0, 
                    trackingEnabled: trackingEnabled, 
                    targetHtmlField: targetHtmlField,
                    appendAccountName: (formData as any).appendAccountName || false 
                }} 
            />
        </>
    );
};

export default FlowCustomModule;