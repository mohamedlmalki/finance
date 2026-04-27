import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import { DashboardLayout } from '../../DashboardLayout';
import { useToast } from '@/hooks/use-toast';
import { Profile, ContactJobs, ContactJobState } from '@/App';
import { BooksContactForm } from './BooksContactForm';
import { BooksContactResults } from './BooksContactResults';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ApiStatus = {
  status: 'loading' | 'success' | 'error';
  message: string;
  fullResponse?: any;
};

interface BooksContactDashboardProps {
  jobs: ContactJobs;
  setJobs: React.Dispatch<React.SetStateAction<ContactJobs>>;
  socket: Socket | null;
  createInitialJobState: () => ContactJobState;
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
}

const SERVER_URL = "http://localhost:3009";

export const BooksContactDashboard: React.FC<BooksContactDashboardProps> = ({ 
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
    queryFn: async () => (await fetch(`${SERVER_URL}/api/profiles`)).json(),
    refetchOnWindowFocus: false,
  });

  const booksProfiles = profiles.filter(p => p.books && p.books.orgId);
  
  useEffect(() => {
    if (booksProfiles.length > 0) {
        setJobs(prevJobs => {
            const newJobs = { ...prevJobs };
            let updated = false;
            booksProfiles.forEach(p => {
                if (!newJobs[p.profileName]) { newJobs[p.profileName] = createInitialJobState(); updated = true; }
            });
            return updated ? newJobs : prevJobs;
        });
        if (!activeProfileName || !booksProfiles.find(p => p.profileName === activeProfileName)) {
            setActiveProfileName(booksProfiles[0]?.profileName || null);
        }
    }
  }, [booksProfiles, activeProfileName, setJobs, createInitialJobState]);
  
  useEffect(() => {
    if (!socket) return;
    const handleApiStatus = (r: any) => setApiStatus({ status: r.success ? 'success' : 'error', message: r.message, fullResponse: r.fullResponse });
    
    socket.on('apiStatusResult', handleApiStatus);
    socket.on('orgDetailsResult', (r: any) => { setIsLoadingName(false); if (r.success) setDisplayName(r.data.contact_name); });
    socket.on('updateOrgDetailsResult', (r: any) => { if (r.success) { setDisplayName(r.data.contact_name); toast({ title: "Updated" }); } });

    return () => {
      socket.off('apiStatusResult', handleApiStatus);
      socket.off('orgDetailsResult');
      socket.off('updateOrgDetailsResult');
    };
  }, [socket, toast]);

  const fetchDisplayName = () => {
    if (activeProfileName && socket) {
      setIsLoadingName(true);
      socket.emit('getBooksOrgDetails', { selectedProfileName: activeProfileName });
    }
  };
  
  useEffect(() => { fetchDisplayName(); }, [activeProfileName, socket]);

  useEffect(() => {
    if (activeProfileName && socket?.connected) {
      setApiStatus({ status: 'loading', message: 'Checking Books API...' });
      socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'books' });
    }
  }, [activeProfileName, socket]);

  const handleFormSubmit = () => {
    if (!socket || !activeProfileName) return;
    const job = jobs[activeProfileName];
    const emails = job.formData.emails.split('\n').map(e => e.trim()).filter(Boolean);
    
    if (emails.length === 0) return toast({ title: "No emails", variant: "destructive" });
    
    if (job.formData.sendEmail) {
        if (!job.formData.subject.trim() || !job.formData.body.trim()) {
            return toast({ title: "Subject and Body required for Email", variant: "destructive" });
        }
    }

    setJobs(prev => ({
        ...prev,
        [activeProfileName]: {
            ...prev[activeProfileName],
            results: [], isProcessing: true, isPaused: false, isComplete: false,
            processingStartTime: new Date(), processingTime: 0, totalToProcess: emails.length,
            currentDelay: job.formData.delay, filterText: ''
        }
    }));
    
    socket.emit('startBulkBooksContact', {
        ...job.formData,
        emails,
        selectedProfileName: activeProfileName,
        activeProfile: booksProfiles.find(p => p.profileName === activeProfileName)
    });
  };

  // --- FIXED PAUSE/RESUME LOGIC ---
  const handlePauseResume = () => {
      if (!socket || !activeProfileName) return;
      const currentJob = jobs[activeProfileName];
      if (!currentJob) return;

      if (currentJob.isPaused) {
          // --- RESUME ---
          socket.emit('endJob', { profileName: activeProfileName, jobType: 'books-contact' });

          const processedIds = currentJob.results
              .filter(r => r.success)
              .map(r => r.email || (r as any).identifier);

          const emails = currentJob.formData.emails.split('\n').map(e => e.trim()).filter(Boolean);

          socket.emit('startBulkBooksContact', {
              ...currentJob.formData,
              emails,
              selectedProfileName: activeProfileName,
              activeProfile: booksProfiles.find(p => p.profileName === activeProfileName),
              processedIds // Server skips these
          });

          setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isPaused: false } }));
          toast({ title: "Resumed", description: "Restoring connection..." });
      } else {
          // --- PAUSE ---
          socket.emit('pauseJob', { profileName: activeProfileName, jobType: 'books-contact' });
          setJobs(prev => ({ ...prev, [activeProfileName]: { ...prev[activeProfileName], isPaused: true } }));
          toast({ title: "Paused" });
      }
  };

  const handleRetryFailed = () => {
      if (!activeProfileName || !jobs[activeProfileName]) return;
      const failedItems = jobs[activeProfileName].results.filter(r => !r.success).map(r => r.email).join('\n');
      if (!failedItems) return toast({ title: "No failed items" });

      setJobs(prev => ({
          ...prev,
          [activeProfileName]: {
              ...prev[activeProfileName],
              formData: { ...prev[activeProfileName].formData, emails: failedItems },
              isProcessing: false, isPaused: false, isComplete: false, processingTime: 0, results: [] 
          }
      }));
      toast({ title: "Retry Ready", description: "Failed emails loaded." });
  };

  const currentJob = activeProfileName ? jobs[activeProfileName] : null;

  return (
    <>
    <DashboardLayout 
        onAddProfile={onAddProfile} 
        stats={{ totalTickets: currentJob?.results.length || 0, totalToProcess: currentJob?.totalToProcess || 0, isProcessing: currentJob?.isProcessing || false }}
        profiles={booksProfiles}
        selectedProfile={booksProfiles.find(p => p.profileName === activeProfileName) || null}
        jobs={jobs}
        onProfileChange={(name) => setActiveProfileName(name)}
        apiStatus={apiStatus}
        onShowStatus={() => setIsStatusModalOpen(true)}
        onManualVerify={() => socket?.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'books' })}
        socket={socket}
        onEditProfile={onEditProfile}
        onDeleteProfile={onDeleteProfile}
        service='books'
    >
      <div className="space-y-8">
        {currentJob && (
            <>
                <BooksContactForm 
                    jobState={currentJob}
                    formData={currentJob.formData}
                    onFormDataChange={(d) => setJobs(prev => ({...prev, [activeProfileName!]: {...prev[activeProfileName!], formData: d}}))}
                    onSubmit={handleFormSubmit} 
                    isProcessing={currentJob.isProcessing}
                    isPaused={currentJob.isPaused}
                    onPauseResume={handlePauseResume} // <--- USING FIXED FUNCTION
                    onEndJob={() => socket?.emit('endJob', { profileName: activeProfileName, jobType: 'books-contact' })}
                    displayName={displayName}
                    onDisplayNameChange={setDisplayName}
                    onUpdateName={() => socket?.emit('updateBooksOrgDetails', { selectedProfileName: activeProfileName, displayName, activeProfile: booksProfiles.find(p => p.profileName === activeProfileName) })}
                    isLoadingName={isLoadingName}
                    onRefreshName={fetchDisplayName}
                    failedCount={currentJob.results.filter(r => !r.success).length}
                    onRetryFailed={handleRetryFailed}
                />

                <BooksContactResults 
                    results={currentJob.results} 
                    isProcessing={currentJob.isProcessing} 
                    totalRows={currentJob.totalToProcess}
                    filterText={currentJob.filterText}
                    onFilterTextChange={(t) => setJobs(prev => ({...prev, [activeProfileName!]: {...prev[activeProfileName!], filterText: t}}))}
                />
            </>
        )}
      </div>
    </DashboardLayout>

      <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>API Status</DialogTitle><DialogDescription>Live status of the connection to the Zoho Books API.</DialogDescription></DialogHeader>
          <div className={`p-4 rounded-md ${apiStatus.status === 'success' ? 'bg-green-100 dark:bg-green-900/50' : apiStatus.status === 'error' ? 'bg-red-100 dark:bg-red-900/50' : 'bg-muted'}`}>
            <p className="font-bold text-lg">{apiStatus.status.charAt(0).toUpperCase() + apiStatus.status.slice(1)}</p>
            <p className="text-sm text-muted-foreground mt-1">{apiStatus.message}</p>
          </div>
          {apiStatus.fullResponse && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold mb-2 text-foreground">Full Response:</h4>
              <pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border max-h-60 overflow-y-auto">{JSON.stringify(apiStatus.fullResponse, null, 2)}</pre>
            </div>
          )}
          <Button onClick={() => setIsStatusModalOpen(false)} className="mt-4">Close</Button>
        </DialogContent>
      </Dialog>
    </>
  );
};