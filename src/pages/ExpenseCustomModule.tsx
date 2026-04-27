import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { useQuery } from "@tanstack/react-query";
import { useToast } from '@/hooks/use-toast';
import { Profile, ExpenseJobs, ExpenseJobState, ExpenseFormData } from '@/App';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';

// UI Components
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// Icons
import { 
    Loader2, Database, Play, Pause, Square, CheckCircle2, XCircle, Clock, AlertCircle, 
    Search, FileText, BarChart3, Eye, AlertOctagon, RotateCcw, Timer, RefreshCw, 
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ShieldCheck, Hourglass, Hash, Send, MessageSquare
} from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';

const SERVER_URL = "http://localhost:3009";
const ITEMS_PER_PAGE = 50;

interface PageProps {
    socket: Socket | null;
    jobs: ExpenseJobs;
    setJobs: React.Dispatch<React.SetStateAction<ExpenseJobs>>;
    createInitialJobState: () => ExpenseJobState;
    onAddProfile: () => void;
    onEditProfile: (profile: Profile) => void;
    onDeleteProfile: (profileName: string) => void;
}

type ApiStatus = { status: 'loading' | 'success' | 'error'; message: string; fullResponse?: any; };

// --- HELPER: Beautify Field Names ---
const humanizeLabel = (text: string) => {
    if (!text) return "";
    return text.replace(/^cf_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).trim();
};

const formatLabel = (field: any) => {
    let displayLabel = field.label;
    if (!displayLabel || displayLabel === field.api_name || displayLabel.includes('_')) {
        displayLabel = humanizeLabel(field.api_name);
    }
    return displayLabel;
};

