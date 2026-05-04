// --- FILE: src/pages/CustomModuleBulk.tsx ---
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { cn, formatTime } from '@/lib/utils';
import { Socket } from 'socket.io-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Profile, CustomModuleJobs, CustomModuleJobState, CustomModuleFormData } from '@/App';
import { 
    Loader2, Database, Play, Pause, Square, CheckCircle2, XCircle, AlertCircle, 
    Search, FileText, BarChart3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, 
    Eye, AlertOctagon, RotateCcw, Trash2, AlertTriangle, RefreshCw, CopyCheck
} from 'lucide-react';
import { CustomModuleApplyAllModal } from '@/components/dashboard/CustomModuleApplyAllModal';

const SERVER_URL = "http://localhost:3009";
const ITEMS_PER_PAGE = 10;
const MAX_BUFFER_SIZE = 500; 

const globalFieldsCache: Record<string, any[]> = {};

interface CustomModuleBulkProps {
    jobs: CustomModuleJobs;
    setJobs: React.Dispatch<React.SetStateAction<CustomModuleJobs>>;
    socket: Socket | null;
    createInitialJobState: () => CustomModuleJobState;
    onAddProfile: () => void;
    onEditProfile: (profile: Profile) => void;
    onDeleteProfile: (profileName: string) => void;
    isWiping?: boolean;
    wipeProgress?: string;
}

