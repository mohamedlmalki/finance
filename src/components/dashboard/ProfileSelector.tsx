// --- FILE: src/components/dashboard/ProfileSelector.tsx ---
import React, { useEffect, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building, AlertCircle, Loader, RefreshCw, Activity, Trash2, PauseCircle, CheckCircle2, StopCircle, XCircle, ChevronLeft, ChevronRight, PlusCircle, Settings, Zap } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { Profile, InvoiceJobs, CustomModuleJobs, ExpenseJobs } from '@/App'; 
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ApiStatus = { status: 'loading' | 'success' | 'error'; message: string; fullResponse?: any; };
type AllJobs = InvoiceJobs | CustomModuleJobs | ExpenseJobs | any;
type ServiceType = 'inventory' | 'expense' | 'books' | 'billing' | 'flow';

type LiveCounterState = { current: number, failed: number, isProcessing: boolean, forceStop: boolean };

// 🚨 GLOBAL HIGH WATER MARK CACHE
// Sits outside the component to completely survive page switches (unmounts).
// Ensures the UI never drops backwards if the database sync momentarily returns a 0.
const highWaterMarks: Record<string, { current: number, failed: number }> = {};

interface ProfileSelectorProps {
  profiles: Profile[];
  selectedProfile: Profile | null;
  jobs: AllJobs;
  onProfileChange: (profileName: string) => void;
  apiStatus: ApiStatus;
  onShowStatus: () => void;
  onManualVerify: () => void;
  socket: Socket | null;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
  service?: ServiceType;
  onAddProfile?: () => void;
}

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({ profiles, selectedProfile, jobs, onProfileChange, apiStatus, onShowStatus, onManualVerify, socket, onEditProfile, onDeleteProfile, service = 'inventory', onAddProfile }) => {

  const [liveCounters, setLiveCounters] = useState<Record<string, LiveCounterState>>({});

  useEffect(() => {
      if (!socket) return;

      const handleLiveTick = (res: any) => {
          if (!res.profileName) return;
          setLiveCounters(prev => {
              const currentStats = prev[res.profileName] || { current: 0, failed: 0, isProcessing: true, forceStop: false };
              let newCurrent = currentStats.current;
              let newFailed = currentStats.failed;

              if (res.stage === 'complete' || res.success !== undefined) {
                  newCurrent++;
                  if (res.success === false) newFailed++;
              }

              return { 
                  ...prev, 
                  [res.profileName]: { 
                      ...currentStats, 
                      current: newCurrent, 
                      failed: newFailed, 
                      isProcessing: currentStats.forceStop ? false : true 
                  } 
              };
          });
      };

      const handleEnded = (res: any) => {
          if (!res.profileName) return;
          setLiveCounters(prev => ({ 
              ...prev, 
              [res.profileName]: { 
                  ...(prev[res.profileName] || { current: 0, failed: 0, forceStop: false }), 
                  isProcessing: false, 
                  forceStop: true 
              } 
          }));
      };

      const handleStarted = (res: any) => {
          if (!res.profileName) return;
          
          // Reset High Water Mark explicitly on new job start
          const hwKey = `${service}_${res.profileName}`;
          highWaterMarks[hwKey] = { current: 0, failed: 0 };

          setLiveCounters(prev => ({ 
              ...prev, 
              [res.profileName]: { 
                  current: 0, 
                  failed: 0, 
                  isProcessing: true, 
                  forceStop: false 
              } 
          }));
      };

      // 🚨 ISOLATION MAP: Only listen to the correct service
      const serviceEventMap = [
          { event: 'customModuleResult', expectedService: 'inventory' },
          { event: 'invoiceResult', expectedService: 'inventory' },
          { event: 'billingCustomModuleResult', expectedService: 'billing' },
          { event: 'billingInvoiceResult', expectedService: 'billing' },
          { event: 'billingContactResult', expectedService: 'billing' },
          { event: 'booksCustomModuleResult', expectedService: 'books' },
          { event: 'booksInvoiceResult', expectedService: 'books' },
          { event: 'booksContactResult', expectedService: 'books' },
          { event: 'expenseBulkResult', expectedService: 'expense' },
          { event: 'flowResult', expectedService: 'flow' }
      ];

      const activeListeners: { event: string, handler: (res: any) => void }[] = [];

      serviceEventMap.forEach(({ event, expectedService }) => {
          const handler = (res: any) => {
              if (service && service !== expectedService) return;
              const jt = res.jobType || res.jobtype || '';
              if (service === 'inventory' && (jt.startsWith('bil_') || jt.startsWith('books_'))) return;
              if (service === 'billing' && (jt.startsWith('inv_') || jt.startsWith('books_'))) return;
              handleLiveTick(res);
          };
          socket.on(event, handler);
          activeListeners.push({ event, handler });
      });

      const handleGlobalFiltered = (res: any, action: (r: any) => void) => {
          const jt = res.jobType || res.jobtype || '';
          if (service === 'inventory' && (jt.startsWith('bil_') || jt.startsWith('books_'))) return;
          if (service === 'billing' && (jt.startsWith('inv_') || jt.startsWith('books_'))) return;
          action(res);
      }

      const handleEndedWrapper = (res: any) => handleGlobalFiltered(res, handleEnded);
      const handleStartedWrapper = (res: any) => handleGlobalFiltered(res, handleStarted);

      socket.on('bulkEnded', handleEndedWrapper);
      socket.on('bulkComplete', handleEndedWrapper);
      socket.on('jobStarted', handleStartedWrapper);

      return () => {
          activeListeners.forEach(({ event, handler }) => {
              socket.off(event, handler);
          });
          socket.off('bulkEnded', handleEndedWrapper);
          socket.off('bulkComplete', handleEndedWrapper);
          socket.off('jobStarted', handleStartedWrapper);
      };
  }, [socket, service]);

  useEffect(() => {
    if (selectedProfile?.profileName && socket?.connected && service !== 'flow') {
        socket.emit('checkApiStatus', { selectedProfileName: selectedProfile.profileName, service: service });
    }
  }, [selectedProfile?.profileName, socket?.connected, service, socket]);

  const filteredProfiles = useMemo(() => {
    if (!profiles || profiles.length === 0) return [];
    const uniqueProfiles = Array.from(new Map(profiles.map(p => [p.profileName, p])).values());
    return uniqueProfiles.filter(p => {
      if (!service || service === 'flow') return true; 
      if (service === 'inventory') return p.inventory && p.inventory.orgId;
      if (service === 'books') return p.books && p.books.orgId;
      if (service === 'billing') return p.billing && p.billing.orgId;
      if (service === 'expense') return p.expense && p.expense.orgId;
      return true;
    });
  }, [profiles, service]);

  const currentIndex = filteredProfiles.findIndex(p => p.profileName === selectedProfile?.profileName);
  const handlePrev = () => { if (currentIndex > 0) onProfileChange(filteredProfiles[currentIndex - 1].profileName); };
  const handleNext = () => { if (currentIndex >= 0 && currentIndex < filteredProfiles.length - 1) { onProfileChange(filteredProfiles[currentIndex + 1].profileName); } };

  const getJobProcessedCount = (job: any) => {
      if (!job) return 0;
      const stateCount = parseInt(job.processedCount) || parseInt(job.processedcount) || 0;
      const arrayCount = job.results ? job.results.filter((r: any) => !r.stage || r.stage === 'complete').length : 0;
      return Math.max(stateCount, arrayCount);
  };

  const getJobFailedCount = (job: any) => {
      if (!job) return 0;
      const stateCount = parseInt(job.errorCount) || parseInt(job.errorcount) || 0;
      const arrayCount = job.results ? job.results.filter((r: any) => r.success === false).length : 0;
      return Math.max(stateCount, arrayCount);
  };

  const activeProfile = filteredProfiles.find(p => p.profileName === selectedProfile?.profileName);
  const activeJob = activeProfile && jobs ? (jobs as any)[activeProfile.profileName] : null;
  const activeLive = activeProfile ? liveCounters[activeProfile.profileName] : null;

  const activeTotal = parseInt(activeJob?.totalTicketsToProcess) || parseInt(activeJob?.totalToProcess) || 0;
  
  let activeCurrent = 0;
  let activeFailed = 0;

  // 🚨 ACTIVE PROFILE: Apply High Water Mark
  if (activeProfile) {
      const hwKey = `${service}_${activeProfile.profileName}`;
      if (!highWaterMarks[hwKey] || activeTotal === 0) {
          highWaterMarks[hwKey] = { current: 0, failed: 0 };
      }

      const stateCurrent = getJobProcessedCount(activeJob);
      const stateFailed = getJobFailedCount(activeJob);

      const liveCurrent = activeLive?.current || 0;
      const liveFailed = activeLive?.failed || 0;

      activeCurrent = Math.max(stateCurrent, liveCurrent);
      activeFailed = Math.max(stateFailed, liveFailed);

      // Lock it in so it never drops
      highWaterMarks[hwKey].current = Math.max(highWaterMarks[hwKey].current, activeCurrent);
      highWaterMarks[hwKey].failed = Math.max(highWaterMarks[hwKey].failed, activeFailed);

      activeCurrent = highWaterMarks[hwKey].current;
      activeFailed = highWaterMarks[hwKey].failed;

      if (activeTotal > 0 && activeCurrent > activeTotal) activeCurrent = activeTotal;
  }

  let activeStatusLabel = ''; let activeStatusColor = ''; let ActiveStatusIcon: any = null;

  if (activeTotal > 0) {
      const isFinished = activeCurrent >= activeTotal;
      const isProcessing = (activeLive?.isProcessing || activeJob?.isProcessing) && !activeJob?.isPaused && !activeJob?.isComplete;

      if (activeJob?.isPaused) { 
          activeStatusLabel = 'Paused'; activeStatusColor = 'border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30'; ActiveStatusIcon = PauseCircle; 
      } 
      else if (isFinished) { 
          activeStatusLabel = 'Finished'; activeStatusColor = 'border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30'; ActiveStatusIcon = CheckCircle2; 
      } 
      else if (isProcessing) { 
          activeStatusLabel = 'Processing'; activeStatusColor = 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/30'; ActiveStatusIcon = Activity; 
      } 
      else { 
          activeStatusLabel = 'Stopped'; activeStatusColor = 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'; ActiveStatusIcon = StopCircle; 
      }
  }

  return (
    <div className="flex items-center space-x-3 bg-background px-2 py-1 rounded-full border shadow-sm">
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onShowStatus}>
                        {apiStatus?.status === 'success' ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : apiStatus?.status === 'error' ? <AlertCircle className="h-5 w-5 text-red-500" /> : <Loader className="h-5 w-5 animate-spin text-yellow-500" />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent><p>{apiStatus?.message || "Checking status..."}</p></TooltipContent>
            </Tooltip>
        </TooltipProvider>

        <div className="flex items-center bg-muted/50 rounded-full border border-border overflow-hidden">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-r border-border hover:bg-muted" onClick={handlePrev} disabled={currentIndex <= 0 || filteredProfiles.length === 0}><ChevronLeft className="h-4 w-4" /></Button>
            
            <Select value={selectedProfile?.profileName || ''} onValueChange={onProfileChange} disabled={filteredProfiles.length === 0}>
                <SelectTrigger className="h-11 border-0 bg-transparent shadow-none w-auto min-w-[300px] max-w-[400px] focus:ring-0 text-sm font-medium relative">
                    <div className="w-full flex items-center justify-between pointer-events-none">
                        {selectedProfile ? (
                            <div className="flex flex-1 items-center justify-between w-full gap-3 pr-2 overflow-hidden">
                                
                                <div className="flex flex-col items-start justify-center truncate">
                                    <div className="flex items-center space-x-2 truncate">
                                        {service === 'flow' ? <Zap className="h-4 w-4 text-yellow-500 flex-shrink-0" /> : <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                                        <span className="font-semibold truncate text-[13px] leading-none">{selectedProfile.profileName}</span>
                                    </div>
                                    
                                    {service !== 'flow' && apiStatus?.status === 'success' && apiStatus.fullResponse && (
                                        <div className="flex items-center text-[10px] text-muted-foreground mt-1 ml-6 space-x-1.5 truncate leading-none">
                                            <span className="font-medium truncate max-w-[120px]">{apiStatus.fullResponse.orgName || 'Unknown Org'}</span>
                                            {apiStatus.fullResponse.agentInfo?.firstName && (
                                                <>
                                                    <span className="opacity-50">|</span>
                                                    <span className="truncate max-w-[80px]">{apiStatus.fullResponse.agentInfo.firstName}</span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {(activeTotal > 0 || activeStatusLabel === 'Processing') && (
                                    <div className="flex items-center space-x-1.5 pl-2 border-l flex-shrink-0">
                                        {activeFailed > 0 && (<Badge variant="destructive" className="h-5 text-[10px] px-1.5 bg-red-100 text-red-700 border-0 flex items-center"><XCircle className="h-3 w-3 mr-1" /> {activeFailed}</Badge>)}
                                        {activeStatusLabel && ActiveStatusIcon && (
                                            <Badge variant="outline" className={`h-5 text-[10px] px-2 flex items-center gap-1 uppercase tracking-wider font-bold ${activeStatusColor}`}>
                                                <ActiveStatusIcon className={`h-3 w-3 ${activeStatusLabel === 'Processing' ? 'animate-pulse' : ''}`}/>
                                                <span>{activeStatusLabel}</span><span className="ml-1 pl-1 border-l border-current/30 opacity-80">{activeCurrent}/{activeTotal}</span>
                                            </Badge>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <span className="text-muted-foreground">{filteredProfiles.length > 0 ? "Select an account..." : "No accounts found"}</span>
                        )}
                    </div>
                    <span className="sr-only"><SelectValue /></span>
                </SelectTrigger>
                
                <SelectContent className="bg-card border-border shadow-large max-w-[400px]">
                    {filteredProfiles.length === 0 && (<div className="p-3 text-sm text-muted-foreground text-center">No Profiles found.</div>)}
                    {filteredProfiles.map((profile) => {
                        const job = jobs ? (jobs as any)[profile.profileName] : null;
                        const live = liveCounters[profile.profileName];
                        
                        const total = parseInt(job?.totalTicketsToProcess) || parseInt(job?.totalToProcess) || 0;
                        
                        // 🚨 DROPDOWN LIST: Apply High Water Mark 
                        const hwKey = `${service}_${profile.profileName}`;
                        if (!highWaterMarks[hwKey] || total === 0) {
                            highWaterMarks[hwKey] = { current: 0, failed: 0 };
                        }

                        const stateCurrent = getJobProcessedCount(job);
                        const stateFailed = getJobFailedCount(job);

                        const liveCurrent = live?.current || 0;
                        const liveFailed = live?.failed || 0;

                        let current = Math.max(stateCurrent, liveCurrent);
                        let failedCount = Math.max(stateFailed, liveFailed);

                        highWaterMarks[hwKey].current = Math.max(highWaterMarks[hwKey].current, current);
                        highWaterMarks[hwKey].failed = Math.max(highWaterMarks[hwKey].failed, failedCount);

                        current = highWaterMarks[hwKey].current;
                        failedCount = highWaterMarks[hwKey].failed;

                        if (total > 0 && current > total) current = total;
                        
                        let statusLabel = ''; let statusColor = ''; let StatusIcon: any = null;

                        if (total > 0) {
                            const isFinished = current >= total;
                            const isProcessing = (live?.isProcessing || job?.isProcessing) && !job?.isPaused && !job?.isComplete;

                            if (job?.isPaused) { 
                                statusLabel = 'Paused'; statusColor = 'border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30'; StatusIcon = PauseCircle; 
                            } 
                            else if (isFinished) { 
                                statusLabel = 'Finished'; statusColor = 'border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30'; StatusIcon = CheckCircle2; 
                            } 
                            else if (isProcessing) { 
                                statusLabel = 'Processing'; statusColor = 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/30'; StatusIcon = Activity; 
                            } 
                            else { 
                                statusLabel = 'Stopped'; statusColor = 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'; StatusIcon = StopCircle; 
                            }
                        }

                        return (
                            <SelectItem key={profile.profileName} value={profile.profileName} textValue={profile.profileName} className="cursor-pointer py-2">
                                <div className="flex items-center justify-between w-full gap-3">
                                    <div className="flex flex-col items-start truncate leading-tight">
                                        <div className="flex items-center space-x-2 truncate">
                                            {service === 'flow' ? <Zap className="h-4 w-4 text-yellow-500 flex-shrink-0" /> : <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                                            <span className="font-semibold truncate text-[13px]">{profile.profileName}</span>
                                        </div>
                                        {service !== 'flow' && (
                                            <div className="text-[10px] text-muted-foreground ml-6 mt-0.5 truncate">
                                                Org ID: {profile[service || 'inventory']?.orgId || 'Not Set'}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center space-x-1.5 pl-2 border-l">
                                        {failedCount > 0 && (<Badge variant="destructive" className="h-5 text-[10px] px-1.5 bg-red-100 text-red-700 border-0 flex items-center"><XCircle className="h-3 w-3 mr-1" /> {failedCount} Fails</Badge>)}
                                        {statusLabel && StatusIcon && (
                                            <Badge variant="outline" className={`h-5 text-[10px] px-2 flex items-center gap-1 uppercase tracking-wider font-bold ${statusColor}`}>
                                                <StatusIcon className={`h-3 w-3 ${statusLabel === 'Processing' ? 'animate-pulse' : ''}`}/>
                                                <span>{statusLabel}</span><span className="ml-1 pl-1 border-l border-current/30 opacity-80">{current}/{total}</span>
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </SelectItem>
                        )
                    })}
                </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-l border-border hover:bg-muted" onClick={handleNext} disabled={currentIndex === -1 || currentIndex >= filteredProfiles.length - 1}><ChevronRight className="h-4 w-4" /></Button>
        </div>

        <div className="flex items-center space-x-1 pl-1">
            <TooltipProvider>
                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onManualVerify}><RefreshCw className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Verify Connection</p></TooltipContent></Tooltip>
                {onAddProfile && (<Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-primary" onClick={onAddProfile}><PlusCircle className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Add New Profile</p></TooltipContent></Tooltip>)}
                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => selectedProfile && onEditProfile(selectedProfile)} disabled={!selectedProfile}><Settings className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Settings</p></TooltipContent></Tooltip>
                <AlertDialog>
                    <Tooltip><TooltipTrigger asChild><AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10" disabled={!selectedProfile}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger></TooltipTrigger><TooltipContent><p>Delete Profile</p></TooltipContent></Tooltip>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Delete Profile?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the profile.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive" onClick={() => selectedProfile && onDeleteProfile(selectedProfile.profileName)}>Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </TooltipProvider>
        </div>
    </div>
  );
};