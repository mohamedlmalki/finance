import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn, formatTime } from '@/lib/utils';
import { Socket } from 'socket.io-client';
import { Profile, ContactJobs, ContactJobState, ContactFormData } from '@/App';
import { 
    Loader2, Users, Play, Pause, Square, CheckCircle2, XCircle, AlertOctagon, 
    Search, FileText, BarChart3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, RotateCcw, Timer 
} from 'lucide-react';

const SERVER_URL = "http://localhost:3009";
const ITEMS_PER_PAGE = 50;

interface BillingContactsProps {
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
  jobs: ContactJobs;
  setJobs: React.Dispatch<React.SetStateAction<ContactJobs>>;
  socket: Socket | null;
  createInitialJobState: () => ContactJobState;
}

const BillingContacts: React.FC<BillingContactsProps> = ({ 
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
    const [nextBatchCountdown, setNextBatchCountdown] = useState<number>(0);
    
    // --- RESULT TABLE STATE ---
    const [filterText, setFilterText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
    const [currentPage, setCurrentPage] = useState(1);

    const [apiStatus, setApiStatus] = useState<{ status: 'loading' | 'success' | 'error', message: string, fullResponse?: any }>({
        status: 'loading',
        message: 'Checking connection...'
    });

    // 1. Fetch Profiles
    const { data: profiles = [] } = useQuery<Profile[]>({
        queryKey: ['profiles'],
        queryFn: async () => {
            const res = await fetch(`${SERVER_URL}/api/profiles`);
            if (!res.ok) throw new Error("Failed to fetch profiles");
            return res.json();
        },
    });

    const billingProfiles = profiles.filter(p => p.billing && p.billing.orgId);
    
    // 2. Select Profile
    useEffect(() => {
        if (billingProfiles.length > 0 && !activeProfileName) {
            setActiveProfileName(billingProfiles[0].profileName);
        } else if (activeProfileName && !billingProfiles.find(p => p.profileName === activeProfileName)) {
            setActiveProfileName(billingProfiles.length > 0 ? billingProfiles[0].profileName : null);
        }
    }, [billingProfiles, activeProfileName]);

    const selectedProfile = billingProfiles.find(p => p.profileName === activeProfileName) || null;

    // 3. API Status Check & Listeners
    useEffect(() => {
        if (!socket || !activeProfileName) {
            setApiStatus({ status: 'loading', message: 'Waiting for profile...' });
            return;
        }

        setApiStatus({ status: 'loading', message: 'Connecting to Zoho Billing...' });
        socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'billing' });

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

        // 1. Progress Listener
        const handleJobResult = (data: any) => {
            if (!activeProfileName || data.profileName !== activeProfileName) return;

            setJobs(prev => {
                const currentJob = prev[activeProfileName];
                if (!currentJob) return prev;

                const existingResults = currentJob.results || [];
                let newResults;

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
                toast({ title: "Job Complete", description: "All contacts processed.", variant: "default" });
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

        socket.on('billingContactResult', handleJobResult); // <--- WAS MISSING
        socket.on('jobCountdown', handleCountdown);
        socket.on('bulkComplete', handleBulkComplete);
        socket.on('bulkEnded', handleBulkComplete);
        socket.on('jobPaused', handleJobPaused);
        socket.on('bulkError', handleBulkError);

        return () => {
            socket.off('billingContactResult', handleJobResult);
            socket.off('jobCountdown', handleCountdown);
            socket.off('bulkComplete', handleBulkComplete);
            socket.off('bulkEnded', handleBulkComplete);
            socket.off('jobPaused', handleJobPaused);
            socket.off('bulkError', handleBulkError);
        };
    }, [socket, activeProfileName, setJobs, toast]);


    // 4. Job State Management
    const jobState = (activeProfileName && jobs[activeProfileName]) 
        ? jobs[activeProfileName] 
        : createInitialJobState();

    const { formData, results } = jobState;

    const updateFormData = (updates: Partial<ContactFormData>) => {
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

    const emailCount = formData.emails ? formData.emails.split(/[\n,]+/).filter(e => e.trim() !== '').length : 0;

    // 5. Start Job
    const handleStartJob = () => {
        if (!activeProfileName || !formData.emails) return;

        const emailList = formData.emails.split(/[\n,]+/).map(e => e.trim()).filter(e => e !== '');
        
        setJobs(prev => ({
            ...prev,
            [activeProfileName]: {
                ...prev[activeProfileName],
                isProcessing: true,
                isPaused: false,
                isComplete: false,
                processingStartTime: new Date(),
                processingTime: 0,
                totalToProcess: emailList.length,
                results: []
            }
        }));

        socket?.emit('startBulkBillingContact', {
            selectedProfileName: activeProfileName,
            formData: formData,
            activeProfile: selectedProfile
        });
    };

    // --- FIXED PAUSE/RESUME LOGIC ---
    const handlePauseResume = () => {
        if (!activeProfileName || !jobState) return;

        if (jobState.isPaused) {
            // RESUME: Calculate skipped IDs
            const processedIds = results
                .filter(r => r.success)
                .map(r => r.identifier);

             const emailList = formData.emails.split(/[\n,]+/).map(e => e.trim()).filter(e => e !== '');

            // Optimistic Update
            setJobs(prev => ({
                ...prev,
                [activeProfileName]: {
                    ...prev[activeProfileName],
                    isPaused: false,
                    isProcessing: true,
                    totalToProcess: emailList.length
                }
            }));

            // Emit smart resume
            socket?.emit('startBulkBillingContact', {
                selectedProfileName: activeProfileName,
                formData: formData,
                activeProfile: selectedProfile,
                processedIds: processedIds // <--- Server will skip these
            });
            
            toast({ title: "Resuming Job", description: `Skipping ${processedIds.length} already completed items.` });

        } else {
            // PAUSE
            socket?.emit('pauseJob', { profileName: activeProfileName, jobType: 'billing-contact' });
            
            setJobs(prev => ({
                ...prev,
                [activeProfileName]: { ...prev[activeProfileName], isPaused: true }
            }));
        }
    };

    const handleRetryFailed = () => {
        if (!activeProfileName) return;
        
        const failedEmails = results
            .filter(r => !r.success && r.stage === 'complete')
            .map(r => r.identifier)
            .join('\n');
        
        if (!failedEmails) return toast({ title: "No failed items found" });

        updateFormData({ emails: failedEmails });
        
        setJobs(prev => ({
            ...prev,
            [activeProfileName]: {
                ...prev[activeProfileName],
                isProcessing: false,
                isPaused: false,
                isComplete: false,
                processingTime: 0,
                totalToProcess: failedEmails.split('\n').length,
                results: []
            }
        }));
        toast({ title: "Retry Ready", description: "Failed emails reloaded." });
    };

    const handleManualVerify = () => {
        if (activeProfileName && socket) {
            setApiStatus({ status: 'loading', message: 'Re-checking connection...' });
            socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'billing' });
        }
    };

    const handleStopJob = () => {
         socket?.emit('endJob', { profileName: activeProfileName, jobType: 'billing-contact' });
         setJobs(prev => ({
             ...prev,
             [activeProfileName!]: { ...prev[activeProfileName!], isProcessing: false, isPaused: false }
         }));
    };

    // --- RENDER HELPERS ---
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
    
    const handleExportTxt = () => {
        const content = filteredResults.map(r => `${r.identifier} - ${r.success ? 'Success' : 'Error'} - ${r.details}`).join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `billing_customers_results.txt`;
        link.click();
    };

    const formatTimestamp = (dateInput?: Date) => {
        if (!dateInput) return '-';
        const date = new Date(dateInput);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    };

    return (
        <DashboardLayout
            onAddProfile={onAddProfile}
            profiles={billingProfiles}
            selectedProfile={selectedProfile}
            onProfileChange={setActiveProfileName}
            jobs={jobs}
            socket={socket}
            onEditProfile={onEditProfile}
            onDeleteProfile={onDeleteProfile}
            service="billing"
            apiStatus={apiStatus}
            onManualVerify={handleManualVerify}
        >
            <div className="space-y-6">
                
                {/* FORM CARD */}
                <Card className="shadow-medium border-l-4 border-l-green-500">
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <Users className="h-5 w-5 text-green-600" />
                            <span>Billing Bulk Customer Manager</span>
                        </CardTitle>
                        <CardDescription>Create customers in Zoho Billing in bulk.</CardDescription>
                    </CardHeader>
                    <CardContent>
                         <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Left Column: Email List */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-primary font-bold">Customer Emails</Label>
                                        <Badge variant="secondary" className="text-xs font-mono">{emailCount} Emails</Badge>
                                    </div>
                                    <Textarea 
                                        placeholder="customer1@domain.com&#10;customer2@domain.com" 
                                        className="min-h-[200px] font-mono shadow-sm focus:ring-2 focus:ring-primary/20 transition-all"
                                        value={formData.emails}
                                        onChange={(e) => updateFormData({ emails: e.target.value })}
                                        disabled={jobState.isProcessing}
                                    />
                                    <p className="text-xs text-muted-foreground">One email per line.</p>
                                </div>

                                {/* Right Column: Settings */}
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <Label className="text-primary font-bold">Display Name (Applied to all)</Label>
                                        <Input 
                                            placeholder="e.g. Valued Customer" 
                                            value={formData.displayNames || ''}
                                            onChange={(e) => updateFormData({ displayNames: e.target.value })}
                                            disabled={jobState.isProcessing}
                                        />
                                        <p className="text-xs text-muted-foreground">This name will be used for EVERY customer created.</p>
                                    </div>

                                    <div className="space-y-4 border p-4 rounded-lg bg-muted/10">
                                        <Label className="text-primary font-bold border-b pb-2 block">Settings</Label>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Delay (Seconds)</Label>
                                                <Input type="number" min="0" value={formData.delay} onChange={(e) => updateFormData({ delay: Number(e.target.value) })} disabled={jobState.isProcessing} />
                                            </div>
                                             <div className="space-y-2">
                                                <Label className="flex items-center text-red-600/80"><AlertOctagon className="h-3 w-3 mr-1" /> Auto-Pause</Label>
                                                <Input type="number" min="0" placeholder="0 (Off)" value={formData.stopAfterFailures} onChange={(e) => updateFormData({ stopAfterFailures: Number(e.target.value) })} disabled={jobState.isProcessing} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="pt-4">
                                        {!jobState.isProcessing ? (
                                            <div className="flex gap-4">
                                                <Button className="flex-1 shadow-lg hover:shadow-xl transition-all" size="lg" onClick={handleStartJob} disabled={emailCount === 0}>
                                                    <Play className="mr-2 h-4 w-4" /> Start Creating
                                                </Button>
                                                {errorCount > 0 && (
                                                    <Button size="lg" variant="secondary" className="border border-red-200 text-red-700 hover:bg-red-50" onClick={handleRetryFailed}>
                                                        <RotateCcw className="mr-2 h-4 w-4" /> Retry Failed
                                                    </Button>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex gap-4">
                                                <Button className="flex-1" variant="outline" onClick={handlePauseResume}>
                                                    {jobState.isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                                                    {jobState.isPaused ? "Resume" : "Pause"}
                                                </Button>
                                                <Button className="flex-1" variant="destructive" onClick={handleStopJob}>
                                                    <Square className="mr-2 h-4 w-4" /> Stop
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* RESULTS TABLE */}
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
                            
                            <div className="flex justify-between items-center mt-2">
                                <CardDescription>{jobState.isProcessing ? `Processing... ${completedCount} / ${jobState.totalToProcess} complete.` : `Completed.`}</CardDescription>
                                {jobState.isProcessing && nextBatchCountdown > 0 && (
                                    <Badge variant="secondary" className="animate-pulse flex items-center gap-1 border-blue-200 bg-blue-50 text-blue-700">
                                        <Timer className="h-3 w-3" /> Next in {nextBatchCountdown}s
                                    </Badge>
                                )}
                            </div>
                        </CardHeader>
                        
                        <CardContent>
                            {jobState.isProcessing && <div className="w-full bg-muted rounded-full h-2 mb-6 overflow-hidden"><div className="bg-primary h-2 rounded-full transition-all duration-300 ease-out" style={{ width: `${progressPercent}%` }} /></div>}

                            <div className="flex items-center justify-between mb-4">
                                 <div className="flex items-center gap-3 flex-1">
                                    <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Filter by email..." value={filterText} onChange={(e) => setFilterText(e.target.value)} className="pl-10" /></div>
                                    <div className="text-sm text-muted-foreground font-medium whitespace-nowrap">Found: {filteredResults.length}</div>
                                </div>
                                <Button variant="outline" size="sm" onClick={handleExportTxt} disabled={filteredResults.length === 0}><FileText className="h-4 w-4 mr-2"/> Export (.txt)</Button>
                            </div>

                            <ScrollArea className="h-[500px] w-full rounded-lg border">
                                <table className="w-full">
                                    <thead className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
                                        <tr>
                                            <th className="p-3 text-left text-xs font-medium text-muted-foreground w-16">#</th>
                                            <th className="p-3 text-left text-xs font-medium text-muted-foreground">Identifier</th>
                                            <th className="p-3 text-left text-xs font-medium text-muted-foreground">Status / Details</th>
                                            <th className="p-3 text-center text-xs font-medium text-muted-foreground w-24">Time</th>
                                            <th className="p-3 text-center text-xs font-medium text-muted-foreground w-20">View</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-card divide-y divide-border">
                                        {paginatedResults.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No results found.</td></tr>) : (
                                            paginatedResults.map((result) => (
                                                <tr key={result.rowNumber} className="group hover:bg-muted/30 transition-colors">
                                                    <td className="p-3 text-sm font-mono text-center text-muted-foreground">{result.rowNumber}</td>
                                                    <td className="p-3 text-sm font-medium">{result.identifier}</td>
                                                    <td className={cn("p-3 text-sm", result.stage === 'complete' && !result.success ? 'text-destructive' : 'text-muted-foreground')}>{result.details}</td>
                                                    <td className="p-3 text-center text-xs text-muted-foreground font-mono">{formatTimestamp(result.timestamp)}</td>
                                                    <td className="p-3 text-center">
                                                         <div className="flex items-center justify-center space-x-2">
                                                            {result.stage === 'processing' ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/> : (result.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />)}
                                                            {(result.response || result.fullResponse) && (
                                                                <Dialog>
                                                                    <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 opacity-50 group-hover:opacity-100"><Eye className="h-4 w-4" /></Button></DialogTrigger>
                                                                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                                                                        <DialogHeader><DialogTitle>API Response</DialogTitle></DialogHeader>
                                                                        <pre className="mt-2 rounded-md bg-slate-950 p-4 text-xs font-mono text-slate-50 overflow-x-auto">{JSON.stringify(result.response || result.fullResponse, null, 2)}</pre>
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
                            {/* Pagination */}
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

export default BillingContacts;