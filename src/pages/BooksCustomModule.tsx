import React, { useState, useEffect, useMemo } from 'react';
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
import { cn, formatTime } from '@/lib/utils';
import { Socket } from 'socket.io-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Profile, CustomModuleJobs, CustomModuleJobState, CustomModuleFormData } from '@/App';
import { 
    Loader2, Database, Play, Pause, Square, CheckCircle2, XCircle, Clock, AlertCircle, 
    Search, FileText, BarChart3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, AlertOctagon, RotateCcw, Timer 
} from 'lucide-react';

const SERVER_URL = "http://localhost:3009";
const ITEMS_PER_PAGE = 50;

interface BooksCustomModuleProps {
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
  jobs: CustomModuleJobs;
  setJobs: React.Dispatch<React.SetStateAction<CustomModuleJobs>>;
  socket: Socket | null;
  createInitialJobState: () => CustomModuleJobState;
}

const BooksCustomModule: React.FC<BooksCustomModuleProps> = ({ 
    onAddProfile, 
    onEditProfile, 
    onDeleteProfile,
    jobs,
    setJobs,
    socket,
    createInitialJobState
}) => {
    const { toast } = useToast();
    const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
    const [isFetchingFields, setIsFetchingFields] = useState(false);
    const [nextBatchCountdown, setNextBatchCountdown] = useState<number>(0);
    
    // --- RESULT TABLE STATE ---
    const [filterText, setFilterText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
    const [currentPage, setCurrentPage] = useState(1);

    const [apiStatus, setApiStatus] = useState<{ status: 'loading' | 'success' | 'error', message: string, fullResponse?: any }>({
        status: 'loading',
        message: 'Checking connection...'
    });

    const { data: profiles = [] } = useQuery<Profile[]>({
        queryKey: ['profiles'],
        queryFn: async () => {
            const res = await fetch(`${SERVER_URL}/api/profiles`);
            if (!res.ok) throw new Error("Failed to fetch profiles");
            return res.json();
        },
    });

    const booksProfiles = profiles.filter(p => p.books && p.books.orgId);
    
    useEffect(() => {
        if (booksProfiles.length > 0 && !activeProfileName) {
            setActiveProfileName(booksProfiles[0].profileName);
        } else if (activeProfileName && !booksProfiles.find(p => p.profileName === activeProfileName)) {
            setActiveProfileName(booksProfiles.length > 0 ? booksProfiles[0].profileName : null);
        }
    }, [booksProfiles, activeProfileName]);

    const selectedProfile = booksProfiles.find(p => p.profileName === activeProfileName) || null;

    useEffect(() => {
        if (!socket || !activeProfileName) {
            setApiStatus({ status: 'loading', message: 'Waiting for profile...' });
            return;
        }

        setApiStatus({ status: 'loading', message: 'Connecting to Zoho Books...' });
        socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'books' });

        const handleStatus = (res: any) => {
            if (res.success) {
                const agentName = res.fullResponse?.agentInfo?.firstName || 'User';
                setApiStatus({ 
                    status: 'success', 
                    message: `Connected: ${res.fullResponse?.orgName} (${agentName})`,
                    fullResponse: res.fullResponse
                });
            } else {
                setApiStatus({ 
                    status: 'error', 
                    message: res.message || 'Connection Failed' 
                });
            }
        };

        socket.on('apiStatusResult', handleStatus);
        
        return () => { 
            socket.off('apiStatusResult', handleStatus); 
        };
    }, [socket, activeProfileName]);

    // --- MAIN JOB LISTENER (THE FIX) ---
    useEffect(() => {
        if (!socket) return;

        // 1. Progress Listener (Updates the table)
        const handleJobResult = (data: any) => {
            if (!activeProfileName || data.profileName !== activeProfileName) return;

            setJobs(prev => {
                const currentJob = prev[activeProfileName];
                if (!currentJob) return prev;

                const existingResults = currentJob.results || [];
                let newResults;

                // Update existing row or add new
                if (existingResults.some(r => r.identifier === data.identifier)) {
                    newResults = existingResults.map(r => 
                        r.identifier === data.identifier ? { ...r, ...data } : r
                    );
                } else {
                    newResults = [data, ...existingResults];
                }

                return {
                    ...prev,
                    [activeProfileName]: {
                        ...currentJob,
                        results: newResults
                    }
                };
            });
        };

        // 2. Countdown Listener
        const handleCountdown = (data: { profileName: string, seconds: number }) => {
            if (data.profileName === activeProfileName) {
                setNextBatchCountdown(data.seconds);
            }
        };

        // 3. Complete Listener
        const handleBulkComplete = (data: any) => {
            if (data.profileName === activeProfileName) {
                toast({ title: "Job Complete", description: "All records processed.", variant: "default" });
                setJobs(prev => ({
                    ...prev,
                    [activeProfileName]: { ...prev[activeProfileName], isProcessing: false, isPaused: false, isComplete: true }
                }));
            }
        };

        // 4. Pause Listener
        const handleJobPaused = (data: any) => {
            if (data.profileName === activeProfileName) {
                toast({ title: "Job Paused", description: data.reason, variant: "destructive" });
                setJobs(prev => ({
                    ...prev,
                    [activeProfileName]: { ...prev[activeProfileName], isPaused: true }
                }));
            }
        };

        // 5. Error Listener
        const handleBulkError = (data: any) => {
            if (data.profileName === activeProfileName) {
                toast({ title: "Job Error", description: data.message, variant: "destructive" });
                setJobs(prev => ({
                    ...prev,
                    [activeProfileName!]: { ...prev[activeProfileName!], isProcessing: false, isPaused: false }
                }));
            }
        };

        socket.on('booksCustomModuleResult', handleJobResult); // <--- WAS MISSING
        socket.on('jobCountdown', handleCountdown);
        socket.on('bulkComplete', handleBulkComplete);
        socket.on('bulkEnded', handleBulkComplete);
        socket.on('jobPaused', handleJobPaused);
        socket.on('bulkError', handleBulkError);

        return () => {
            socket.off('booksCustomModuleResult', handleJobResult);
            socket.off('jobCountdown', handleCountdown);
            socket.off('bulkComplete', handleBulkComplete);
            socket.off('bulkEnded', handleBulkComplete);
            socket.off('jobPaused', handleJobPaused);
            socket.off('bulkError', handleBulkError);
        };
    }, [socket, activeProfileName, setJobs, toast]);


    const jobState = (activeProfileName && jobs[activeProfileName]) 
        ? jobs[activeProfileName] 
        : createInitialJobState();

    const { formData, results } = jobState;

    const updateFormData = (updates: Partial<CustomModuleFormData>) => {
        if (!activeProfileName) return;
        setJobs(prev => {
            const currentJob = prev[activeProfileName] || createInitialJobState();
            return {
                ...prev,
                [activeProfileName]: {
                    ...currentJob,
                    formData: { ...currentJob.formData, ...updates }
                }
            };
        });
    };

    const recordCount = useMemo(() => {
        if (!formData.bulkData) return 0;
        return formData.bulkData.split('\n').filter(line => line.trim() !== '').length;
    }, [formData.bulkData]);

    useEffect(() => {
        if (!selectedProfile || !socket) return;
        const moduleName = selectedProfile.books?.customModuleApiName;

        if (moduleName) {
            if (formData.moduleApiName !== moduleName || !formData.availableFields?.length) {
                updateFormData({ moduleApiName: moduleName });
                setIsFetchingFields(true);
                socket.emit('fetchBooksModuleFields', { 
                    selectedProfileName: selectedProfile.profileName, 
                    moduleApiName: moduleName 
                });
            }
        } else {
            updateFormData({ moduleApiName: '', availableFields: [] });
        }
    }, [selectedProfile, socket]);

    useEffect(() => {
        if (!socket) return;
        
        const handleFieldsResult = (res: any) => {
            setIsFetchingFields(false);
            if (res.success) {
                toast({ title: "Fields Loaded", description: `Successfully loaded ${res.fields.length} fields.` });
                
                let smartBulkField = '';
                const emailField = res.fields.find((f: any) => 
                    f.data_type === 'email' || 
                    f.api_name.toLowerCase().includes('email') || 
                    f.label.toLowerCase().includes('email')
                );
                
                if (emailField) smartBulkField = emailField.api_name;

                updateFormData({ availableFields: res.fields, bulkField: smartBulkField });
            } else {
                toast({ title: "Fetch Failed", description: res.error, variant: "destructive" });
            }
        };

        socket.on('booksModuleFieldsResult', handleFieldsResult);
        return () => { socket.off('booksModuleFieldsResult', handleFieldsResult); };
    }, [socket, activeProfileName, toast]);

    const handleStartJob = () => {
        if (!activeProfileName || !formData.bulkField || !formData.bulkData) return;

        const items = formData.bulkData.split('\n').filter(x => x.trim());
        
        setJobs(prev => ({
            ...prev,
            [activeProfileName]: {
                ...prev[activeProfileName],
                isProcessing: true,
                isPaused: false,
                isComplete: false,
                processingStartTime: new Date(),
                processingTime: 0,
                totalToProcess: items.length,
                results: []
            }
        }));

        socket?.emit('startBulkBooksCustomJob', {
            selectedProfileName: activeProfileName,
            moduleApiName: formData.moduleApiName,
            bulkData: formData.bulkData,
            staticData: formData.staticData,
            bulkField: formData.bulkField,
            delay: formData.delay,
            concurrency: formData.concurrency,
            stopAfterFailures: formData.stopAfterFailures,
            activeProfile: selectedProfile
        });
    };

    // --- FIXED PAUSE/RESUME LOGIC ---
    const handlePauseResume = () => {
        if (!activeProfileName || !jobState) return;

        if (jobState.isPaused) {
            // RESUME: Calculate what to skip and restart
            const processedIds = results
                .filter(r => r.success)
                .map(r => r.identifier);

            const items = formData.bulkData.split('\n').filter(x => x.trim());

            // Optimistic Update
            setJobs(prev => ({
                ...prev,
                [activeProfileName]: {
                    ...prev[activeProfileName],
                    isPaused: false,
                    isProcessing: true, // Ensure processing is true
                    totalToProcess: items.length
                }
            }));

            // Emit smart resume (Start job + skip list)
            socket?.emit('startBulkBooksCustomJob', {
                selectedProfileName: activeProfileName,
                moduleApiName: formData.moduleApiName,
                bulkData: formData.bulkData,
                staticData: formData.staticData,
                bulkField: formData.bulkField,
                delay: formData.delay,
                concurrency: formData.concurrency,
                stopAfterFailures: formData.stopAfterFailures,
                activeProfile: selectedProfile,
                processedIds: processedIds // <--- Server will skip these
            });
            
            toast({ title: "Resuming Job", description: `Skipping ${processedIds.length} already completed items.` });

        } else {
            // PAUSE
            socket?.emit('pauseJob', { profileName: activeProfileName, jobType: 'books-custom' });
            
            setJobs(prev => ({
                ...prev,
                [activeProfileName]: { ...prev[activeProfileName], isPaused: true }
            }));
        }
    };

    const handleRetryFailed = () => {
        if (!activeProfileName) return;
        
        const failedItems = results
            .filter(r => !r.success && r.stage === 'complete')
            .map(r => r.identifier)
            .join('\n');
        
        if (!failedItems) return toast({ title: "No failed items found" });

        updateFormData({ bulkData: failedItems });
        
        setJobs(prev => ({
            ...prev,
            [activeProfileName]: {
                ...prev[activeProfileName],
                isProcessing: false,
                isPaused: false,
                isComplete: false,
                processingTime: 0,
                totalToProcess: failedItems.split('\n').length,
                results: []
            }
        }));
        toast({ title: "Retry Ready", description: "Failed items reloaded." });
    };

    const handleStaticChange = (apiName: string, value: string) => {
        updateFormData({ staticData: { ...formData.staticData, [apiName]: value } });
    };

    const handleManualVerify = () => {
        if (activeProfileName && socket) {
            setApiStatus({ status: 'loading', message: 'Re-checking connection...' });
            socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'books' });
        }
    };

    const getFieldLabel = (field: any) => {
        let label = field.label || field.api_name || '';
        if (label.includes('_') || label.startsWith('cf_')) {
            label = label.replace(/^cf_/, '').replace(/_/g, ' ');
            label = label.replace(/\b\w/g, (char: string) => char.toUpperCase());
        }
        return label;
    };

    const formatTimestamp = (dateInput?: Date) => {
        if (!dateInput) return '-';
        const date = new Date(dateInput);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };

    useEffect(() => { setCurrentPage(1); }, [filterText, statusFilter]);

    const filteredResults = useMemo(() => {
        let res = results;
        if (statusFilter === 'success') res = res.filter(r => r.success);
        else if (statusFilter === 'error') res = res.filter(r => !r.success && r.stage === 'complete');

        if (filterText) {
            const lowerFilter = filterText.toLowerCase();
            res = res.filter(r => 
                r.identifier.toLowerCase().includes(lowerFilter) ||
                (r.details || '').toLowerCase().includes(lowerFilter)
            );
        }
        return res;
    }, [results, filterText, statusFilter]);

    const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);
    const paginatedResults = useMemo(() => {
        const reversed = [...filteredResults].reverse();
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return reversed.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredResults, currentPage]);

    const completedCount = results.filter(r => r.stage === 'complete').length;
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => r.stage === 'complete' && !r.success).length;
    const progressPercent = jobState.totalToProcess > 0 ? (completedCount / jobState.totalToProcess) * 100 : 0;
    const remainingCount = jobState.totalToProcess - completedCount;

    const handleExportTxt = () => {
        const content = filteredResults.map(r => `${r.identifier} - ${r.success ? 'Success' : 'Error'} - ${r.details}`).join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `books_custom_results.txt`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const currentBulkFieldObj = formData.availableFields?.find(f => f.api_name === formData.bulkField);

    return (
        <DashboardLayout
            onAddProfile={onAddProfile}
            profiles={booksProfiles}
            selectedProfile={selectedProfile}
            onProfileChange={setActiveProfileName}
            jobs={jobs}
            socket={socket}
            onEditProfile={onEditProfile}
            onDeleteProfile={onDeleteProfile}
            service="books"
            apiStatus={apiStatus}
            onManualVerify={handleManualVerify}
        >
            <div className="space-y-6">
                <Card className="shadow-medium border-l-4 border-l-purple-500">
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <Database className="h-5 w-5 text-purple-600" />
                            <span>Books Custom Module Manager</span>
                        </CardTitle>
                        <CardDescription>
                            {formData.moduleApiName ? (
                                <span className="flex items-center gap-2">
                                    Target Module: <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">{formData.moduleApiName}</span>
                                </span>
                            ) : ( "No Custom Module configured." )}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        
                        {!formData.moduleApiName && (
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Configuration Required</AlertTitle>
                                <AlertDescription>
                                    This Books account does not have a <strong>Custom Module API Name</strong> set. 
                                    Please click the <strong>Settings (Gear Icon)</strong> next to the profile name to configure it.
                                </AlertDescription>
                            </Alert>
                        )}

                        {isFetchingFields && (
                            <div className="flex justify-center items-center py-8 text-muted-foreground">
                                <Loader2 className="animate-spin h-6 w-6 mr-2" />
                                <span>Fetching Books module fields...</span>
                            </div>
                        )}

                        {formData.availableFields && formData.availableFields.length > 0 && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2">
                                
                                <div className="space-y-4 border-r pr-0 lg:pr-8">
                                    <div className="space-y-2">
                                        <Label className="text-primary font-bold">Step 1: Iterator Field (Bulk Value)</Label>
                                        <Select 
                                            value={formData.bulkField} 
                                            onValueChange={v => updateFormData({ bulkField: v })}
                                            disabled={jobState.isProcessing}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select the field to iterate..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {formData.availableFields.map(f => (
                                                    <SelectItem key={f.api_name} value={f.api_name}>{getFieldLabel(f)}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">This field will change for every record.</p>
                                    </div>

                                    {formData.bulkField && (
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <Label>Bulk Data for <strong>{currentBulkFieldObj ? getFieldLabel(currentBulkFieldObj) : formData.bulkField}</strong></Label>
                                                <Badge variant="secondary" className="text-xs font-mono">{recordCount} Records</Badge>
                                            </div>
                                            <Textarea 
                                                className="min-h-[300px] font-mono" 
                                                value={formData.bulkData}
                                                onChange={e => updateFormData({ bulkData: e.target.value })}
                                                disabled={jobState.isProcessing}
                                                placeholder="Value 1&#10;Value 2&#10;Value 3"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    <Label className="text-primary font-bold">Step 2: Static Fields (Common Data)</Label>
                                    
                                    <div className="space-y-3 max-h-[400px] overflow-y-auto p-1 pr-2 border rounded-md bg-muted/10">
                                        {formData.availableFields
                                            .filter(f => f.api_name !== formData.bulkField)
                                            .map(f => (
                                            <div key={f.api_name} className="grid gap-1.5">
                                                <Label className="text-xs font-semibold text-muted-foreground">
                                                    {getFieldLabel(f)}
                                                    {f.is_mandatory && <span className="text-red-500 ml-1">*</span>}
                                                </Label>
                                                <Input 
                                                    value={formData.staticData[f.api_name] || ''}
                                                    onChange={e => handleStaticChange(f.api_name, e.target.value)}
                                                    placeholder={f.default_value || ''} 
                                                    disabled={jobState.isProcessing}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <div className="pt-4 border-t grid grid-cols-3 gap-4">
                                        <div>
                                            <Label>Delay (s)</Label>
                                            <Input type="number" min="0" value={formData.delay} onChange={e => updateFormData({ delay: Number(e.target.value) })} className="mt-1" disabled={jobState.isProcessing}/>
                                        </div>
                                        <div>
                                            <Label>Concurrency</Label>
                                            <Input type="number" min="1" max="10" value={formData.concurrency} onChange={e => updateFormData({ concurrency: Number(e.target.value) })} className="mt-1" disabled={jobState.isProcessing}/>
                                        </div>
                                        <div>
                                            <Label className="flex items-center text-red-600/80"><AlertOctagon className="h-3 w-3 mr-1" /> Auto-Pause</Label>
                                            <Input type="number" min="0" value={formData.stopAfterFailures} onChange={e => updateFormData({ stopAfterFailures: Number(e.target.value) })} className="mt-1" disabled={jobState.isProcessing} placeholder="0 (Off)"/>
                                        </div>
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

                        <div className="pt-6 border-t space-y-4">
                            {!jobState.isProcessing ? (
                                <div className="flex gap-4">
                                    <Button className="flex-1" size="lg" onClick={handleStartJob} disabled={!formData.bulkField || !formData.bulkData}>
                                        <Play className="mr-2 h-4 w-4" /> Start Bulk Job
                                    </Button>
                                    
                                    {errorCount > 0 && (
                                        <Button size="lg" variant="secondary" className="border border-red-200 text-red-700 hover:bg-red-50" onClick={handleRetryFailed}>
                                            <RotateCcw className="mr-2 h-4 w-4" /> Retry Failed ({errorCount})
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div className="flex gap-4">
                                    <Button className="flex-1" variant="outline" onClick={handlePauseResume}>
                                        {jobState.isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                                        {jobState.isPaused ? "Resume" : "Pause"}
                                    </Button>
                                    <Button className="flex-1" variant="destructive" onClick={() => socket?.emit('endJob', { profileName: activeProfileName, jobType: 'books-custom' })}>
                                        <Square className="mr-2 h-4 w-4" /> Stop
                                    </Button>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {results.length > 0 && (
                    <Card className="shadow-medium hover:shadow-large transition-all duration-300">
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2"><BarChart3 className="h-5 w-5 text-primary" /><CardTitle className="text-lg">Processing Results</CardTitle></div>
                                <div className="flex items-center space-x-3 select-none">
                                    <Badge variant="outline" className={cn("cursor-pointer", statusFilter === 'all' ? "bg-primary text-primary-foreground" : "text-muted-foreground")} onClick={() => setStatusFilter('all')}>All: {results.length}</Badge>
                                    <Badge variant="outline" className={cn("bg-green-500/10 text-green-600 cursor-pointer border-transparent hover:border-green-200", statusFilter === 'success' && "ring-2 ring-green-500")} onClick={() => setStatusFilter(statusFilter === 'success' ? 'all' : 'success')}><CheckCircle2 className="h-3 w-3 mr-1" /> {successCount} Success</Badge>
                                    {errorCount > 0 && <Badge variant="destructive" className={cn("bg-destructive/10 cursor-pointer border-transparent", statusFilter === 'error' && "ring-2 ring-destructive")} onClick={() => setStatusFilter(statusFilter === 'error' ? 'all' : 'error')}><XCircle className="h-3 w-3 mr-1" /> {errorCount} Errors</Badge>}
                                </div>
                            </div>
                            
                            {/* --- DELAY COUNTDOWN DISPLAY --- */}
                            <div className="flex justify-between items-center mt-2">
                                <CardDescription>{jobState.isProcessing ? `Processing... ${completedCount} / ${jobState.totalToProcess} complete.` : `Completed.`}</CardDescription>
                                
                                {jobState.isProcessing && nextBatchCountdown > 0 && (
                                    <Badge variant="secondary" className="animate-pulse flex items-center gap-1 border-blue-200 bg-blue-50 text-blue-700">
                                        <Timer className="h-3 w-3" /> Next batch in {nextBatchCountdown}s
                                    </Badge>
                                )}
                            </div>
                        </CardHeader>

                        <CardContent>
                            {jobState.isProcessing && <div className="w-full bg-muted rounded-full h-2 mb-6"><div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }} /></div>}

                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3 flex-1">
                                    <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Filter results..." value={filterText} onChange={(e) => setFilterText(e.target.value)} className="pl-10" /></div>
                                    <div className="text-sm text-muted-foreground font-medium whitespace-nowrap">Found: {filteredResults.length}</div>
                                </div>
                                <Button variant="outline" size="sm" onClick={handleExportTxt} disabled={filteredResults.length === 0}><FileText className="h-4 w-4 mr-2"/> Export (.txt)</Button>
                            </div>

                            <ScrollArea className="h-[600px] w-full rounded-lg border">
                                <table className="w-full">
                                    <thead className="bg-muted/50 sticky top-0 z-10">
                                        <tr>
                                            <th className="p-3 text-left text-xs font-medium text-muted-foreground w-16">Row #</th>
                                            <th className="p-3 text-left text-xs font-medium text-muted-foreground">Identifier</th>
                                            <th className="p-3 text-left text-xs font-medium text-muted-foreground">Status / Details</th>
                                            <th className="p-3 text-center text-xs font-medium text-muted-foreground w-20">Time</th>
                                            <th className="p-3 text-center text-xs font-medium text-muted-foreground w-24">Result</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-card divide-y divide-border">
                                        {paginatedResults.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No results match your filter.</td></tr>) : (
                                            paginatedResults.map((result) => (
                                                <tr key={result.rowNumber} className={result.stage === 'complete' && !result.success ? 'bg-destructive/5' : ''}>
                                                    <td className="p-3 text-sm font-mono text-center text-muted-foreground">{result.rowNumber}</td>
                                                    <td className="p-3 text-sm font-mono">{result.identifier}</td>
                                                    <td className={`p-3 text-sm ${result.stage === 'complete' && !result.success ? 'text-destructive' : 'text-muted-foreground'}`}>{result.details}</td>
                                                    <td className="p-3 text-center text-xs text-muted-foreground">{formatTimestamp(result.timestamp)}</td>
                                                    <td className="p-3 text-center">
                                                        <div className="flex items-center justify-center space-x-2">
                                                            {result.stage === 'processing' ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/> : (result.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />)}
                                                            {(result.response || result.fullResponse) && (
                                                                <Dialog>
                                                                    <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button></DialogTrigger>
                                                                    <DialogContent className="max-w-2xl">
                                                                        <DialogHeader><DialogTitle>API Response</DialogTitle></DialogHeader>
                                                                        <pre className="mt-2 max-h-[60vh] overflow-y-auto rounded-md bg-muted p-4 text-xs font-mono">{JSON.stringify(result.response || result.fullResponse, null, 2)}</pre>
                                                                    </DialogContent>
                                                                </Dialog>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </ScrollArea>
                            {/* Pagination Logic */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between py-4 border-t mt-4">
                                    <div className="text-xs text-muted-foreground">Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredResults.length)} of {filteredResults.length} entries</div>
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
    );
};

export default BooksCustomModule;