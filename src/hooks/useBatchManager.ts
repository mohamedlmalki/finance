// --- FILE: src/hooks/useBatchManager.ts ---
import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { useToast } from '@/hooks/use-toast';
import { CustomModuleJobs } from '@/App';

export interface BatchPayload {
    selectedProfileName: string;
    moduleApiName: string;
    bulkField: string;
    bulkData: string;
    staticData: any;
    delay: number;
    concurrency: number;
    stopAfterFailures: number;
    activeProfile: any;
    trackingEnabled: boolean;
    campaignName: string;
    targetHtmlField: string;
    startingRowNumber?: number;
    socketEventName?: string; 
}

export function useBatchManager(
    socket: Socket | null,
    moduleApiName: string | undefined,
    setJobs: React.Dispatch<React.SetStateAction<CustomModuleJobs>>,
    jobs: CustomModuleJobs 
) {
    const { toast } = useToast();
    
    const [batchState, setBatchState] = useState({
        isActive: false,
        isPaused: false,
        concurrency: 1,
        pending: [] as string[],
        active: [] as string[],
        completed: [] as string[]
    });

    const queueRef = useRef({
        pending: [] as BatchPayload[],
        active: [] as string[],
        completed: [] as string[],
        concurrency: 1,
        isActive: false,
        isPaused: false,
        dispatchedAt: {} as Record<string, number>
    });

    const syncState = useCallback(() => {
        setBatchState({
            isActive: queueRef.current.isActive,
            isPaused: queueRef.current.isPaused,
            concurrency: queueRef.current.concurrency,
            pending: queueRef.current.pending.map(p => p.selectedProfileName),
            active: [...queueRef.current.active],
            completed: [...queueRef.current.completed]
        });
    }, []);

    const dispatchNext = useCallback(() => {
        if (!socket || !queueRef.current.isActive || queueRef.current.isPaused) return;

        let dispatchedSomething = false;

        while (queueRef.current.active.length < queueRef.current.concurrency && queueRef.current.pending.length > 0) {
            const nextPayload = queueRef.current.pending.shift()!;
            queueRef.current.active.push(nextPayload.selectedProfileName);
            
            queueRef.current.dispatchedAt[nextPayload.selectedProfileName] = Date.now();
            
            setJobs(prev => {
                const job = prev[nextPayload.selectedProfileName];
                if (!job) return prev;
                return {
                    ...prev,
                    [nextPayload.selectedProfileName]: {
                        ...job,
                        isProcessing: true,
                        isPaused: false, 
                        _forcePaused: false, // 🚨 THE MISSING FIX: Destroy the pause shield!
                        _forceStopped: false,
                        _isQueued: false,
                        _ignition: false, 
                        processingStartTime: new Date() 
                    } as any
                };
            });
            
            const eventToTrigger = nextPayload.socketEventName || 'startBulkCustomJob';
            socket.emit(eventToTrigger, nextPayload);
            
            dispatchedSomething = true;
        }
        
        if (queueRef.current.active.length === 0 && queueRef.current.pending.length === 0 && queueRef.current.isActive) {
            queueRef.current.isActive = false;
            toast({ title: "Master Batch Complete! 🎉", description: "All queued accounts have finished processing perfectly." });
            dispatchedSomething = true;
        }

        if (dispatchedSomething) syncState();
    }, [socket, syncState, toast, setJobs]);

    const startBatch = useCallback((payloads: BatchPayload[], concurrencyLimit: number) => {
        if (!payloads.length || !socket) return;
        
        queueRef.current = {
            pending: payloads,
            active: [],
            completed: [],
            concurrency: Math.max(1, concurrencyLimit),
            isActive: true,
            isPaused: false,
            dispatchedAt: {}
        };
        
        toast({ title: "Master Batch Started", description: `Loaded ${payloads.length} accounts. Running ${concurrencyLimit} at a time.` });
        syncState();
        setTimeout(() => dispatchNext(), 100);
        
    }, [socket, syncState, dispatchNext, toast]);

    useEffect(() => {
        if (!queueRef.current.isActive || queueRef.current.isPaused) return;

        let advanced = false;
        queueRef.current.active.forEach(profileName => {
            const job = jobs[profileName];
            const dispatchedTime = queueRef.current.dispatchedAt[profileName] || 0;
            
            if (Date.now() - dispatchedTime > 3000) {
                if (job && (job.isComplete || (job.processedCount > 0 && job.processedCount >= job.totalToProcess))) {
                    queueRef.current.active = queueRef.current.active.filter(p => p !== profileName);
                    if (!queueRef.current.completed.includes(profileName)) {
                        queueRef.current.completed.push(profileName);
                    }
                    advanced = true;
                }
            }
        });

        if (advanced) {
            dispatchNext();
        }
    }, [jobs, dispatchNext]);

    useEffect(() => {
        if (!socket) return;
        const handleForceStop = (data: any) => {
            const profileName = data.profileName || data.selectedProfileName;
            if (queueRef.current.active.includes(profileName)) {
                queueRef.current.active = queueRef.current.active.filter(p => p !== profileName);
                if (!queueRef.current.completed.includes(profileName)) queueRef.current.completed.push(profileName);
                dispatchNext();
            }
        };
        socket.on('bulkEnded', handleForceStop);
        socket.on('jobCleared', handleForceStop);
        return () => {
            socket.off('bulkEnded', handleForceStop);
            socket.off('jobCleared', handleForceStop);
        };
    }, [socket, dispatchNext, moduleApiName]);

    const pauseBatch = useCallback(() => { queueRef.current.isPaused = true; syncState(); }, [syncState]);
    const resumeBatch = useCallback(() => { queueRef.current.isPaused = false; syncState(); dispatchNext(); }, [syncState, dispatchNext]);
    const stopBatch = useCallback(() => { queueRef.current.isActive = false; queueRef.current.pending = []; queueRef.current.active = []; syncState(); }, [syncState]);

    return { batchState, startBatch, pauseBatch, resumeBatch, stopBatch };
}