const CustomModuleBulk: React.FC<CustomModuleBulkProps> = ({ 
    jobs, setJobs, socket, createInitialJobState, onAddProfile, onEditProfile, onDeleteProfile,
    isWiping, wipeProgress
}) => {
    const { toast } = useToast();
    
    const [activeProfileName, setActiveProfileName] = useState<string | null>(() => {
        return localStorage.getItem('inventoryCustomModuleActiveProfile') || null;
    });

    const [isFetchingFields, setIsFetchingFields] = useState(false);
    const fetchRef = useRef(false); 
    
    const [isStartingBatch, setIsStartingBatch] = useState(false); 
    const [isDbSynced, setIsDbSynced] = useState(false); 
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    
    const [dbSearchResults, setDbSearchResults] = useState<any[] | null>(null);
    const [isSearchingDB, setIsSearchingDB] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    
    const [isApplyAllModalOpen, setIsApplyAllModalOpen] = useState(false);
    
    const [masterBatchConcurrency, setMasterBatchConcurrency] = useState(() => {
        return Number(localStorage.getItem('invMasterBatchConcurrency')) || 1;
    });
    
    const [filterText, setFilterText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
    const [currentPage, setCurrentPage] = useState(1);

    const [apiStatus, setApiStatus] = useState<{ status: 'loading' | 'success' | 'error', message: string, fullResponse?: any }>({
        status: 'loading', message: 'Checking connection...'
    });

    const resultBufferRef = useRef<any[]>([]);

    const { data: profiles = [] } = useQuery<Profile[]>({
        queryKey: ['profiles'],
        queryFn: async () => {
            const res = await fetch(`${SERVER_URL}/api/profiles`);
            if (!res.ok) throw new Error("Failed to fetch profiles");
            return res.json();
        },
    });

    const inventoryProfiles = useMemo(() => {
        return profiles.filter(p => p.inventory?.orgId && p.inventory.orgId.trim() !== '');
    }, [profiles]);
    
    useEffect(() => {
        if (activeProfileName) localStorage.setItem('inventoryCustomModuleActiveProfile', activeProfileName);
        localStorage.setItem('invMasterBatchConcurrency', masterBatchConcurrency.toString());
    }, [activeProfileName, masterBatchConcurrency]);

    useEffect(() => {
        try {
            const savedForms = localStorage.getItem('inventoryCustomModuleForms_v1');
            if (savedForms) {
                const parsed = JSON.parse(savedForms);
                setJobs(prev => {
                    const next = { ...prev };
                    let hasChanges = false;
                    Object.keys(parsed).forEach(profileName => {
                        const existingJob = next[profileName] || createInitialJobState();
                        const savedData = parsed[profileName];
                        next[profileName] = { 
                            ...existingJob, 
                            formData: { ...existingJob.formData, ...savedData },
                            processingStartTime: savedData._savedStartTime ? new Date(savedData._savedStartTime) : existingJob.processingStartTime,
                            processingTime: savedData._savedProcessingTime || existingJob.processingTime
                        };
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
                if (jobs[profileName]?.formData) { 
                    formsToSave[profileName] = {
                        ...jobs[profileName].formData,
                        _savedStartTime: jobs[profileName].processingStartTime,
                        _savedProcessingTime: jobs[profileName].processingTime
                    }; 
                    hasData = true; 
                }
            });
            if (hasData) localStorage.setItem('inventoryCustomModuleForms_v1', JSON.stringify(formsToSave));
        } catch (error) {}
    }, [jobs]);

    useEffect(() => {
        if (inventoryProfiles.length > 0 && !activeProfileName) {
            setActiveProfileName(inventoryProfiles[0].profileName);
        } else if (activeProfileName && !inventoryProfiles.find(p => p.profileName === activeProfileName)) {
            setActiveProfileName(inventoryProfiles.length > 0 ? inventoryProfiles[0].profileName : null);
        }
    }, [inventoryProfiles, activeProfileName]);

    const selectedProfile = useMemo(() => {
        return inventoryProfiles.find(p => p.profileName === activeProfileName) || null;
    }, [inventoryProfiles, activeProfileName]);  

    useEffect(() => {
        if (!socket || !activeProfileName) { setApiStatus({ status: 'loading', message: 'Waiting for profile...' }); return; }
        setApiStatus({ status: 'loading', message: 'Connecting to Zoho...' });
        socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'inventory' });

        const handleStatus = (res: any) => {
            if (res.success) setApiStatus({ status: 'success', message: `Connected: ${res.fullResponse?.orgName}`, fullResponse: res.fullResponse });
            else setApiStatus({ status: 'error', message: res.message || 'Connection Failed' });
        };
        
        socket.on('apiStatusResult', handleStatus);
        return () => { socket.off('apiStatusResult', handleStatus); };
    }, [socket, activeProfileName]);

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
                        const pName = r.profileName || activeProfileName;
                        if (!pName) return;
                        if (!grouped[pName]) grouped[pName] = [];
                        grouped[pName].push(r);
                    });

                    Object.keys(grouped).forEach(profileName => {
                        const currentJob = next[profileName];
                        if (!currentJob) return;

                        let newResults = [...currentJob.results];
                        let newProcessed = currentJob.processedCount || 0;
                        let newSuccess = currentJob.successCount || 0;
                        let newError = currentJob.errorCount || 0;

                        grouped[profileName].forEach(result => {
                            const existingIndex = newResults.findIndex(r => r.rowNumber === result.rowNumber);
                            
                            // 🛠️ THE FIX: Trust the 1-second buffer to count smoothly!
                            if (result.stage === 'complete') {
                                newProcessed++;
                                if (result.success) newSuccess++;
                                else newError++;
                            }
                            
                            if (existingIndex >= 0) newResults[existingIndex] = { ...newResults[existingIndex], ...result };
                            else newResults.unshift(result);
                        });

                        if (newResults.length > MAX_BUFFER_SIZE) {
                            newResults = newResults.sort((a, b) => (b.rowNumber || 0) - (a.rowNumber || 0)).slice(0, MAX_BUFFER_SIZE);
                        }

                        const isDone = newProcessed >= currentJob.totalToProcess && currentJob.totalToProcess > 0;

                        next[profileName] = {
                            ...currentJob,
                            results: newResults,
                            processedCount: newProcessed,
                            successCount: newSuccess,
                            errorCount: newError,
                            _ignition: true,
                            _isQueued: false,
                            isProcessing: isDone ? false : currentJob.isProcessing,
                            isComplete: isDone,
                            isPaused: isDone ? false : currentJob.isPaused
                        };
                        changed = true;
                    });

                    return changed ? next : prev;
                });
            }
        }, 1000); 

        return () => clearInterval(interval);
    }, [setJobs, activeProfileName]);

    useEffect(() => {
        if (!socket) return;
        socket.emit('requestDatabaseSync');
        const heartbeat = setInterval(() => { socket.emit('requestDatabaseSync'); }, 2500);
        return () => clearInterval(heartbeat);
    }, [socket]); 

    useEffect(() => {
        if (!socket) return;

        const handleSync = (allJobs: any[]) => {
            setJobs(prev => {
                const next = { ...prev };
                let hasChanges = false;

                Object.keys(next).forEach(profileName => {
                    const memoryJob = next[profileName];
                    if (memoryJob.isProcessing || memoryJob.results.length > 0 || memoryJob.totalToProcess > 0) {
                        const profileConfig = inventoryProfiles.find(p => p.profileName === profileName);
                        const actualModName = memoryJob.formData?.moduleApiName || profileConfig?.inventory?.customModuleApiName;
                        
                        if (actualModName) {
                            const expectedJobId = `inv_${actualModName}_${profileName}`;
                            const existsInDb = allJobs.some(dbJob => 
                                dbJob.id === expectedJobId || 
                                (dbJob.profileName === profileName && dbJob.jobType === `inv_${actualModName}`)
                            );
                            if (!existsInDb) {
                                next[profileName] = { 
                                    ...memoryJob, results: [], totalToProcess: 0, isProcessing: false, 
                                    isPaused: false, isComplete: false, processedCount: 0, successCount: 0, 
                                    errorCount: 0, _forceStopped: true, _isQueued: false 
                                } as any;
                                hasChanges = true;
                            }
                        }
                    }
                });

                allJobs.forEach(dbJob => {
                    // 🛠️ THE FIX: Check both casing styles from Postgres!
                    const jt = dbJob.jobType || dbJob.jobtype;
                    if (!jt || !jt.startsWith('inv_')) return;
                    
                    const rawModule = jt.replace(/^inv_/, '');
                    const profileName = dbJob.profileName || dbJob.profilename;
                    if (!profileName) return;

                    const existingJob = next[profileName] || createInitialJobState();
                    const profileConfig = inventoryProfiles.find(p => p.profileName === profileName);
                    const validModule = existingJob.formData?.moduleApiName || profileConfig?.inventory?.customModuleApiName || rawModule;
                    
                    if (validModule && rawModule === validModule) {
                        if ((existingJob as any)._isQueued) return; 
                        if (existingJob.isProcessing && (existingJob as any)._ignition === false) return; 
                        
                        const dbProcessed = parseInt(dbJob.processedCount || dbJob.processedcount || '0', 10);
                        const dbSuccess = parseInt(dbJob.successCount || dbJob.successcount || '0', 10);
                        const dbError = parseInt(dbJob.errorCount || dbJob.errorcount || '0', 10);
                        const newTotal = parseInt(dbJob.totalToProcess || dbJob.totaltoprocess || existingJob.totalToProcess || '0', 10);
                        
                        const newProcessedSafe = Math.max(Number(existingJob.processedCount) || 0, dbProcessed);
                        const newSuccessSafe = Math.max(Number(existingJob.successCount) || 0, dbSuccess);
                        const newErrorSafe = Math.max(Number(existingJob.errorCount) || 0, dbError);
                        
                        const dbStatus = dbJob.status || 'stopped';
                        const isDone = newProcessedSafe >= newTotal && newTotal > 0;
                        
                        let backendIsProcessing = (dbStatus === 'running' || dbStatus === 'paused');
                        let backendIsPaused = (dbStatus === 'paused' || dbStatus === 'paused_queued');
                        let backendIsQueued = (dbStatus === 'queued' || dbStatus === 'paused_queued');

                        if (isDone || (existingJob as any)._forceStopped) {
                            backendIsProcessing = false;
                            backendIsPaused = false;
                        } else if ((existingJob as any)._forcePaused && !isDone && !backendIsQueued) {
                            backendIsPaused = true;
                            backendIsProcessing = true;
                        }

                        let mergedResults = [...(existingJob.results || [])];
                        if (dbJob.results && Array.isArray(dbJob.results)) {
                            dbJob.results.forEach(dbResult => {
                                const idx = mergedResults.findIndex(r => r.rowNumber === dbResult.rowNumber);
                                if (idx === -1) mergedResults.push(dbResult);
                                else mergedResults[idx] = { ...mergedResults[idx], ...dbResult };
                            });
                            mergedResults.sort((a, b) => {
                                const numA = a.rowNumber || a.fallbackRowNumber || 0;
                                const numB = b.rowNumber || b.fallbackRowNumber || 0;
                                return numB - numA; 
                            });
                            mergedResults = mergedResults.slice(0, MAX_BUFFER_SIZE);
                        }

                        // 🔥 PERFECT SYNC: RECOVER ALL FORM DATA FROM POSTGRES DB
                        let restoredFormData = existingJob.formData;
                        if (dbJob.formdata || dbJob.formData) {
                            let parsed = dbJob.formdata || dbJob.formData;
                            if (typeof parsed === 'string') {
                                try { parsed = JSON.parse(parsed); } catch(e){}
                            }
                            if (parsed && typeof parsed === 'object') {
                                restoredFormData = { ...existingJob.formData, ...parsed, moduleApiName: validModule };
                            }
                        } else {
                            restoredFormData = { ...existingJob.formData, moduleApiName: validModule };
                        }

                        // 🔥 PERFECT SYNC: RECOVER EXACT ELAPSED TIME (WITH TIMEZONE FIX)
                        let currentProcessingTime = existingJob.processingTime || 0;
                        let startTime = dbJob.processingstarttime || dbJob.processingStartTime;
                        
                        if (currentProcessingTime === 0 && startTime && backendIsProcessing && !backendIsPaused) {
                            const startTimestamp = new Date(startTime).getTime();
                            let elapsedSeconds = Math.floor((Date.now() - startTimestamp) / 1000);
                            
                            const offsetSeconds = new Date().getTimezoneOffset() * 60;
                            elapsedSeconds += offsetSeconds;
                            
                            if (elapsedSeconds < 0) elapsedSeconds = 0;
                            currentProcessingTime = elapsedSeconds;
                        }

                        if (
                            existingJob.processedCount !== newProcessedSafe ||
                            existingJob.totalToProcess !== newTotal ||
                            existingJob.isProcessing !== backendIsProcessing ||
                            existingJob.isPaused !== backendIsPaused ||
                            existingJob.formData?.moduleApiName !== validModule ||
                            JSON.stringify(existingJob.results?.slice(0, 3)) !== JSON.stringify(mergedResults.slice(0, 3))
                        ) {
                            next[profileName] = {
                                ...existingJob,
                                formData: restoredFormData,             // RESTORES UI INPUTS
                                isProcessing: backendIsProcessing,
                                isPaused: backendIsPaused,
                                _isQueued: backendIsQueued, 
                                isComplete: isDone,
                                _forceStopped: isDone, 
                                totalToProcess: newTotal,
                                results: mergedResults,
                                processedCount: newProcessedSafe,
                                successCount: newSuccessSafe,
                                errorCount: newErrorSafe,
                                processingStartTime: startTime ? new Date(startTime) : existingJob.processingStartTime,
                                processingTime: currentProcessingTime   // RESTORES TIMER
                            };
                            hasChanges = true;
                        }
                    }
                });
                return hasChanges ? next : prev;
            });
            setIsDbSynced(true);
        };

        const handleBufferedResult = (result: any) => { resultBufferRef.current.push(result); };

        const handleJobStarted = (data: any) => {
            if (!data.jobType?.startsWith('inv_')) return;
            const rawModule = data.jobType.replace(/^inv_/, '');
            setJobs(prev => {
                const profileJob = prev[data.profileName] || createInitialJobState();
                return { ...prev, [data.profileName]: { ...profileJob, formData: { ...profileJob.formData, moduleApiName: rawModule }, _isQueued: false, isProcessing: true, processingStartTime: new Date() } as any };
            });
        };

        const handleJobPaused = (data: any) => {
            if (!data.jobType?.startsWith('inv_')) return;
            const rawModule = data.jobType.replace(/^inv_/, '');
            setJobs(prev => {
                const profileJob = prev[data.profileName] || createInitialJobState();
                const isQueued = !!(profileJob as any)._isQueued;
                return { ...prev, [data.profileName]: { ...profileJob, formData: { ...profileJob.formData, moduleApiName: rawModule }, isPaused: true, isProcessing: !isQueued } };
            });
        };

        const handleJobResumed = (data: any) => {
            if (!data.jobType?.startsWith('inv_')) return;
            const rawModule = data.jobType.replace(/^inv_/, '');
            setJobs(prev => {
                const profileJob = prev[data.profileName] || createInitialJobState();
                const isQueued = !!(profileJob as any)._isQueued;
                return { ...prev, [data.profileName]: { ...profileJob, formData: { ...profileJob.formData, moduleApiName: rawModule }, isPaused: false, isProcessing: !isQueued } };
            });
        };

        const handleBulkEnded = (data: any) => {
            if (!data.jobType?.startsWith('inv_')) return;
            const rawModule = data.jobType.replace(/^inv_/, '');
            setJobs(prev => {
                const profileJob = prev[data.profileName] || createInitialJobState();
                return { ...prev, [data.profileName]: { ...profileJob, formData: { ...profileJob.formData, moduleApiName: rawModule }, isProcessing: false, isPaused: false, isComplete: true, _forceStopped: true, _isQueued: false } as any };
            });
        };

        const handleJobCleared = (data: any) => {
            if (!data.jobType?.startsWith('inv_')) return;
            const rawModule = data.jobType.replace(/^inv_/, '');
            setJobs(prev => {
                const profileJob = prev[data.profileName] || createInitialJobState();
                return { ...prev, [data.profileName]: { ...profileJob, formData: { ...profileJob.formData, moduleApiName: rawModule, bulkData: '' }, results: [], totalToProcess: 0, isProcessing: false, isPaused: false, isComplete: false, processedCount: 0, successCount: 0, errorCount: 0, _forceStopped: true, _isQueued: false } as any };
            });
            toast({ title: "Database Wiped", description: `All data cleared for ${data.profileName}` });
        };

        socket.on('databaseSync', handleSync);
        socket.on('customModuleResult', handleBufferedResult); 
        socket.on('jobStarted', handleJobStarted);
        socket.on('jobPaused', handleJobPaused);
        socket.on('jobResumed', handleJobResumed);
        socket.on('bulkEnded', handleBulkEnded);
        socket.on('bulkComplete', handleBulkEnded);
        socket.on('jobCleared', handleJobCleared);

        return () => {
            socket.off('databaseSync', handleSync);
            socket.off('customModuleResult', handleBufferedResult);
            socket.off('jobStarted', handleJobStarted);
            socket.off('jobPaused', handleJobPaused);
            socket.off('jobResumed', handleJobResumed);
            socket.off('bulkEnded', handleBulkEnded);
            socket.off('bulkComplete', handleBulkEnded);
            socket.off('jobCleared', handleJobCleared);
        };
    }, [socket, setJobs, createInitialJobState]);

    useEffect(() => {
        const timer = setInterval(() => {
            setJobs(prev => {
                let changed = false;
                const next = { ...prev };
                const clientNow = Date.now();
                
                Object.keys(next).forEach(profileName => {
                    const job = next[profileName];
                    
                    if (job && job.isProcessing && !job.isPaused && job.processingStartTime) {
                        const startMs = new Date(job.processingStartTime).getTime();
                        
                        if (!isNaN(startMs)) {
                            let calcTime = Math.floor((clientNow - startMs) / 1000);
                            if (calcTime > 1800 && calcTime > ((job.processedCount || 0) * 15 + 120)) {
                                const offsetSecs = new Date().getTimezoneOffset() * 60;
                                calcTime += offsetSecs;
                            }
                            const finalTime = Math.max(0, calcTime);
                            
                            if (job.processingTime !== finalTime) {
                                next[profileName] = { ...job, processingTime: finalTime };
                                changed = true;
                            }
                        }
                    }
                });
                
                return changed ? next : prev;
            });
        }, 1000);
        
        return () => clearInterval(timer);
    }, [setJobs]);

    useEffect(() => {
        if (!socket || !activeProfileName || !selectedProfile) return;
        const expectedJobType = selectedProfile.inventory?.customModuleApiName;
        if (!expectedJobType) return;

        const handleDatabaseSearchResults = (data: any) => {
            if (data.profileName === activeProfileName) {
                setIsSearchingDB(false);
                setDbSearchResults(data.results);
                toast({ title: "Database Search Complete", description: `Found ${data.results.length} items.` });
            }
        };

        const handleFullExportData = (data: any) => {
            if (data.profileName === activeProfileName) {
                setIsExporting(false);
                const content = data.results.map((r:any) => `${r.identifier} - ${r.success ? 'Success' : 'Error'} - ${r.details}`).join('\n'); 
                const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' }); 
                const link = document.createElement("a"); 
                const url = URL.createObjectURL(blob); 
                link.setAttribute("href", url); 
                link.setAttribute("download", `FULL_EXPORT_${activeProfileName}_${new Date().toISOString().slice(0,10)}.txt`); 
                link.style.visibility = 'hidden'; 
                document.body.appendChild(link); 
                link.click(); 
                document.body.removeChild(link);
                toast({ title: "Export Complete", description: `Successfully downloaded ${data.results.length} records.` });
            }
        };

        const handleFieldsResult = (res: any) => {
            const profileToUpdate = res.profileName || res.selectedProfileName || activeProfileName;
            const targetProfileObj = inventoryProfiles.find(p => p.profileName === profileToUpdate);
            
            const fieldsReceived = res.fields || res.data || res.moduleFields;
            
            if (res.success && fieldsReceived && fieldsReceived.length > 0) {
                if (profileToUpdate === activeProfileName && !isStartingBatch) {
                    setIsFetchingFields(false);
                    fetchRef.current = false; 
                    toast({ title: "Fields Loaded", description: `Successfully loaded ${fieldsReceived.length} fields.` });
                }
                
                setJobs(prev => {
                    const currentJob = prev[profileToUpdate!] || createInitialJobState();
                    const moduleApiName = currentJob.formData.moduleApiName || targetProfileObj?.inventory?.customModuleApiName;
                    
                    if (moduleApiName && profileToUpdate) { 
                        globalFieldsCache[`inv_${profileToUpdate}_${moduleApiName}`] = fieldsReceived; 
                    }

                    let newStaticData = { ...currentJob.formData.staticData };
                    let newBulkField = currentJob.formData.bulkField || '';
                    let newTargetHtml = (currentJob.formData as any).targetHtmlField || '';
                    let sourceFields = (currentJob.formData as any).crossProfileSourceFields;
                    
                    if (sourceFields && sourceFields.length > 0) {
                        const { mappedStatic, mappedBulk, mappedTargetHtml } = performSmartMapping(sourceFields, fieldsReceived, newStaticData, newBulkField, newTargetHtml);
                        newStaticData = mappedStatic; newBulkField = mappedBulk; newTargetHtml = mappedTargetHtml; sourceFields = undefined; 
                    } else if (!newBulkField) {
                        const emailField = fieldsReceived.find((f: any) => f.data_type === 'email' || f?.api_name?.toLowerCase().includes('email') || f?.label?.toLowerCase().includes('email'));
                        if (emailField) newBulkField = emailField.api_name;
                    }

                    return { ...prev, [profileToUpdate!]: { ...currentJob, formData: { ...currentJob.formData, availableFields: fieldsReceived, bulkField: newBulkField, staticData: newStaticData, targetHtmlField: newTargetHtml, crossProfileSourceFields: sourceFields } as any } };
                });
            } else {
                const failedModuleApiName = targetProfileObj?.inventory?.customModuleApiName;
                if (failedModuleApiName && profileToUpdate) {
                    globalFieldsCache[`inv_${profileToUpdate}_${failedModuleApiName}`] = []; 
                }

                if (profileToUpdate === activeProfileName && !isStartingBatch) {
                    setIsFetchingFields(false);
                    fetchRef.current = false; 
                    const errorMsg = res.message || res.error || "Unknown error from Zoho API.";
                    const details = res.details ? ` \nDetails: ${res.details}` : '';
                    
                    toast({ 
                        title: "Zoho API Rejected Request", 
                        description: errorMsg + details, 
                        variant: "destructive",
                        duration: 8000 
                    });
                }
            }
        };

        const handleAllJobsCleared = (data: any) => {
            if (data.jobType && data.jobType.startsWith('inv_cm_')) {
                setJobs(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach(profile => {
                        next[profile] = { 
                            ...next[profile], results: [], totalToProcess: 0, isProcessing: false, 
                            isPaused: false, isComplete: false, 
                            formData: { ...next[profile].formData, bulkData: '', staticData: {} }, 
                            processedCount: 0, successCount: 0, errorCount: 0, 
                            _forceStopped: true, _isQueued: false 
                        } as any;
                    });
                    return next;
                });
                toast({ title: "Master Wipe Complete", description: `All Custom Module databases wiped.` });
            } 
            else if (data.jobType === `inv_${expectedJobType}`) {
                setJobs(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach(profile => {
                        if (next[profile].formData?.moduleApiName === expectedJobType) {
                            next[profile] = { ...next[profile], results: [], totalToProcess: 0, isProcessing: false, isPaused: false, isComplete: false, formData: { ...next[profile].formData, bulkData: '', staticData: {} }, processedCount: 0, successCount: 0, errorCount: 0, _forceStopped: true, _isQueued: false } as any;
                        }
                    });
                    return next;
                });
                toast({ title: "Master Wipe Complete", description: `All databases wiped for ${data.jobType}.` });
            }
        };

        socket.on('databaseSearchResults', handleDatabaseSearchResults);
        socket.on('fullExportData', handleFullExportData);
        socket.on('allJobsCleared', handleAllJobsCleared);
        
        socket.on('fetchModuleFieldsResult', handleFieldsResult);
        socket.on('customModuleFieldsResult', handleFieldsResult);
        socket.on('moduleFieldsResult', handleFieldsResult);

        return () => {
            socket.off('databaseSearchResults', handleDatabaseSearchResults);
            socket.off('fullExportData', handleFullExportData);
            socket.off('allJobsCleared', handleAllJobsCleared);
            socket.off('fetchModuleFieldsResult', handleFieldsResult);
            socket.off('customModuleFieldsResult', handleFieldsResult);
            socket.off('moduleFieldsResult', handleFieldsResult);
        };
    }, [socket, activeProfileName, selectedProfile, setJobs, createInitialJobState, isStartingBatch, inventoryProfiles]);

    const updateFormData = (updates: Partial<CustomModuleFormData> | any) => {
        if (!activeProfileName) return;
        setJobs(prev => {
            const currentJob = prev[activeProfileName] || createInitialJobState();
            return { ...prev, [activeProfileName]: { ...currentJob, formData: { ...currentJob.formData, ...updates } } };
        });
    };

    const performSmartMapping = (sourceFields: any[], targetFields: any[], sourceStatic: any, sourceBulk: string, sourceHtml: string) => {
        const getLabel = (field: any) => { let label = field.label || field.api_name || ''; if (label.includes('_') || label.startsWith('cf_')) { label = label.replace(/^cf_/, '').replace(/_/g, ' '); label = label.replace(/\b\w/g, (char: string) => char.toUpperCase()); } return label; };
        const normalize = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        const findMatch = (apiName: string) => {
            if (!apiName) return null; 
            if (targetFields.find((f:any) => f.api_name === apiName)) return apiName;
            const sf = sourceFields.find((f:any) => f.api_name === apiName);
            if (!sf) return null; 
            const normSrc = normalize(getLabel(sf));
            let match = targetFields.find((f:any) => normalize(getLabel(f)) === normSrc);
            if (match) return match.api_name;
            match = targetFields.find((f:any) => { const normTgt = normalize(getLabel(f)); return (normTgt.includes(normSrc) || normSrc.includes(normTgt)) && f.data_type === sf.data_type; });
            if (match) return match.api_name;
            const sourceOfSameType = sourceFields.filter((f:any) => f.data_type === sf.data_type);
            const targetOfSameType = targetFields.filter((f:any) => f.data_type === sf.data_type);
            const typeIndex = sourceOfSameType.findIndex((f:any) => f.api_name === apiName);
            if (typeIndex >= 0 && targetOfSameType[typeIndex]) return targetOfSameType[typeIndex].api_name;
            return null; 
        };

        const mappedStatic: Record<string, string> = {};
        for (const [k, v] of Object.entries(sourceStatic || {})) { const match = findMatch(k); if (match) mappedStatic[match] = v as string; }
        return { mappedStatic, mappedBulk: findMatch(sourceBulk) || '', mappedTargetHtml: findMatch(sourceHtml) || '' };
    };

    const handleFetchFields = (forceUpdate = false) => {
        if (!selectedProfile || !socket || !activeProfileName) return;
        const moduleName = selectedProfile.inventory?.customModuleApiName;
        
        if (!moduleName || moduleName.trim() === 'cm_' || moduleName.trim() === '') return;

        if (fetchRef.current && !forceUpdate) return;
        fetchRef.current = true; 

        const cacheKey = `inv_${activeProfileName}_${moduleName}`;
        if (forceUpdate) delete globalFieldsCache[cacheKey];

        setIsFetchingFields(true);
        socket.emit('fetchModuleFields', { selectedProfileName: selectedProfile.profileName, moduleApiName: moduleName });

        setTimeout(() => {
            setIsFetchingFields(prev => {
                if (prev) {
                    toast({ title: "Fetch Timeout", description: "No response from server.", variant: "destructive" });
                    globalFieldsCache[`inv_${activeProfileName}_${moduleName}`] = []; 
                    fetchRef.current = false; 
                    return false;
                }
                return prev;
            });
        }, 10000);
    };

    const handleClearJob = () => { if (!activeProfileName || !formData.moduleApiName || !socket) return; if (window.confirm(`⚠️ Are you sure you want to completely WIPE all data for ${activeProfileName}?`)) { socket.emit('clearJob', { profileName: activeProfileName, jobType: `inv_${formData.moduleApiName}` }); } };
    const handleClearAllJobs = () => { 
        if (!socket) return; 
        if (window.confirm(`🚨 DANGER: Are you sure you want to completely WIPE ALL databases for EVERY profile on Inventory Custom Modules?`)) { 
            
            // 🛠️ THE FIX: Emit the true Nuclear Master Wipe command
            socket.emit('clearAllJobs', { jobType: 'inv_MASTER_WIPE' }); 
            
            setJobs(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(profile => {
                    next[profile] = { 
                        ...next[profile], results: [], totalToProcess: 0, isProcessing: false, isPaused: false, isComplete: false, 
                        formData: { ...next[profile].formData, bulkData: '' }, processedCount: 0, successCount: 0, errorCount: 0, 
                        _forceStopped: true, _isQueued: false 
                    } as any;
                });
                return next;
            });
            toast({ title: "Master Wipe Initiated", description: "All Inventory Custom Modules are being obliterated." });
        } 
    };

    const jobStateRaw = (activeProfileName && jobs[activeProfileName]) ? jobs[activeProfileName] : createInitialJobState();
    const jobState = { ...jobStateRaw, formData: { ...jobStateRaw.formData } };
    const expectedModule = selectedProfile?.inventory?.customModuleApiName;
    const cacheKey = activeProfileName && expectedModule ? `inv_${activeProfileName}_${expectedModule}` : '';
    
    if (cacheKey && globalFieldsCache[cacheKey] && globalFieldsCache[cacheKey].length > 0) {
        if (!jobState.formData.availableFields || jobState.formData.availableFields.length === 0) {
            jobState.formData.availableFields = globalFieldsCache[cacheKey];
            if (!jobState.formData.bulkField) {
                const emailField = globalFieldsCache[cacheKey].find((f: any) => f.data_type === 'email' || f?.api_name?.toLowerCase().includes('email') || f?.label?.toLowerCase().includes('email'));
                if (emailField) jobState.formData.bulkField = emailField.api_name;
            }
        }
    }

    const { formData, results } = jobState;

    useEffect(() => {
        if (!isDbSynced || !selectedProfile || !socket || !activeProfileName || isStartingBatch) return;
        const moduleName = selectedProfile.inventory?.customModuleApiName;
        
        if (moduleName && moduleName.trim() !== 'cm_') {
            if (formData.moduleApiName !== moduleName) updateFormData({ moduleApiName: moduleName });
            
            const trueStateFields = jobs[activeProfileName]?.formData?.availableFields || [];
            const currentCacheKey = `inv_${activeProfileName}_${moduleName}`;
            const cachedData = globalFieldsCache[currentCacheKey];

            if (cachedData !== undefined) {
                if (cachedData.length > 0 && (!trueStateFields || trueStateFields.length === 0)) {
                    let newBulkField = formData.bulkField || '';
                    let newStaticData = { ...formData.staticData };
                    let newTargetHtml = (formData as any).targetHtmlField || '';

                    const sourceFields = (formData as any).crossProfileSourceFields;
                    if (sourceFields && sourceFields.length > 0) {
                        const { mappedStatic, mappedBulk, mappedTargetHtml } = performSmartMapping(sourceFields, cachedData, newStaticData, newBulkField, newTargetHtml);
                        newStaticData = mappedStatic; newBulkField = mappedBulk; newTargetHtml = mappedTargetHtml;
                    } else if (!newBulkField) {
                        const emailField = cachedData.find((f: any) => f.data_type === 'email' || f?.api_name?.toLowerCase().includes('email') || f?.label?.toLowerCase().includes('email'));
                        if (emailField) newBulkField = emailField.api_name;
                    }

                    updateFormData({ availableFields: cachedData, bulkField: newBulkField, staticData: newStaticData, targetHtmlField: newTargetHtml, crossProfileSourceFields: undefined });
                }
            } else if ((!trueStateFields || trueStateFields.length === 0) && !isFetchingFields) {
                handleFetchFields();
            }
        } else { 
            updateFormData({ moduleApiName: '', availableFields: [] }); 
        }
    }, [selectedProfile, isDbSynced, formData.moduleApiName, jobs, activeProfileName, isStartingBatch, isFetchingFields]);

    useEffect(() => {
        if (formData.availableFields && formData.availableFields.length > 0) {
            const currentIsValid = formData.availableFields.some(f => f.api_name === (formData as any).targetHtmlField && (f.data_type === 'multiline' || f.data_type === 'textarea'));
            if (!currentIsValid) {
                const firstMultiline = formData.availableFields.find(f => f.data_type === 'multiline' || f.data_type === 'textarea');
                if (firstMultiline && firstMultiline.api_name !== (formData as any).targetHtmlField) updateFormData({ targetHtmlField: firstMultiline.api_name });
            }
        }
    }, [formData.availableFields, (formData as any).targetHtmlField]);

    const trackingEnabled = (formData as any).trackingEnabled || false;
    const targetHtmlField = (formData as any).targetHtmlField || '';

    // 🟢 THE FIX: Now counts all profiles that have ANY valid module name configured
    const eligibleProfilesCount = useMemo(() => {
        return inventoryProfiles.filter(p => {
            const modName = p.inventory?.customModuleApiName;
            return modName && modName.trim() !== 'cm_' && modName.trim() !== '';
        }).length;
    }, [inventoryProfiles]);

    const recordCount = useMemo(() => {
        if (!formData.bulkData) return 0;
        return formData.bulkData.split('\n').filter(line => line.trim() !== '').length;
    }, [formData.bulkData]);

    const handleStaticChange = (apiName: string, value: string) => { updateFormData({ staticData: { ...formData.staticData, [apiName]: value } }); };

    const handleStartJob = () => {
        if (!activeProfileName || !formData.bulkField || !formData.bulkData) return;
        if (trackingEnabled && !targetHtmlField) return toast({ title: "Tracking Error", description: "Target HTML Field is required to enable tracking.", variant: "destructive" });

        const items = formData.bulkData.split('\n').filter(x => x.trim());
        setJobs(prev => ({ 
            ...prev, 
            [activeProfileName]: { 
                ...prev[activeProfileName], 
                isProcessing: true, isPaused: false, isComplete: false, 
                _forceStopped: false, _forcePaused: false, _isQueued: false, _ignition: false,
                processingStartTime: new Date(), processingTime: 0, 
                totalToProcess: items.length, results: [], 
                processedCount: 0, successCount: 0, errorCount: 0 
            } as any 
        }));
        
        const accountIndex = inventoryProfiles.findIndex(p => p.profileName === activeProfileName) + 1;
        const multilineFields = formData.availableFields?.filter(f => f.data_type === 'multiline' || f.data_type === 'textarea').map(f => f.api_name) || [];

        socket?.emit('startBulkCustomJob', { 
            selectedProfileName: activeProfileName, moduleApiName: formData.moduleApiName, 
            bulkField: formData.bulkField, bulkData: formData.bulkData, 
            staticData: formData.staticData, delay: formData.delay, 
            concurrency: formData.concurrency, stopAfterFailures: formData.stopAfterFailures, 
            activeProfile: selectedProfile, trackingEnabled: trackingEnabled,
            campaignName: formData.moduleApiName || 'Bulk_Custom_Module', targetHtmlField: targetHtmlField,
            startingRowNumber: 1, appendAccountName: (formData as any).appendAccountName || false,
            accountIndex, multilineFields
        });
    };

    const handleApplyAll = (selectedProfileNames: string[], modalFormData: any, modalTrackingData: any, applyOptions: any = { iterator: true, staticFields: true, execution: true, tracking: true }) => {
        const { bulkField, bulkData, staticData, delay, concurrency, stopAfterFailures, appendAccountName } = modalFormData;
        const { trackingEnabled, targetHtmlField } = modalTrackingData;
        
        setJobs(prev => {
            const next = { ...prev };
            const profilesToUpdate = Array.from(new Set([...selectedProfileNames, activeProfileName!]));

            profilesToUpdate.forEach(profileName => {
                const currentJob = next[profileName] || createInitialJobState();
                
                const targetModName = inventoryProfiles.find(p => p.profileName === profileName)?.inventory?.customModuleApiName || formData.moduleApiName;
                
                const cacheKey = `inv_${profileName}_${targetModName}`;
                const targetFields = globalFieldsCache[cacheKey];

                if (!targetFields) {
                    socket?.emit('fetchModuleFields', { selectedProfileName: profileName, moduleApiName: targetModName, activeProfile: inventoryProfiles.find(p => p.profileName === profileName) });
                }

                let finalStaticData = JSON.parse(JSON.stringify(staticData));
                let destStaticData = JSON.parse(JSON.stringify(currentJob.formData.staticData || {}));
                let finalBulkField = bulkField; 
                let finalTargetHtmlField = targetHtmlField; 
                let needsMappingLater = true;

                if (profileName === activeProfileName) {
                    needsMappingLater = false; 
                } else if (targetFields && targetFields.length > 0 && formData.availableFields) {
                    const { mappedStatic, mappedBulk, mappedTargetHtml } = performSmartMapping(formData.availableFields, targetFields, finalStaticData, finalBulkField, finalTargetHtmlField);
                    finalStaticData = mappedStatic; finalBulkField = mappedBulk; finalTargetHtmlField = mappedTargetHtml; needsMappingLater = false;
                }

                let resultingStaticData = applyOptions.staticFields ? finalStaticData : destStaticData;

                if (applyOptions.staticFields || applyOptions.tracking) {
                    const targetAccIndex = inventoryProfiles.findIndex(p => p.profileName === profileName) + 1;
                    const fieldsToCheck = targetFields && targetFields.length > 0 ? targetFields : (formData.availableFields || []);
                    const multilineFields = fieldsToCheck.filter((f: any) => f.data_type === 'multiline' || f.data_type === 'textarea').map((f: any) => f.api_name);
                    
                    multilineFields.forEach((key: string) => {
                        let val = resultingStaticData[key] || '';
                        if (appendAccountName) {
                            val = val.replace(/(<br>){5,}\d*$/g, '');
                            val = val + BR_STRING + targetAccIndex;
                        } else if (applyOptions.tracking) {
                            val = val.replace(/(<br>){5,}\d*$/g, '');
                        }
                        resultingStaticData[key] = val;
                    });
                }

                next[profileName] = { 
                    ...currentJob, 
                    formData: { 
                        ...currentJob.formData, 
                        moduleApiName: targetModName, 
                        bulkField: applyOptions.iterator ? finalBulkField : currentJob.formData.bulkField, 
                        bulkData: applyOptions.iterator ? bulkData : currentJob.formData.bulkData, 
                        staticData: resultingStaticData, 
                        crossProfileSourceFields: applyOptions.staticFields ? (needsMappingLater ? formData.availableFields : undefined) : currentJob.formData.crossProfileSourceFields,
                        delay: applyOptions.execution ? delay : currentJob.formData.delay, 
                        concurrency: applyOptions.execution ? concurrency : currentJob.formData.concurrency, 
                        stopAfterFailures: applyOptions.execution ? stopAfterFailures : currentJob.formData.stopAfterFailures, 
                        trackingEnabled: applyOptions.tracking ? trackingEnabled : currentJob.formData.trackingEnabled, 
                        targetHtmlField: applyOptions.tracking ? finalTargetHtmlField : (currentJob.formData as any).targetHtmlField, 
                        appendAccountName: applyOptions.tracking ? appendAccountName : (currentJob.formData as any).appendAccountName 
                    } as any
                };
            });
            return next;
        });
        toast({ title: "Settings Applied", description: `Copied configuration to ${selectedProfileNames.length} accounts.` });
    };

    const handlePauseResume = () => {
        if (!socket || !activeProfileName) return;
        const currentJob = jobs[activeProfileName];
        if (!currentJob) return;

        const exactActiveModule = `inv_${currentJob.formData?.moduleApiName || inventoryProfiles.find(p => p.profileName === activeProfileName)?.inventory?.customModuleApiName || formData.moduleApiName}`;

        if (currentJob.isPaused) {
            socket.emit('resumeJob', { profileName: activeProfileName, jobType: exactActiveModule });
            setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isPaused: false, isProcessing: true, _forcePaused: false, _forceStopped: false } as any }));
            toast({ title: "Job Resumed!", description: `Continuing remaining items seamlessly.` });
        } else {
            socket.emit('pauseJob', { profileName: activeProfileName, jobType: exactActiveModule });
            setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isPaused: true, _forcePaused: true, _forceStopped: false } as any }));
            toast({ title: "Job Paused" });
        }
    };

    // 🟢 THE FIX: Now counts all active jobs across ALL modules
    const activeMasterJobs = useMemo(() => {
        let running = 0; let paused = 0; let queued = 0;
        inventoryProfiles.forEach(p => {
            const job = jobs[p.profileName];
            const modName = p.inventory?.customModuleApiName;
            if (modName && modName.trim() !== '' && modName.trim() !== 'cm_' && job?.formData?.moduleApiName === modName) {
                if (job.isProcessing && job.isPaused) paused++;
                else if (job.isProcessing && !job.isPaused) running++;
                else if ((job as any)._isQueued) queued++;
            }
        });
        return { running, paused, queued, totalProcessing: running + paused + queued };
    }, [jobs, inventoryProfiles]);

    // 🟢 THE FIX: Now pauses ALL active profiles regardless of module name
    const handleMasterPauseAll = () => {
        const profilesToPause = inventoryProfiles.filter(p => {
            const job = jobs[p.profileName];
            const modName = p.inventory?.customModuleApiName;
            return job && modName && modName.trim() !== 'cm_' && job.formData?.moduleApiName === modName && 
                   ((job.isProcessing && !job.isPaused) || (job as any)._isQueued);
        });

        let pausedCount = 0;
        profilesToPause.forEach(p => {
            const job = jobs[p.profileName];
            const wasQueued = (job as any)._isQueued;
            
            setJobs(prev => ({ 
                ...prev, 
                [p.profileName]: { 
                    ...prev[p.profileName], 
                    isPaused: true, 
                    isProcessing: !wasQueued,
                    _isQueued: wasQueued, 
                    _forcePaused: true, 
                    _forceStopped: false 
                } as any 
            }));
            
            socket?.emit('pauseJob', { profileName: p.profileName, jobType: `inv_${job.formData?.moduleApiName}` }); 
            pausedCount++;
        });
        toast({ title: "Master Batch Paused", description: `Paused ${pausedCount} accounts.` });
    };

    // 🟢 THE FIX: Now resumes ALL paused profiles regardless of module name
    const handleMasterForceResume = () => {
        const pausedProfiles = inventoryProfiles.filter(p => {
            const job = jobs[p.profileName];
            const modName = p.inventory?.customModuleApiName;
            return job && modName && modName.trim() !== 'cm_' && job.formData?.moduleApiName === modName && 
                   (job.isPaused || (job as any)._forcePaused);
        });

        let resumedCount = 0;
        pausedProfiles.forEach(p => {
            const job = jobs[p.profileName];
            const isQueued = (job as any)._isQueued;
            
            setJobs(prev => ({ 
                ...prev, 
                [p.profileName]: { 
                    ...prev[p.profileName], 
                    isPaused: false, 
                    isProcessing: !isQueued,
                    _isQueued: isQueued, 
                    _forcePaused: false, 
                    _forceStopped: false 
                } as any 
            }));
            
            socket?.emit('resumeJob', { profileName: p.profileName, jobType: `inv_${job.formData?.moduleApiName}` }); 
            resumedCount++;
        });
        toast({ title: "Master Batch Resumed", description: `Resumed ${resumedCount} accounts.` });
    };

    // 🟢 THE FIX: Now stops ALL active profiles regardless of module name
    const handleMasterStopAll = () => {
        const activeProfiles = inventoryProfiles.filter(p => {
            const job = jobs[p.profileName];
            const modName = p.inventory?.customModuleApiName;
            return job && modName && modName.trim() !== 'cm_' && job.formData?.moduleApiName === modName && 
                   (job.isProcessing || (job as any)._isQueued);
        });
        
        activeProfiles.forEach(p => {
            const job = jobs[p.profileName];
            socket?.emit('endJob', { profileName: p.profileName, jobType: `inv_${job.formData?.moduleApiName}` });
            setJobs(prev => ({ ...prev, [p.profileName]: { ...prev[p.profileName], isProcessing: false, isPaused: false, isComplete: true, _forceStopped: true, _isQueued: false } as any }));
        });
        
        toast({ title: "Master Batch Stopped", description: "All active jobs ended." });
    };

    const handleMasterBatchStart = async () => {
        const configuredProfiles = inventoryProfiles.filter(p => {
            const modName = p.inventory?.customModuleApiName;
            return modName && modName.trim() !== 'cm_' && modName.trim() !== '';
        });

        if (configuredProfiles.length === 0) return toast({ title: "Cannot Start Batch", description: "No accounts configured for this module.", variant: "destructive" });

        const idleProfiles = configuredProfiles.filter(p => { const job = jobs[p.profileName]; return !job?.isProcessing && !(job as any)?._isQueued; });
        if (idleProfiles.length === 0) return toast({ title: "All Accounts Active", description: "All your configured accounts are already running or waiting in line.", variant: "default" });

        const missingFieldsProfiles = idleProfiles.filter(p => { 
            const profileModName = p.inventory?.customModuleApiName;
            const cacheKey = `inv_${p.profileName}_${profileModName}`; 
            return !globalFieldsCache[cacheKey] || globalFieldsCache[cacheKey].length === 0; 
        });

        if (missingFieldsProfiles.length > 0) toast({ title: "Syncing Layouts Automatically...", description: `Fetching fields for ${missingFieldsProfiles.length} accounts.`, duration: 4000 });

        setIsStartingBatch(true);
        await Promise.all(missingFieldsProfiles.map(profileData => {
            return new Promise<void>((resolve) => {
                const profileName = profileData.profileName;
                const profileModName = profileData.inventory?.customModuleApiName;
                const cacheKey = `inv_${profileName}_${profileModName}`;

                const handleTempResult = (res: any) => {
                    const targetProfile = res.profileName || activeProfileName;
                    if (targetProfile === profileName) {
                        socket?.off('fetchModuleFieldsResult', handleTempResult);
                        socket?.off('customModuleFieldsResult', handleTempResult);
                        socket?.off('moduleFieldsResult', handleTempResult);
                        
                        const fields = res.fields || res.data || res.moduleFields;
                        if (res.success && fields) globalFieldsCache[cacheKey] = fields;
                        resolve();
                    }
                };

                socket?.on('fetchModuleFieldsResult', handleTempResult);
                socket?.on('customModuleFieldsResult', handleTempResult);
                socket?.on('moduleFieldsResult', handleTempResult);
                socket?.emit('fetchModuleFields', { selectedProfileName: profileName, moduleApiName: profileModName, activeProfile: profileData });
                
                setTimeout(() => { 
                    socket?.off('fetchModuleFieldsResult', handleTempResult); 
                    socket?.off('customModuleFieldsResult', handleTempResult);
                    socket?.off('moduleFieldsResult', handleTempResult);
                    resolve(); 
                }, 8000);
            });
        }));
        setIsStartingBatch(false);

        const payloads: any[] = [];
        const skippedReasons: string[] = [];

        idleProfiles.forEach(profileData => {
            const profileName = profileData.profileName;
            const profileModName = profileData.inventory?.customModuleApiName;
            const cacheKey = `inv_${profileName}_${profileModName}`;
            const targetFields = globalFieldsCache[cacheKey];

            if (!targetFields || targetFields.length === 0) {
                if (profileName === activeProfileName) skippedReasons.push(`Active Account Layout missing.`);
                return; 
            }

            const job = jobs[profileName];
            const rawBulkData = job?.formData?.bulkData || '';
            const hasCustomConfig = typeof rawBulkData === 'string' && rawBulkData.trim().length > 0;
            
            let safeStaticData = {}; let safeBulkField = ''; let safeTargetHtmlField = ''; let finalBulkData = '';

            if (profileName === activeProfileName) {
                safeStaticData = formData.staticData; safeBulkField = formData.bulkField; safeTargetHtmlField = (formData as any).targetHtmlField || ''; finalBulkData = formData.bulkData;
            } else if (hasCustomConfig) {
                finalBulkData = job.formData.bulkData;
                if (job.formData.crossProfileSourceFields && job.formData.crossProfileSourceFields.length > 0) {
                    const { mappedStatic, mappedBulk, mappedTargetHtml } = performSmartMapping(job.formData.crossProfileSourceFields, targetFields, job.formData.staticData, job.formData.bulkField, (job.formData as any).targetHtmlField || '');
                    safeStaticData = mappedStatic; safeBulkField = mappedBulk; safeTargetHtmlField = mappedTargetHtml; 
                } else {
                    safeStaticData = job.formData.staticData || {}; safeBulkField = job.formData.bulkField || ''; safeTargetHtmlField = (job.formData as any).targetHtmlField || '';
                }
            } else {
                finalBulkData = formData.bulkData;
                if (formData.availableFields && formData.availableFields.length > 0 && targetFields && targetFields.length > 0) {
                    const { mappedStatic, mappedBulk, mappedTargetHtml } = performSmartMapping(formData.availableFields, targetFields, formData.staticData, formData.bulkField, (formData as any).targetHtmlField || '');
                    safeStaticData = mappedStatic; safeBulkField = mappedBulk; safeTargetHtmlField = mappedTargetHtml;
                } else {
                    safeStaticData = formData.staticData || {}; 
                    safeBulkField = formData.bulkField || ''; 
                    safeTargetHtmlField = (formData as any).targetHtmlField || '';
                }
            }

            if (!safeBulkField) {
                if (profileName === activeProfileName) skippedReasons.push(`Iterator Field not selected.`);
                return;
            }
            if (!finalBulkData || finalBulkData.trim() === '') {
                if (profileName === activeProfileName) skippedReasons.push(`Bulk Data is empty.`);
                return;
            }

            const accountIndex = inventoryProfiles.findIndex(p => p.profileName === profileName) + 1;
            const multilineFields = targetFields.filter((f: any) => f.data_type === 'multiline' || f.data_type === 'textarea').map((f: any) => f.api_name);

            payloads.push({
                selectedProfileName: profileName, 
                moduleApiName: profileModName, 
                bulkField: safeBulkField, bulkData: finalBulkData, 
                staticData: safeStaticData, delay: formData.delay || 0, concurrency: formData.concurrency || 1, stopAfterFailures: formData.stopAfterFailures || 0, 
                activeProfile: profileData, trackingEnabled: (formData as any).trackingEnabled || false,
                campaignName: profileModName || 'Bulk_Custom_Module', targetHtmlField: safeTargetHtmlField,
                startingRowNumber: 1, appendAccountName: (formData as any).appendAccountName || false, accountIndex, multilineFields
            });
        });

        if (payloads.length === 0) {
            const errorMsg = skippedReasons.length > 0 ? skippedReasons.join(' | ') : "No accounts have bulk data to process.";
            return toast({ title: "Cannot Start Batch", description: errorMsg, variant: "destructive" });
        }

        // 🚨 THE FIX: Force state to know the target API name so it doesn't wipe
        setJobs(prev => {
            const next = { ...prev };
            payloads.forEach(p => {
                const itemsToProcess = p.bulkData ? p.bulkData.split('\n').filter((x: string) => x.trim()).length : 0;
                const existingJob = next[p.selectedProfileName] || createInitialJobState();
                next[p.selectedProfileName] = {
                    ...existingJob, 
                    formData: { ...existingJob.formData, moduleApiName: p.moduleApiName }, 
                    isProcessing: false, isPaused: false, isComplete: false,
                    _forceStopped: false, _forcePaused: false, _isQueued: true, _ignition: false,
                    results: [], processingTime: 0, totalToProcess: itemsToProcess,
                    processedCount: 0, successCount: 0, errorCount: 0, processingStartTime: null 
                } as any;
            });
            return next;
        });

        // 🚨 THE FIX: Group payloads by module API name and emit them in distinct batches
        const payloadsByModule: Record<string, any[]> = {};
        payloads.forEach(p => {
            if (!payloadsByModule[p.moduleApiName]) payloadsByModule[p.moduleApiName] = [];
            payloadsByModule[p.moduleApiName].push(p);
        });

        Object.keys(payloadsByModule).forEach(modName => {
            socket?.emit('startMasterBatchCustomJob', {
                moduleApiName: modName,
                concurrency: masterBatchConcurrency,
                payloads: payloadsByModule[modName]
            });
        });
        
        toast({ title: "Master Batch Running", description: `Sent ${payloads.length} accounts to the background server.` });
    };

    const handleRetryFailed = () => {
        if (!activeProfileName) return;
        const failedItems = results.filter(r => !r.success && r.stage === 'complete').map(r => r.identifier).join('\n');
        if (!failedItems) { toast({ title: "No failed items found" }); return; }
        updateFormData({ bulkData: failedItems });
        setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isProcessing: false, isPaused: false, isComplete: false, processingTime: 0, totalToProcess: failedItems.split('\n').length, results: [], processedCount: 0, successCount: 0, errorCount: 0 } }));
        toast({ title: "Retry Ready", description: "Failed items reloaded." });
    };

    const handleDatabaseSearch = () => { if (!activeProfileName || !socket || !filterText) return; setIsSearchingDB(true); socket.emit('startBulkCustomJob', { isSearchRequest: true, selectedProfileName: activeProfileName, moduleApiName: formData.moduleApiName, query: filterText }); };
    const handleFullExportDB = () => { if (!activeProfileName || !socket) return; setIsExporting(true); socket.emit('startBulkCustomJob', { isExportRequest: true, selectedProfileName: activeProfileName, moduleApiName: formData.moduleApiName }); };
    const handleManualVerify = () => { if (activeProfileName && socket) { setApiStatus({ status: 'loading', message: 'Re-checking connection...' }); socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'inventory' }); } };
    
    const getFieldLabel = (field: any) => { let label = field.label || field.api_name || ''; if (label.includes('_') || label.startsWith('cf_')) { label = label.replace(/^cf_/, '').replace(/_/g, ' '); label = label.replace(/\b\w/g, (char: string) => char.toUpperCase()); } return label; };
    const formatExactTime = (dateInput?: Date | string) => { if (!dateInput) return '-'; const date = new Date(dateInput); const hours = date.getHours().toString().padStart(2, '0'); const minutes = date.getMinutes().toString().padStart(2, '0'); const seconds = date.getSeconds().toString().padStart(2, '0'); const milliseconds = date.getMilliseconds().toString().padStart(3, '0'); return `${hours}:${minutes}:${seconds}.${milliseconds}`; };

    useEffect(() => { setCurrentPage(1); }, [filterText, statusFilter]);

    const completedCount = (jobState as any).processedCount || 0; 
    const successCount = (jobState as any).successCount || 0; 
    const errorCount = (jobState as any).errorCount || 0;
    const progressPercent = jobState.totalToProcess > 0 ? (completedCount / jobState.totalToProcess) * 100 : 0; 
    const remainingCount = Math.max(0, jobState.totalToProcess - completedCount);

    const filteredResults = useMemo(() => {
        let res = [...results].sort((a, b) => { const numA = a.rowNumber || a.fallbackRowNumber || 0; const numB = b.rowNumber || b.fallbackRowNumber || 0; return numB - numA; });
        if (statusFilter === 'success') res = res.filter(r => r.success);
        else if (statusFilter === 'error') res = res.filter(r => !r.success && r.stage === 'complete');
        if (filterText) { 
            const lowerFilter = filterText?.toLowerCase(); 
            res = res.filter(r => r?.identifier?.toLowerCase().includes(lowerFilter) || (r?.details || '')?.toLowerCase().includes(lowerFilter) ); 
        }
        return res;
    }, [results, filterText, statusFilter]);

    const activeResultsList = dbSearchResults !== null ? dbSearchResults : filteredResults;
    const totalPages = Math.ceil(activeResultsList.length / ITEMS_PER_PAGE);
    const paginatedResults = useMemo(() => { const listToPaginate = dbSearchResults !== null ? dbSearchResults : [...filteredResults]; const startIndex = (currentPage - 1) * ITEMS_PER_PAGE; return listToPaginate.slice(startIndex, startIndex + ITEMS_PER_PAGE); }, [filteredResults, dbSearchResults, currentPage]);
    const handleExportTxt = () => { const content = filteredResults.map(r => `${r.identifier} - ${r.success ? 'Success' : 'Error'} - ${r.details}`).join('\n'); const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' }); const link = document.createElement("a"); const url = URL.createObjectURL(blob); link.setAttribute("href", url); link.setAttribute("download", `custom_module_results_${new Date().toISOString().slice(0,10)}.txt`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); };
    const currentBulkFieldObj = formData.availableFields?.find(f => f.api_name === formData.bulkField);

    if (isWiping) {
        return (
            <DashboardLayout
                title="Inventory Custom Modules"
                description="Push data to Zoho Inventory Custom Modules."
                service="inventory"
                profiles={inventoryProfiles}
                selectedProfile={selectedProfile}
                onProfileChange={setActiveProfileName}
                onAddProfile={onAddProfile}
                onEditProfile={onEditProfile}
                onDeleteProfile={onDeleteProfile}
                apiStatus={apiStatus}
                onManualVerify={handleManualVerify}
                onShowStatus={() => setIsStatusModalOpen(true)}
                jobs={jobs}
                socket={socket}
            >
                <div className="flex flex-col items-center justify-center h-[70vh] space-y-6">
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                    <div className="text-center space-y-3">
                        <h2 className="text-3xl font-bold text-foreground">Purging Database Memory</h2>
                        <p className="text-xl text-muted-foreground animate-pulse">{wipeProgress}</p>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <>
            <DashboardLayout onAddProfile={onAddProfile} profiles={inventoryProfiles} selectedProfile={selectedProfile} onProfileChange={setActiveProfileName} jobs={jobs} socket={socket} onEditProfile={onEditProfile} onDeleteProfile={onDeleteProfile} service="inventory" apiStatus={apiStatus} onManualVerify={handleManualVerify} onShowStatus={() => setIsStatusModalOpen(true)}>
                <div className="space-y-6">
                    <Card className="shadow-medium">
                        <CardHeader>
                            <CardTitle className="flex items-center space-x-2"><Database className="h-5 w-5 text-primary" /><span>Inventory Custom Module Manager</span></CardTitle>
                            <CardDescription className="flex items-center justify-between w-full mt-2">
                                {formData.moduleApiName ? (
                                    <div className="flex items-center justify-between w-full gap-4 flex-wrap">
                                        <span className="flex items-center gap-2">Target Module: <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">{formData.moduleApiName}</span></span>
                                        <div className="flex items-center gap-2">
                                            <Button variant="outline" size="sm" className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50" onClick={handleClearJob}><Trash2 className="h-3 w-3 mr-1.5" /> Wipe Account</Button>
                                            <Button variant="destructive" size="sm" className="h-7 text-xs font-bold bg-red-600 hover:bg-red-700" onClick={handleClearAllJobs}><AlertTriangle className="h-3 w-3 mr-1.5" /> Wipe ALL</Button>
                                            <div className="w-px h-4 bg-border mx-1 hidden sm:block"></div>
                                            {eligibleProfilesCount > 0 && !jobState.isProcessing && !(jobState as any)._isQueued && (<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsApplyAllModalOpen(true)}><CopyCheck className="h-3 w-3 mr-1.5" /> Apply Config to All</Button>)}
                                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleFetchFields(true)} disabled={jobState.isProcessing || (jobState as any)._isQueued || isStartingBatch}><RefreshCw className={cn("h-3 w-3 mr-1.5", (isFetchingFields || isStartingBatch) && "animate-spin")} /> Refresh Fields</Button>
                                        </div>
                                    </div>
                                ) : ( "No Custom Module configured." )}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            
                            {!formData.moduleApiName && (<Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Configuration Required</AlertTitle><AlertDescription>This Inventory account does not have a <strong>Custom Module API Name</strong> set. Please click the <strong>Settings (Gear Icon)</strong> next to the profile name to configure it.</AlertDescription></Alert>)}
                            
                            {isFetchingFields && (<div className="flex flex-col justify-center items-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed"><Loader2 className="animate-spin h-8 w-8 mb-4 text-primary" /><span className="text-sm font-medium">Fetching latest fields from Zoho Inventory...</span></div>)}

                            {!isFetchingFields && formData.availableFields && formData.availableFields.length > 0 && (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="space-y-4 border-r pr-0 lg:pr-8">
                                        <div className="space-y-2">
                                            <Label className="text-primary font-bold">Step 1: Iterator Field (Bulk Value)</Label>
                                            <Select value={formData.bulkField} onValueChange={v => updateFormData({ bulkField: v })} disabled={jobState.isProcessing || (jobState as any)._isQueued}>
                                                <SelectTrigger><SelectValue placeholder="Select the field to iterate..." /></SelectTrigger>
                                                <SelectContent>{formData.availableFields.map(f => (<SelectItem key={f.api_name} value={f.api_name}>{getFieldLabel(f)}</SelectItem>))}</SelectContent>
                                            </Select>
                                        </div>
                                        
                                        {formData.bulkField && (
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center mb-1"><Label>Bulk Data for <strong>{currentBulkFieldObj ? getFieldLabel(currentBulkFieldObj) : formData.bulkField}</strong></Label><Badge variant="secondary" className="text-xs font-mono">{recordCount} Records</Badge></div>
                                                <Textarea className="min-h-[300px] font-mono mt-1 mb-2" value={formData.bulkData} onChange={e => updateFormData({ bulkData: e.target.value })} disabled={jobState.isProcessing || (jobState as any)._isQueued} placeholder="Value 1&#10;Value 2&#10;Value 3" />
                                                <div className="flex gap-2">
                                                    {!jobState.isProcessing && !(jobState as any)._isQueued && (<Button size="sm" className="w-full" onClick={handleStartJob} disabled={!formData.bulkField || !formData.bulkData}><Play className="mr-2 h-4 w-4" /> Start Single Job</Button>)}
                                                    {(jobState.isProcessing || (jobState as any)._isQueued) && (
                                                        <>
                                                            <Button size="sm" className={cn("flex-1 font-bold", jobState.isPaused ? "bg-green-600 hover:bg-green-700 text-white" : "")} variant={jobState.isPaused ? "default" : "outline"} onClick={handlePauseResume} disabled={(jobState as any)._isQueued}>{jobState.isPaused ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}{jobState.isPaused ? "Resume" : "Pause"}</Button>
                                                            {/* 🚀 THE FIX: EXACT SINGLE MODULE LOOKUP FOR SINGLE STOP */}
                                                            <Button size="sm" variant="destructive" className="flex-1" onClick={() => { 
                                                                const exactActiveModule = `inv_${jobs[activeProfileName]?.formData?.moduleApiName || inventoryProfiles.find(p => p.profileName === activeProfileName)?.inventory?.customModuleApiName || formData.moduleApiName}`;
                                                                socket?.emit('endJob', { profileName: activeProfileName, jobType: exactActiveModule }); 
                                                                setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isProcessing: false, isPaused: false, isComplete: true, _forceStopped: true, _isQueued: false } as any })); 
                                                            }}><Square className="mr-1 h-3 w-3" /> Stop</Button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <Label className="text-primary font-bold">Step 2: Static Fields (Common Data)</Label>
                                        <div className="space-y-3 max-h-[400px] overflow-y-auto p-1 pr-2">
                                            {formData.availableFields.filter(f => f.api_name !== formData.bulkField).map(f => (
                                                <div key={f.api_name} className="grid gap-1.5">
                                                    <Label className="text-xs font-semibold text-muted-foreground">{getFieldLabel(f)}{f.is_mandatory && <span className="text-red-500 ml-1">*</span>}</Label>
                                                    {f.data_type === 'multiline' || f.data_type === 'textarea' ? (<Textarea value={formData.staticData[f.api_name] || ''} onChange={e => handleStaticChange(f.api_name, e.target.value)} placeholder={f.default_value || ''} disabled={jobState.isProcessing || (jobState as any)._isQueued} rows={3}/>) : (<Input value={formData.staticData[f.api_name] || ''} onChange={e => handleStaticChange(f.api_name, e.target.value)} placeholder={f.default_value || ''} disabled={jobState.isProcessing || (jobState as any)._isQueued}/>)}
                                                </div>
                                            ))}
                                        </div>
                                        
                                        <div className="p-3 border rounded-lg space-y-3 mt-4">
                                            <div className="flex items-center space-x-2">
                                                <Checkbox id="enableTracking" checked={trackingEnabled} onCheckedChange={(c) => updateFormData({ trackingEnabled: !!c })} disabled={jobState.isProcessing || (jobState as any)._isQueued || !selectedProfile?.cloudflareTrackingUrl} />
                                                <Label htmlFor="enableTracking" className="font-medium cursor-pointer flex items-center gap-2 text-muted-foreground">Enable Base64 Link Injection & Tracking {!selectedProfile?.cloudflareTrackingUrl && <span className="text-[10px] text-destructive font-bold">(URL missing in Profile)</span>}</Label>
                                            </div>
                                            {trackingEnabled && (
                                                <div className="pl-6 animate-in fade-in slide-in-from-top-1">
                                                    <Select value={targetHtmlField} onValueChange={(v) => updateFormData({ targetHtmlField: v })} disabled={jobState.isProcessing || (jobState as any)._isQueued}>
                                                        <SelectTrigger className="h-8 text-xs bg-background"><SelectValue placeholder="Select Target HTML Field..." /></SelectTrigger>
                                                        <SelectContent>{formData.availableFields.filter(f => f.data_type === 'multiline' || f.data_type === 'textarea').map(f => (<SelectItem key={f.api_name} value={f.api_name} className="text-xs">{getFieldLabel(f)} ({f.api_name})</SelectItem>))}</SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                            <div className="flex items-center space-x-2 pt-2 border-t border-border/50 mt-2">
                                                <Checkbox id="appendAccountName" checked={(formData as any).appendAccountName || false} onCheckedChange={(c) => updateFormData({ appendAccountName: !!c })} disabled={jobState.isProcessing || (jobState as any)._isQueued} />
                                                <Label htmlFor="appendAccountName" className="font-medium cursor-pointer text-muted-foreground text-sm">Append Profile Name & Account Index to Multiline Fields</Label>
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t grid grid-cols-3 gap-4">
                                            <div><Label>Delay (s)</Label><Input type="number" value={formData.delay} onChange={e => updateFormData({ delay: Number(e.target.value) })} className="mt-1" disabled={jobState.isProcessing || (jobState as any)._isQueued} min={0}/></div>
                                            <div><Label>Concurrency</Label><Input type="number" value={formData.concurrency} onChange={e => updateFormData({ concurrency: Number(e.target.value) })} className="mt-1" disabled={jobState.isProcessing || (jobState as any)._isQueued} min={1} max={10}/></div>
                                            <div><Label className="flex items-center text-red-600/80"><AlertOctagon className="h-3 w-3 mr-1" /> Auto-Pause</Label><Input type="number" value={formData.stopAfterFailures} onChange={e => updateFormData({ stopAfterFailures: Number(e.target.value) })} className="mt-1" disabled={jobState.isProcessing || (jobState as any)._isQueued} min={0} placeholder="0 (Off)"/></div>
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
                                {errorCount > 0 && !jobState.isProcessing && !(jobState as any)._isQueued && (
                                    <Button size="sm" variant="outline" className="w-full text-red-600 border-red-200" onClick={handleRetryFailed}><RotateCcw className="mr-2 h-4 w-4" /> Load Failed ({errorCount})</Button>
                                )}

                                <div className="space-y-3 pt-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-bold text-muted-foreground uppercase">Global Custom Modules ({eligibleProfilesCount})</Label>
                                        <div className="flex items-center gap-2">
                                            <Label className="text-xs text-muted-foreground" title="How many accounts to run simultaneously">Concurrent:</Label>
                                            <Input type="number" min={1} max={10} value={masterBatchConcurrency} onChange={(e) => setMasterBatchConcurrency(Number(e.target.value))} className="w-16 h-7 text-xs" disabled={activeMasterJobs.totalProcessing > 0} />
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <Button size="sm" className="flex-1" onClick={handleMasterBatchStart} disabled={activeMasterJobs.totalProcessing > 0 || eligibleProfilesCount === 0 || isStartingBatch}>
                                            {isStartingBatch ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />} {isStartingBatch ? "Syncing..." : `Start All Accounts`}
                                        </Button>
                                        <Button size="sm" variant="outline" className="flex-1" onClick={handleMasterPauseAll} disabled={activeMasterJobs.running === 0}>
                                            <Pause className="h-4 w-4 mr-1" /> Pause All
                                        </Button>
                                        <Button size="sm" variant="outline" className="flex-1" onClick={handleMasterForceResume} disabled={activeMasterJobs.paused === 0}>
                                            <Play className="h-4 w-4 mr-1" /> Resume All
                                        </Button>
                                        <Button size="sm" variant="destructive" className="flex-1" onClick={handleMasterStopAll} disabled={activeMasterJobs.totalProcessing === 0}>
                                            <Square className="h-4 w-4 mr-1" /> End All
                                        </Button>
                                    </div>
                                    
                                    {(activeMasterJobs.totalProcessing > 0) && (
                                        <div className="flex items-center gap-6 text-xs font-medium pt-1">
                                            <span className="text-primary animate-pulse">Running Modules: {activeMasterJobs.running}</span>
                                            <span className="text-amber-600">Paused Modules: {activeMasterJobs.paused}</span>
                                            {activeMasterJobs.queued > 0 && <span className="text-blue-500">Waiting in Queue: {activeMasterJobs.queued}</span>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {((jobState as any)._isQueued || results.length > 0 || jobState.isProcessing) && (
                        <Card className="shadow-medium hover:shadow-large transition-all duration-300">
                            <CardHeader className="pb-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                        <BarChart3 className="h-5 w-5 text-primary" />
                                        <CardTitle className="text-lg">Processing Results <span className="text-xs text-muted-foreground ml-2 font-normal">(Showing latest {Math.min(filteredResults.length, MAX_BUFFER_SIZE)} items)</span></CardTitle>
                                    </div>
                                    <div className="flex items-center space-x-3 select-none">
                                        <Badge variant="outline" className={cn("cursor-pointer", statusFilter === 'all' ? "bg-primary text-primary-foreground" : "text-muted-foreground")} onClick={() => setStatusFilter('all')}>All: {results.length}</Badge>
                                        <Badge variant="outline" className={cn("bg-green-500/10 text-green-600 cursor-pointer border-transparent hover:border-green-200", statusFilter === 'success' && "ring-2 ring-green-500")} onClick={() => setStatusFilter(statusFilter === 'success' ? 'all' : 'success')}><CheckCircle2 className="h-3 w-3 mr-1" /> {results.filter(r => r.success).length} Success</Badge>
                                        <Badge variant="destructive" className={cn("bg-destructive/10 cursor-pointer border-transparent", statusFilter === 'error' && "ring-2 ring-destructive")} onClick={() => setStatusFilter(statusFilter === 'error' ? 'all' : 'error')}><XCircle className="h-3 w-3 mr-1" /> {results.filter(r => !r.success).length} Errors</Badge>
                                    </div>
                                </div>
                                <CardDescription>{jobState.isProcessing ? `Processing... ${completedCount} / ${jobState.totalToProcess} complete.` : (jobState as any)._isQueued ? <span className="text-amber-600 font-medium animate-pulse">⏳ Waiting in Batch Queue...</span> : `Completed.`}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {(jobState.isProcessing || (jobState as any)._isQueued) && (<div className="w-full bg-muted rounded-full h-2 mb-6"><div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }}/></div>)}
                                
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="relative w-full max-w-sm">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input placeholder="Filter recent or search DB..." value={filterText} onChange={(e) => setFilterText(e.target.value)} className="pl-10 pr-24" disabled={(jobState as any)._isQueued} />
                                            {filterText && (
                                                <Button size="sm" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 text-xs text-blue-600 font-bold hover:bg-blue-50" onClick={handleDatabaseSearch} disabled={isSearchingDB}>
                                                    {isSearchingDB ? <Loader2 className="h-3 w-3 animate-spin"/> : "Search DB"}
                                                </Button>
                                            )}
                                        </div>
                                        {dbSearchResults !== null && (<Button size="sm" variant="outline" className="text-red-500 border-red-200 bg-red-50 hover:bg-red-100 h-9" onClick={() => setDbSearchResults(null)}>Clear DB Search</Button>)}
                                        <div className="text-sm text-muted-foreground font-medium whitespace-nowrap">Found: {activeResultsList.length}</div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" onClick={handleExportTxt} disabled={filteredResults.length === 0 || (jobState as any)._isQueued} className="h-9"><FileText className="h-4 w-4 mr-2"/> Export (Recent)</Button>
                                        <Button variant="default" size="sm" onClick={handleFullExportDB} disabled={isExporting || (jobState as any)._isQueued} className="h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold">{isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <Database className="h-4 w-4 mr-2"/>} Export Entire DB</Button>
                                    </div>
                                </div>

                                <ScrollArea className="h-[550px] w-full rounded-lg border">
                                    <table className="w-full">
                                        <thead className="bg-muted/50 sticky top-0 z-10">
                                            <tr>
                                                <th className="p-3 text-left text-xs font-medium text-muted-foreground w-16">Row #</th>
                                                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Identifier</th>
                                                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Status / Details</th>
                                                <th className="p-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-24">Time</th>
                                                <th className="p-3 text-center text-xs font-medium text-muted-foreground w-24">Result</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-card divide-y divide-border">
                                            {(jobState as any)._isQueued ? (<tr><td colSpan={5} className="p-8 text-center text-amber-600 font-medium">Waiting for previous accounts to finish before starting...</td></tr>) : paginatedResults.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No results match your filter.</td></tr>) : (paginatedResults.map((result: any) => (
                                                <tr key={result.rowNumber || result.fallbackRowNumber} className={result.stage === 'complete' && !result.success ? 'bg-destructive/5' : ''}>
                                                    <td className="p-3 text-sm font-mono text-center text-muted-foreground">{result.rowNumber || '-'}</td>
                                                    <td className="p-3 text-sm font-mono">{result.identifier}</td>
                                                    <td className={`p-3 text-sm ${result.stage === 'complete' && !result.success ? 'text-destructive' : 'text-muted-foreground'}`}>{result.details}</td>
                                                    <td className="px-4 py-2 text-sm text-center font-mono"><div className="flex flex-col items-center justify-center">{result.time && <span className="text-blue-600 dark:text-blue-400 font-bold text-xs">{result.time}</span>}<span className="text-muted-foreground text-[11px]">{formatExactTime(result.timestamp)}</span></div></td>
                                                    <td className="p-3 text-center"><div className="flex items-center justify-center space-x-2">{result.stage === 'processing' ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/> : (result.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />)}{(result.response || result.fullResponse) && (<Dialog><DialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button></DialogTrigger><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>API Response</DialogTitle></DialogHeader><pre className="mt-2 max-h-[60vh] overflow-y-auto rounded-md bg-muted p-4 text-xs font-mono">{JSON.stringify(result.response || result.fullResponse, null, 2)}</pre></DialogContent></Dialog>)}</div></td>
                                                </tr>
                                            ))
                                            )}
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
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto flex flex-col">
                    <DialogHeader><DialogTitle>API Connection Status</DialogTitle></DialogHeader>
                    <div className="space-y-4 p-2">
                        <div className={`p-4 rounded-md border ${apiStatus.status === 'success' ? 'bg-green-50/50 border-green-200' : 'bg-red-50/50 border-red-200'}`}>
                            <p className={`font-bold text-lg flex items-center gap-2 ${apiStatus.status === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                                {apiStatus.status === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />} {apiStatus.status === 'success' ? 'Success' : 'Error'}
                            </p>
                            <p className="text-sm font-medium mt-1 text-muted-foreground">{apiStatus.message}</p>
                        </div>
                        {apiStatus.fullResponse && (
                            <div className="space-y-2 flex-1">
                                <Label className="text-xs font-bold text-muted-foreground uppercase">Full Response from Server:</Label>
                                <pre className="p-4 rounded-md bg-[#0d1117] text-[#58d68d] text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words border border-border shadow-inner">{JSON.stringify(apiStatus.fullResponse, null, 2)}</pre>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <CustomModuleApplyAllModal isOpen={isApplyAllModalOpen} onClose={() => setIsApplyAllModalOpen(false)} onApply={handleApplyAll} profiles={inventoryProfiles} moduleApiName={formData.moduleApiName} availableFields={formData.availableFields || []} service="inventory" initialData={{ bulkField: formData.bulkField, bulkData: formData.bulkData, staticData: formData.staticData, delay: formData.delay, concurrency: formData.concurrency, stopAfterFailures: formData.stopAfterFailures, trackingEnabled: trackingEnabled, targetHtmlField: (formData as any).targetHtmlField || '', appendAccountName: (formData as any).appendAccountName || false }} />
        </>
    );
};

export default CustomModuleBulk;