// --- MAIN COMPONENT ---
const ExpenseCustomModule: React.FC<PageProps> = ({ socket, jobs, setJobs, createInitialJobState, onAddProfile, onEditProfile, onDeleteProfile }) => {
    const { toast } = useToast();
    
    // 1. Fetch Profiles
    const { data: profiles = [] } = useQuery<Profile[]>({
        queryKey: ['profiles'],
        queryFn: () => fetch(`${SERVER_URL}/api/profiles`).then(res => res.json()),
    });

    const expenseProfiles = useMemo(() => profiles.filter(p => p.expense && p.expense.orgId), [profiles]);
    const [selectedProfileName, setSelectedProfileName] = useState<string>('');
    const selectedProfile = expenseProfiles.find(p => p.profileName === selectedProfileName) || null;

    // 2. Local State
    const [filterText, setFilterText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [apiStatus, setApiStatus] = useState<ApiStatus>({ status: 'loading', message: 'Checking...' });
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [isLoadingFields, setIsLoadingFields] = useState(false);

    useEffect(() => {
        if (expenseProfiles.length > 0 && !selectedProfileName) setSelectedProfileName(expenseProfiles[0].profileName);
    }, [expenseProfiles, selectedProfileName]);

    // 3. Active Job State
    const activeJob = useMemo(() => {
        if (selectedProfileName && jobs[selectedProfileName]) return jobs[selectedProfileName];
        return createInitialJobState();
    }, [jobs, selectedProfileName, createInitialJobState]);

    const { formData, results } = activeJob;

    // --- JOB UPDATE HELPER ---
    const updateJobData = (field: keyof ExpenseFormData | string, value: any) => {
        if (!selectedProfileName) return;
        setJobs(prev => {
            const currentJob = prev[selectedProfileName] || createInitialJobState();
            return {
                ...prev,
                [selectedProfileName]: {
                    ...currentJob,
                    formData: { ...currentJob.formData, [field]: value }
                }
            };
        });
    };

    // --- AUTOMATIC FETCH FIELDS ---
    useEffect(() => {
        if (!selectedProfile || !socket) return;
        const storedModuleName = selectedProfile.expense?.customModuleApiName;
        
        if (storedModuleName) {
            if (formData.moduleName !== storedModuleName || !formData.fields || formData.fields.length === 0) {
                updateJobData('moduleName', storedModuleName);
                setIsLoadingFields(true);
                socket.emit('getExpenseFields', { selectedProfileName: selectedProfile.profileName, moduleName: storedModuleName });
            }
        }
    }, [selectedProfile, socket]);

    const handleFetchFields = useCallback(() => {
        if (!socket || !selectedProfileName) return;
        setIsLoadingFields(true);
        socket.emit('getExpenseFields', { selectedProfileName, moduleName: formData.moduleName });
    }, [socket, selectedProfileName, formData.moduleName]);

    // --- SOCKET LISTENERS ---
    useEffect(() => {
        if (!socket) return;
        
        const onApiStatusResult = (result: any) => setApiStatus({ status: result.success ? 'success' : 'error', message: result.message, fullResponse: result.fullResponse });
        
        const onFieldsFetched = (result: any) => {
            setIsLoadingFields(false);
            if (result.success && selectedProfileName) {
                updateJobData('fields', result.fields);
                toast({ title: "Fields Fetched", description: `Found ${result.fields.length} fields.` });
                
                if (result.fields.length > 0 && !formData.bulkPrimaryField) {
                    let best = result.fields.find((f: any) => f.data_type === 'email' || f.api_name.toLowerCase().includes('email'));
                    if (!best) best = result.fields.find((f: any) => f.is_mandatory && f.data_type === 'text');
                    if (best) updateJobData('bulkPrimaryField', best.api_name);
                }
            } else {
                toast({ title: "Fetch Failed", description: result.error, variant: "destructive" });
            }
        };

        const onJobResult = (data: any) => {
            if (data.profileName !== selectedProfileName) return;
            setJobs(prev => {
                const currentJob = prev[selectedProfileName!];
                if (!currentJob) return prev;
                
                const existing = currentJob.results || [];
                let newResults;
                if (existing.some(r => r.identifier === data.identifier)) {
                     newResults = existing.map(r => r.identifier === data.identifier ? { ...r, ...data, primaryValue: data.identifier } : r);
                } else {
                     newResults = [{ ...data, primaryValue: data.identifier }, ...existing];
                }
                return { ...prev, [selectedProfileName!]: { ...currentJob, results: newResults } };
            });
        };

        const onCountdown = (data: { profileName: string, seconds: number }) => {
            if (data.profileName === selectedProfileName) {
                setJobs(prev => ({
                    ...prev,
                    [selectedProfileName]: { ...prev[selectedProfileName], countdown: data.seconds }
                }));
            }
        };

        const onComplete = (data: any) => {
            if (data.profileName === selectedProfileName) {
                toast({ title: "Job Complete", variant: "default" });
                setJobs(prev => ({ ...prev, [selectedProfileName!]: { ...prev[selectedProfileName!], isProcessing: false, isPaused: false, isComplete: true } }));
            }
        };

        const onPaused = (data: any) => {
            if (data.profileName === selectedProfileName) {
                toast({ title: "Job Paused", description: data.reason, variant: "destructive" });
                setJobs(prev => ({ ...prev, [selectedProfileName!]: { ...prev[selectedProfileName!], isPaused: true } }));
            }
        };

        socket.on('apiStatusResult', onApiStatusResult);
        socket.on('expenseFieldsResult', onFieldsFetched);
        socket.on('expenseBulkResult', onJobResult);
        socket.on('jobCountdown', onCountdown);
        socket.on('bulkComplete', onComplete);
        socket.on('bulkEnded', onComplete);
        socket.on('jobPaused', onPaused);

        return () => { 
            socket.off('apiStatusResult', onApiStatusResult); 
            socket.off('expenseFieldsResult', onFieldsFetched); 
            socket.off('expenseBulkResult', onJobResult);
            socket.off('jobCountdown', onCountdown);
            socket.off('bulkComplete', onComplete);
            socket.off('bulkEnded', onComplete);
            socket.off('jobPaused', onPaused);
        };
    }, [socket, selectedProfileName, formData.bulkPrimaryField, setJobs, toast]);

    const handleManualVerify = () => { 
        if (socket && selectedProfileName) { 
            setApiStatus({ status: 'loading', message: 'Verifying connection...' }); 
            socket.emit('checkApiStatus', { selectedProfileName, service: 'expense' }); 
        } 
    };

    // --- TIMER FIX ---
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (activeJob.isProcessing && !activeJob.isPaused && activeJob.processingStartTime) {
            interval = setInterval(() => {
                const start = new Date(activeJob.processingStartTime).getTime();
                const now = new Date().getTime();
                const duration = Math.max(0, Math.floor((now - start) / 1000));
                
                setJobs(prev => ({
                    ...prev,
                    [selectedProfileName]: {
                        ...prev[selectedProfileName],
                        processingTime: duration
                    }
                }));
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [activeJob.isProcessing, activeJob.isPaused, activeJob.processingStartTime, selectedProfileName, setJobs]);


    // --- JOB CONTROL ---
    const handleStart = () => {
        if (!socket || !selectedProfileName) return;
        const lines = (formData.bulkValues || '').split('\n').filter(x => x.trim()).length;
        setJobs(prev => ({
            ...prev,
            [selectedProfileName]: {
                ...prev[selectedProfileName],
                isProcessing: true, isPaused: false, isComplete: false, results: [],
                totalToProcess: lines, processingStartTime: new Date(), processingTime: 0
            }
        }));
        
        socket.emit('startBulkExpenseCreation', { 
            selectedProfileName, 
            moduleName: formData.moduleName, 
            primaryFieldName: formData.bulkPrimaryField, 
            bulkValues: formData.bulkValues, 
            defaultData: formData.defaultData, 
            bulkDelay: formData.bulkDelay,
            concurrency: formData.concurrency,
            verifyLog: formData.verifyLog,
            stopAfterFailures: formData.stopAfterFailures,
            activeProfile: selectedProfile
        });
    };

    const handlePauseResume = (pause: boolean) => {
        if (!socket || !selectedProfileName) return;
        
        if (!pause) {
            // Send request to resume (skipping logic removed in backend, but we send the event)
            socket.emit('startBulkExpenseCreation', { 
                selectedProfileName, 
                moduleName: formData.moduleName, 
                primaryFieldName: formData.bulkPrimaryField, 
                bulkValues: formData.bulkValues, 
                defaultData: formData.defaultData, 
                bulkDelay: formData.bulkDelay,
                concurrency: formData.concurrency,
                verifyLog: formData.verifyLog,
                stopAfterFailures: formData.stopAfterFailures,
                activeProfile: selectedProfile,
                processedIds: [] // Explicitly empty to force retry/create all
            });
            toast({ title: "Resuming...", description: `Continuing job.` });
        } else {
            socket.emit('pauseJob', { profileName: selectedProfileName, jobType: 'expense' });
        }
        
        setJobs(prev => ({ ...prev, [selectedProfileName]: { ...prev[selectedProfileName], isPaused: pause } }));
    };

    const handleEnd = () => { 
        if (socket && selectedProfileName) { 
            socket.emit('endJob', { profileName: selectedProfileName, jobType: 'expense' }); 
            setJobs(prev => ({ ...prev, [selectedProfileName]: { ...prev[selectedProfileName], isProcessing: false, isPaused: false } })); 
        } 
    };

    const handleRetryFailed = () => {
        if (!selectedProfileName) return;
        const failedItems = activeJob.results.filter(r => !r.success).map(r => r.primaryValue || r.identifier).join('\n');
        if (!failedItems) { toast({ title: "No failed items found" }); return; }
        updateJobData('bulkValues', failedItems);
        setJobs(prev => ({
            ...prev,
            [selectedProfileName]: { 
                ...prev[selectedProfileName], isProcessing: false, isPaused: false, isComplete: false, 
                results: [], processingTime: 0, totalToProcess: failedItems.split('\n').length 
            }
        }));
        toast({ title: "Ready to Retry", description: "Failed items loaded." });
    };

    // --- RESULTS LOGIC ---
    useEffect(() => { setCurrentPage(1); }, [filterText, statusFilter, results.length]);

    const filteredResults = useMemo(() => {
        let res = [...results].reverse();
        if (statusFilter === 'success') res = res.filter(r => r.success);
        else if (statusFilter === 'error') res = res.filter(r => !r.success);
        if (filterText) {
            const low = filterText.toLowerCase();
            res = res.filter(r => (r.primaryValue || '').toLowerCase().includes(low) || (r.details || '').toLowerCase().includes(low));
        }
        return res;
    }, [results, filterText, statusFilter]);

    const paginatedResults = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredResults.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredResults, currentPage]);

    const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    const completedCount = results.length;
    const progressPercent = activeJob.totalToProcess > 0 ? (completedCount / activeJob.totalToProcess) * 100 : 0;
    const remaining = Math.max(0, (activeJob.totalToProcess || 0) - completedCount);

    const handleExportTxt = () => {
        const content = filteredResults.map(r => `${r.primaryValue} | ${r.success ? 'SUCCESS' : 'FAILED'} | ${r.details || ''}`).join('\n');
        const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8;' }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `expense_results.txt`;
        link.click();
    };

    const formatDuration = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatTimestamp = (dateInput?: Date) => {
        if (!dateInput) return '-';
        const date = new Date(dateInput);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    };

    // --- RENDER ---
    const safeBulkValues = formData.bulkValues || '';
    const primaryCount = safeBulkValues.split('\n').filter(l => l.trim()).length;
    const fields = formData.fields || [];
    const secondaryFields = fields.filter(f => f.api_name !== formData.bulkPrimaryField && !f.is_read_only && !f.is_system);
    const primaryFieldLabel = fields.find(f => f.api_name === formData.bulkPrimaryField)?.label || 'Primary Field';

    return (
        <>
            <DashboardLayout onAddProfile={onAddProfile} onEditProfile={onEditProfile} onDeleteProfile={onDeleteProfile} profiles={expenseProfiles} selectedProfile={selectedProfile} onProfileChange={setSelectedProfileName} apiStatus={apiStatus} onShowStatus={() => setIsStatusModalOpen(true)} onManualVerify={handleManualVerify} socket={socket} jobs={jobs} service="expense">
                <div className="flex flex-col space-y-6">
                    
                    {/* --- FORM SECTION --- */}
                    <div className="w-full">
                        {!formData.moduleName ? (
                            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Configuration Missing</AlertTitle><AlertDescription>Set <strong>Expense Module API Name</strong> in profile settings.</AlertDescription></Alert>
                        ) : fields.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-8 border rounded-lg border-dashed bg-muted/20 text-muted-foreground">
                                {isLoadingFields ? <Loader2 className="animate-spin h-6 w-6"/> : <><p>No fields found for <strong>{formData.moduleName}</strong>.</p><Button variant="link" onClick={handleFetchFields}>Retry Fetch</Button></>}
                            </div>
                        ) : (
                            <Card className="border-l-4 border-l-blue-500 shadow-sm">
                                <CardHeader>
                                    <CardTitle>Bulk Configuration</CardTitle>
                                    <CardDescription>Target Module: <Badge variant="outline" className="ml-2 font-mono">{formData.moduleName}</Badge></CardDescription>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Primary Field (Iterator)</Label>
                                            <Select value={formData.bulkPrimaryField} onValueChange={(v) => updateJobData('bulkPrimaryField', v)} disabled={activeJob.isProcessing}>
                                                <SelectTrigger><SelectValue placeholder="Select field..." /></SelectTrigger>
                                                <SelectContent>{fields.filter(f => !f.is_read_only).map(f => (<SelectItem key={f.api_name} value={f.api_name}>{formatLabel(f)}</SelectItem>))}</SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between"><Label>Values (One per line)</Label><Badge variant="secondary">{primaryCount} records</Badge></div>
                                            <Textarea value={safeBulkValues} onChange={e => updateJobData('bulkValues', e.target.value)} className="h-[200px] font-mono" placeholder="Item 1&#10;Item 2" disabled={activeJob.isProcessing} />
                                        </div>
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="space-y-2"><Label>Delay (s)</Label><Input type="number" value={formData.bulkDelay} onChange={e => updateJobData('bulkDelay', Number(e.target.value))} disabled={activeJob.isProcessing} /></div>
                                            <div className="space-y-2"><Label>Concurrency</Label><Input type="number" value={formData.concurrency} onChange={e => updateJobData('concurrency', Number(e.target.value))} disabled={activeJob.isProcessing} min={1} max={10} /></div>
                                            <div className="space-y-2"><Label className="flex items-center text-red-600"><AlertOctagon className="h-3 w-3 mr-1" /> Limit</Label><Input type="number" value={formData.stopAfterFailures} onChange={e => updateJobData('stopAfterFailures', Number(e.target.value))} disabled={activeJob.isProcessing} placeholder="0" /></div>
                                        </div>
                                        <div className="flex items-center space-x-2 pt-2">
                                            <Switch id="verify" checked={formData.verifyLog} onCheckedChange={(v) => updateJobData('verifyLog', v)} disabled={activeJob.isProcessing} />
                                            <Label htmlFor="verify" className="flex items-center cursor-pointer"><ShieldCheck className="h-4 w-4 mr-1 text-green-600" /> Verify Automation Log</Label>
                                        </div>
                                    </div>
                                    <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                                        <Label className="font-semibold text-lg">Static Data</Label>
                                        <ScrollArea className="h-[350px] pr-4">
                                            <div className="space-y-4">
                                                {secondaryFields.map(f => (
                                                    <div key={f.api_name} className="space-y-1">
                                                        <Label className="text-xs">{formatLabel(f)}{f.is_mandatory && '*'}</Label>
                                                        <Input 
                                                            value={formData.defaultData[f.api_name] || ''} 
                                                            onChange={(e) => updateJobData('defaultData', { ...formData.defaultData, [f.api_name]: e.target.value })} 
                                                            placeholder={f.data_type} 
                                                            disabled={activeJob.isProcessing} 
                                                            className="h-8"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    </div>
                                </CardContent>
                                <CardFooter className="flex flex-col gap-3">
                                    {!activeJob.isProcessing ? (
                                        <div className="flex gap-2 w-full">
                                            <Button className="flex-1" onClick={handleStart} disabled={!formData.bulkPrimaryField || !safeBulkValues}><Send className="mr-2 h-4 w-4" /> Start Bulk Creation</Button>
                                            {errorCount > 0 && (<Button variant="secondary" className="border-red-200 hover:bg-red-50 text-red-700" onClick={handleRetryFailed}><RotateCcw className="mr-2 h-4 w-4" /> Retry Failed</Button>)}
                                        </div>
                                    ) : (
                                        <div className="flex gap-4 w-full justify-center">
                                            <Button variant="outline" onClick={() => handlePauseResume(!activeJob.isPaused)}>{activeJob.isPaused ? <><Play className="mr-2 h-4 w-4"/> Resume</> : <><Pause className="mr-2 h-4 w-4"/> Pause</>}</Button>
                                            <Button variant="destructive" onClick={handleEnd}><Square className="mr-2 h-4 w-4"/> End Job</Button>
                                        </div>
                                    )}
                                </CardFooter>
                            </Card>
                        )}
                    </div>

                    {/* --- STATS SECTION --- */}
                    <div className="grid grid-cols-4 gap-4">
                        <Card><CardContent className="p-4 flex flex-col items-center justify-center text-center"><span className="text-muted-foreground text-xs font-medium uppercase">Time</span><div className="text-2xl font-bold flex items-center mt-1"><Clock className="w-5 h-5 mr-2 text-primary"/> {formatDuration(activeJob.processingTime)}</div></CardContent></Card>
                        <Card><CardContent className="p-4 flex flex-col items-center justify-center text-center"><span className="text-muted-foreground text-xs font-medium uppercase">Success</span><div className="text-2xl font-bold flex items-center mt-1 text-green-600"><CheckCircle2 className="w-5 h-5 mr-2"/> {successCount}</div></CardContent></Card>
                        <Card><CardContent className="p-4 flex flex-col items-center justify-center text-center"><span className="text-muted-foreground text-xs font-medium uppercase">Failed</span><div className="text-2xl font-bold flex items-center mt-1 text-red-600"><XCircle className="w-5 h-5 mr-2"/> {errorCount}</div></CardContent></Card>
                        <Card><CardContent className="p-4 flex flex-col items-center justify-center text-center"><span className="text-muted-foreground text-xs font-medium uppercase">Remaining</span><div className="text-2xl font-bold flex items-center mt-1 text-blue-600"><Hourglass className="w-5 h-5 mr-2"/> {remaining}</div></CardContent></Card>
                    </div>

                    {/* --- TABLE SECTION --- */}
                    <Card className="shadow-medium h-full flex flex-col">
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div><CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" /> Processing Results</CardTitle><CardDescription>{activeJob.isProcessing ? `Processing... ${completedCount} / ${activeJob.totalToProcess}` : activeJob.isComplete ? "Job Completed" : "Waiting..."}</CardDescription></div>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={cn("cursor-pointer", statusFilter === 'all' && "bg-secondary")} onClick={() => setStatusFilter('all')}>All: {results.length}</Badge>
                                    <Badge variant="outline" className={cn("text-green-600 border-green-200 cursor-pointer", statusFilter === 'success' && "bg-green-50")} onClick={() => setStatusFilter('success')}><CheckCircle2 className="w-3 h-3 mr-1"/> {successCount}</Badge>
                                    <Badge variant="outline" className={cn("text-red-600 border-red-200 cursor-pointer", statusFilter === 'error' && "bg-red-50")} onClick={() => setStatusFilter('error')}><XCircle className="w-3 h-3 mr-1"/> {errorCount}</Badge>
                                </div>
                            </div>
                            {activeJob.isProcessing && (<div className="w-full bg-muted rounded-full h-1.5 mt-4 overflow-hidden"><div className="bg-primary h-full transition-all duration-300" style={{ width: `${progressPercent}%` }} /></div>)}
                        </CardHeader>

                        <CardContent className="flex-1 flex flex-col min-h-0 space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder={`Filter by ${primaryFieldLabel.toLowerCase()}...`} value={filterText} onChange={(e) => setFilterText(e.target.value)} className="pl-9"/></div>
                                <div className="text-sm text-muted-foreground font-medium whitespace-nowrap min-w-[80px] text-right">Found: {filteredResults.length}</div>
                                <Button variant="outline" size="icon" onClick={handleExportTxt} title="Export Filtered"><FileText className="h-4 w-4" /></Button>
                            </div>

                            <ScrollArea className="h-[600px] w-full rounded-lg border">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
                                        <tr>
                                            <th className="px-4 py-3 text-left w-12"><Hash className="h-4 w-4" /></th>
                                            <th className="px-4 py-3 text-left font-medium">{primaryFieldLabel}</th>
                                            <th className="px-4 py-3 text-left w-32">Status</th>
                                            <th className="px-4 py-3 text-left">Details</th>
                                            <th className="px-4 py-3 text-center w-20">Time</th>
                                            <th className="px-4 py-3 text-center w-20">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {paginatedResults.length === 0 ? (<tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No results found.</td></tr>) : (
                                            paginatedResults.map((result, index) => {
                                                const displayDetails = result.details || result.message || result.error;
                                                const isVerified = displayDetails?.includes('Verified');
                                                const isPending = result.stage === 'processing' || displayDetails?.includes('Verifying');
                                                const actualIndex = filteredResults.length - ((currentPage - 1) * ITEMS_PER_PAGE + index);
                                                
                                                // SMART DATA LOOKUP
                                                const createData = result.creationResponse || result.fullResponse || result.response;
                                                const verifyData = result.verifyResponse || result.verificationResponse;

                                                return (
                                                    <tr key={`${index}-${result.primaryValue}`} className="hover:bg-muted/30 transition-colors">
                                                        <td className="px-4 py-3 text-center text-muted-foreground font-mono">{actualIndex}</td>
                                                        <td className="px-4 py-3 font-medium">{result.primaryValue}</td>
                                                        <td className="px-4 py-3">
                                                            {result.success ? (
                                                                <Badge variant="outline" className={cn("border-green-200 bg-green-50 text-green-600", isVerified && "bg-blue-50 text-blue-600 border-blue-200")}>
                                                                    {isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin"/> : (isVerified ? <ShieldCheck className="w-3 h-3 mr-1"/> : <CheckCircle2 className="w-3 h-3 mr-1"/>)}
                                                                    {isVerified ? "Verified" : "Success"}
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200"><XCircle className="w-3 h-3 mr-1"/> Failed</Badge>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-muted-foreground truncate max-w-[300px]" title={displayDetails}>{displayDetails}</td>
                                                        <td className="px-4 py-3 text-center text-muted-foreground">{formatTimestamp(result.timestamp)}</td>
                                                        <td className="px-4 py-3 text-center">
                                                            <Dialog>
                                                                <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button></DialogTrigger>
                                                                <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                                                                    <DialogHeader><DialogTitle>Record Details</DialogTitle></DialogHeader>
                                                                    
                                                                    {/* SHOW FULL STATUS MESSAGE HERE */}
                                                                    <div className={`p-4 rounded-md mb-4 border ${result.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                                                        <div className="flex items-center gap-2 font-semibold mb-1">
                                                                            {result.success ? <CheckCircle2 className="h-4 w-4"/> : <XCircle className="h-4 w-4"/>}
                                                                            <span>Status Message</span>
                                                                        </div>
                                                                        <p className="text-sm whitespace-pre-wrap">{displayDetails}</p>
                                                                    </div>

                                                                    <Tabs defaultValue="create" className="w-full">
                                                                        <TabsList className="grid w-full grid-cols-2">
                                                                            <TabsTrigger value="create">1. Creation Response</TabsTrigger>
                                                                            <TabsTrigger value="verify">2. Verification Log</TabsTrigger>
                                                                        </TabsList>
                                                                        <TabsContent value="create">
                                                                            {createData ? <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono border max-h-[400px] overflow-auto">{JSON.stringify(createData, null, 2)}</pre> : <div className="p-4 text-center text-muted-foreground">No creation data available.</div>}
                                                                        </TabsContent>
                                                                        <TabsContent value="verify">
                                                                            {verifyData ? <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono border max-h-[400px] overflow-auto">{JSON.stringify(verifyData, null, 2)}</pre> : <div className="p-8 text-center text-muted-foreground border rounded-md bg-muted/20"><p>No verification data available.</p><p className="text-xs mt-1">Check 'Verify Log' setting.</p></div>}
                                                                        </TabsContent>
                                                                    </Tabs>
                                                                </DialogContent>
                                                            </Dialog>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </ScrollArea>
                            
                            {/* PAGINATION */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between px-2 pt-4 border-t mt-4">
                                    <div className="text-xs text-muted-foreground">Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredResults.length)}</div>
                                    <div className="flex items-center space-x-2">
                                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}><ChevronsLeft className="h-4 w-4" /></Button>
                                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                                        <div className="flex items-center justify-center text-sm font-medium w-[80px]">Page {currentPage} / {totalPages}</div>
                                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}><ChevronRight className="h-4 w-4" /></Button>
                                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}><ChevronsRight className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </DashboardLayout>
            <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>API Status</DialogTitle></DialogHeader>
                    <div className={`p-4 rounded-md ${apiStatus.status === 'success' ? 'bg-green-100' : 'bg-red-100'}`}><p className="font-bold">{apiStatus.status.toUpperCase()}</p><p>{apiStatus.message}</p></div>
                    {apiStatus.fullResponse && <pre className="mt-4 bg-slate-950 text-white p-4 rounded text-xs overflow-auto max-h-60">{JSON.stringify(apiStatus.fullResponse, null, 2)}</pre>}
                    <DialogFooter><Button onClick={() => setIsStatusModalOpen(false)}>Close</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ExpenseCustomModule;