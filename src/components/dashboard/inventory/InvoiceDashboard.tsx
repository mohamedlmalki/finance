import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import { DashboardLayout } from '../DashboardLayout';
import { useToast } from '@/hooks/use-toast';
import { Profile, InvoiceJobs, InvoiceJobState, InvoiceFormData } from '@/App';
import { InvoiceForm } from './InvoiceForm';
import { InvoiceResultsDisplay } from './InvoiceResultsDisplay';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ApiStatus = {
  status: 'loading' | 'success' | 'error';
  message: string;
  fullResponse?: any;
};

interface InvoiceDashboardProps {
  jobs: InvoiceJobs;
  setJobs: React.Dispatch<React.SetStateAction<InvoiceJobs>>;
  socket: Socket | null;
  createInitialJobState: () => InvoiceJobState;
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
}

const SERVER_URL = "http://localhost:3009";

export const InvoiceDashboard: React.FC<InvoiceDashboardProps> = ({ 
    jobs, setJobs, socket, createInitialJobState, onAddProfile, onEditProfile, onDeleteProfile
}) => {
  const { toast } = useToast();
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ status: 'loading', message: 'Connecting to server...', fullResponse: null });
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [isLoadingName, setIsLoadingName] = useState(false);
  
  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const response = await fetch(`${SERVER_URL}/api/profiles`);
      if (!response.ok) throw new Error('Could not connect to the server.');
      return response.json();
    },
    refetchOnWindowFocus: false,
  });

  const inventoryProfiles = profiles.filter(p => p.inventory?.orgId);
  
  useEffect(() => {
    if (inventoryProfiles.length > 0) {
        setJobs(prevJobs => {
            const newJobs = { ...prevJobs };
            let updated = false;
            inventoryProfiles.forEach(p => {
                if (!newJobs[p.profileName]) {
                    newJobs[p.profileName] = createInitialJobState();
                    updated = true;
                }
            });
            return updated ? newJobs : prevJobs;
        });
    }
    if (inventoryProfiles.length > 0 && !activeProfileName) {
      setActiveProfileName(inventoryProfiles[0]?.profileName || null);
    }
  }, [inventoryProfiles, activeProfileName, setJobs, createInitialJobState]);
  
  useEffect(() => {
    if (!socket) return;

    socket.emit('requestDatabaseSync');

    const handleApiStatus = (result: any) => setApiStatus({
      status: result.success ? 'success' : 'error', message: result.message, fullResponse: result.fullResponse || null
    });

    const handleOrgDetails = (result: any) => {
      setIsLoadingName(false);
      if (result.success) setDisplayName(result.data.displayName || result.data.contact_name || 'N/A');
      else toast({ title: "Error Fetching Sender Name", description: result.error, variant: "destructive" });
    };
    
    const handleUpdateOrg = (result: any) => {
       if (result.success) {
        setDisplayName(result.data.displayName || result.data.contact_name);
        toast({ title: "Success", description: "Sender name has been updated." });
      } else {
        toast({ title: "Error Updating Name", description: result.error, variant: "destructive" });
      }
    };

    const handleDeleteResult = (result: any) => {
        if (result.success) toast({ title: "Deleted", description: result.message, className: "bg-green-600 text-white" });
        else toast({ title: "Delete Failed", description: result.error, variant: "destructive" });
    };

    const handleInvoiceResult = (result: any) => {
        if (result.profileName !== activeProfileName) return;
        setJobs(prev => {
            const profileJob = prev[activeProfileName] || createInitialJobState();
            const existingIndex = profileJob.results.findIndex(r => r.email === result.email);
            let newResults = [...profileJob.results];
            if (existingIndex >= 0) newResults[existingIndex] = { ...newResults[existingIndex], ...result };
            else newResults.push(result);
            return { ...prev, [activeProfileName]: { ...profileJob, results: newResults } };
        });
    };

    // --- NEW WIPE LISTENERS ---
    const handleJobCleared = (data: any) => {
        if (data.jobType === 'invoice' && data.profileName === activeProfileName) {
            setJobs(prev => {
                const current = prev[activeProfileName] || createInitialJobState();
                return {
                    ...prev,
                    [activeProfileName]: {
                        ...current,
                        results: [],
                        totalToProcess: 0,
                        isProcessing: false,
                        isPaused: false,
                        formData: { ...current.formData, emails: '' }
                    }
                };
            });
            toast({ title: "Database Wiped", description: `All data cleared for ${data.profileName}` });
        }
    };

    const handleAllJobsCleared = (data: any) => {
        if (data.jobType === 'invoice') {
            setJobs(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(profile => {
                    next[profile] = {
                        ...next[profile],
                        results: [],
                        totalToProcess: 0,
                        isProcessing: false,
                        isPaused: false,
                        formData: { ...next[profile].formData, emails: '' }
                    };
                });
                return next;
            });
            toast({ title: "Master Wipe Complete", description: "All invoice databases have been wiped." });
        }
    };
    
    socket.on('apiStatusResult', handleApiStatus);
    socket.on('orgDetailsResult', handleOrgDetails);
    socket.on('updateOrgDetailsResult', handleUpdateOrg);
    socket.on('deleteInvoicesResult', handleDeleteResult);
    socket.on('invoiceResult', handleInvoiceResult);
    socket.on('jobPaused', () => { if (activeProfileName) setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isPaused: true }})); });
    socket.on('bulkEnded', () => { if (activeProfileName) setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isProcessing: false, isPaused: false }})); });
    socket.on('bulkComplete', () => { if (activeProfileName) setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isProcessing: false, isPaused: false }})); });
    socket.on('jobCleared', handleJobCleared);
    socket.on('allJobsCleared', handleAllJobsCleared);

    return () => {
      socket.off('apiStatusResult', handleApiStatus);
      socket.off('orgDetailsResult', handleOrgDetails);
      socket.off('updateOrgDetailsResult', handleUpdateOrg);
      socket.off('deleteInvoicesResult', handleDeleteResult);
      socket.off('invoiceResult', handleInvoiceResult);
      socket.off('jobPaused');
      socket.off('bulkEnded');
      socket.off('bulkComplete');
      socket.off('jobCleared', handleJobCleared);
      socket.off('allJobsCleared', handleAllJobsCleared);
    };
  }, [socket, toast, activeProfileName, setJobs, createInitialJobState]);

  const fetchDisplayName = () => {
    if (activeProfileName && socket) {
      setIsLoadingName(true);
      socket.emit('getOrgDetails', { selectedProfileName: activeProfileName });
    }
  };
  
  useEffect(() => { fetchDisplayName(); }, [activeProfileName, socket]);

  useEffect(() => {
    if (activeProfileName && socket?.connected) {
      setApiStatus({ status: 'loading', message: 'Checking API connection...' });
      socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'inventory' });
    }
  }, [activeProfileName, socket]);

  const handleProfileChange = (profileName: string) => {
    const profile = inventoryProfiles.find(p => p.profileName === profileName);
    if (profile) {
      setActiveProfileName(profileName);
      toast({ title: "Profile Changed", description: `Switched to ${profileName}` });
    }
  };
  
  const handleManualVerify = () => {
    if (!socket || !activeProfileName) return;
    setApiStatus({ status: 'loading', message: 'Checking API connection...', fullResponse: null });
    socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'inventory' });
    toast({ title: "Re-checking Connection..." });
  };
  
  const handleFormDataChange = (newFormData: InvoiceFormData) => {
    if (activeProfileName) {
        setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], formData: newFormData } }));
    }
  };

  const handleFormSubmit = () => {
    if (!socket || !activeProfileName || !jobs[activeProfileName]) return;
    const currentFormData = jobs[activeProfileName].formData;
    const emails = currentFormData.emails.split('\n').map((e: string) => e.trim()).filter(Boolean);
    if (emails.length === 0) { toast({ title: "No emails provided", variant: "destructive" }); return; }

    setJobs(prev => ({
        ...prev,
        [activeProfileName]: {
            ...prev[activeProfileName],
            results: [], isProcessing: true, isPaused: false, isComplete: false,
            processingStartTime: new Date(), processingTime: 0, totalToProcess: emails.length,
            currentDelay: currentFormData.delay, filterText: '',
        }
    }));
    socket.emit('startBulkInvoice', {
        ...currentFormData, emails, selectedProfileName: activeProfileName,
        activeProfile: inventoryProfiles.find(p => p.profileName === activeProfileName)
    });
  };

  const handleRetryFailed = () => {
      if (!activeProfileName || !jobs[activeProfileName]) return;
      const failedItems = jobs[activeProfileName].results.filter(r => !r.success).map(r => r.identifier || (r as any).email).filter(Boolean).join('\n');
      if (!failedItems) { toast({ title: "No failed items found" }); return; }

      handleFormDataChange({ ...jobs[activeProfileName].formData, emails: failedItems });
      setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isProcessing: false, isPaused: false, isComplete: false, processingTime: 0, results: [] } }));
      toast({ title: "Retry Ready", description: "Failed emails loaded into input." });
  };
  
  const handleUpdateName = () => {
      if (activeProfileName && socket) socket.emit('updateOrgDetails', { selectedProfileName: activeProfileName, displayName, activeProfile: inventoryProfiles.find(p => p.profileName === activeProfileName) });
  };

  const handleDeleteInvoices = (invoiceIds: string[]) => {
      if (activeProfileName && socket) socket.emit('deleteInvoices', { selectedProfileName: activeProfileName, activeProfile: inventoryProfiles.find(p => p.profileName === activeProfileName), invoiceIds });
  };

  const handleFilterTextChange = (text: string) => {
    if (activeProfileName) setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], filterText: text } }));
  };

  const handlePauseResume = () => {
    if (!socket || !activeProfileName) return;
    const currentJob = jobs[activeProfileName];
    const isPaused = currentJob?.isPaused;

    if (isPaused) {
        socket.emit('endJob', { profileName: activeProfileName, jobType: 'invoice' });
        const processedIds = currentJob.results.filter(r => r.success).map(r => (r as any).email || r.identifier);
        const currentFormData = currentJob.formData;
        const emails = currentFormData.emails.split('\n').map((e: string) => e.trim()).filter(Boolean);

        socket.emit('startBulkInvoice', {
            ...currentFormData, emails, selectedProfileName: activeProfileName,
            activeProfile: inventoryProfiles.find(p => p.profileName === activeProfileName),
            processedIds: processedIds 
        });
        setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isPaused: false } }));
        toast({ title: "Job Resumed", description: "Restoring connection to server..." });
    } else {
        socket.emit('pauseJob', { profileName: activeProfileName, jobType: 'invoice' });
        setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isPaused: true } }));
        toast({ title: "Job Paused" });
    }
  };

  const handleEndJob = () => {
      if (!socket || !activeProfileName) return;
      socket.emit('endJob', { profileName: activeProfileName, jobType: 'invoice' });
  };

  // --- NEW WIPE FUNCTIONS ---
  const handleClearJob = () => {
      if (!socket || !activeProfileName) return;
      if (window.confirm(`⚠️ Are you sure you want to completely WIPE all invoice data for ${activeProfileName}? This cannot be undone.`)) {
          console.log(`[WIPE] Requested wipe for account: ${activeProfileName}`);
          socket.emit('clearJob', { profileName: activeProfileName, jobType: 'invoice' });
      }
  };

  const handleClearAllJobs = () => {
      if (!socket) return;
      if (window.confirm(`🚨 DANGER: Are you sure you want to completely WIPE ALL invoice databases for EVERY profile? This cannot be undone.`)) {
          console.log(`[WIPE] Requested Master Wipe for all invoice accounts.`);
          socket.emit('clearAllJobs', { jobType: 'invoice' });
      }
  };

  const selectedProfile = inventoryProfiles.find(p => p.profileName === activeProfileName) || null;
  const currentJob = activeProfileName ? jobs[activeProfileName] : null;
  const failedCount = currentJob?.results.filter(r => !r.success).length || 0;

  return (
    <>
    <DashboardLayout 
        onAddProfile={onAddProfile} 
        stats={{ totalTickets: currentJob?.results.length || 0, totalToProcess: currentJob?.totalToProcess || 0, isProcessing: currentJob?.isProcessing || false }}
        profiles={inventoryProfiles} selectedProfile={selectedProfile} jobs={jobs} onProfileChange={handleProfileChange}
        apiStatus={apiStatus} onShowStatus={() => setIsStatusModalOpen(true)} onManualVerify={handleManualVerify}
        socket={socket} onEditProfile={onEditProfile} onDeleteProfile={onDeleteProfile}
    >
      <div className="space-y-8">
        {currentJob && (
            <>
                <InvoiceForm 
                    jobState={currentJob} formData={currentJob.formData} onFormDataChange={handleFormDataChange}
                    onSubmit={handleFormSubmit} isProcessing={currentJob.isProcessing} isPaused={currentJob.isPaused}
                    onPauseResume={handlePauseResume} onEndJob={handleEndJob}
                    onClearJob={handleClearJob} onClearAllJobs={handleClearAllJobs}
                    displayName={displayName} onDisplayNameChange={setDisplayName} onUpdateName={handleUpdateName}
                    isLoadingName={isLoadingName} onRefreshName={fetchDisplayName} failedCount={failedCount} onRetryFailed={handleRetryFailed}
                />

                <InvoiceResultsDisplay 
                    results={currentJob.results} isProcessing={currentJob.isProcessing} totalRows={currentJob.totalToProcess}
                    filterText={currentJob.filterText} onFilterTextChange={handleFilterTextChange} onDeleteInvoices={handleDeleteInvoices} 
                />
            </>
        )}
      </div>
    </DashboardLayout>
      <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>API Connection Status</DialogTitle><DialogDescription>This is the live status of the connection to the Zoho Inventory API for the selected profile.</DialogDescription></DialogHeader><div className={`p-4 rounded-md ${apiStatus.status === 'success' ? 'bg-green-100 dark:bg-green-900/50' : apiStatus.status === 'error' ? 'bg-red-100 dark:bg-red-900/50' : 'bg-muted'}`}><p className="font-bold text-lg">{apiStatus.status.charAt(0).toUpperCase() + apiStatus.status.slice(1)}</p><p className="text-sm text-muted-foreground mt-1">{apiStatus.message}</p></div>{apiStatus.fullResponse && (<div className="mt-4"><h4 className="text-sm font-semibold mb-2 text-foreground">Full Response from Server:</h4><pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border max-h-60 overflow-y-auto">{JSON.stringify(apiStatus.fullResponse, null, 2)}</pre></div>)}<Button onClick={() => setIsStatusModalOpen(false)} className="mt-4">Close</Button></DialogContent></Dialog>
    </>
  );
};