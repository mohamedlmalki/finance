// --- FILE: src/hooks/useJobTimer.ts ---
import { useEffect, useRef } from 'react';
import { 
    Jobs, InvoiceJobs, CatalystJobs, EmailJobs, QntrlJobs, 
    PeopleJobs, CreatorJobs, ProjectsJobs, WebinarJobs, ExpenseJobs 
} from '@/App'; 

// 1. Union of all Job State Types (Added ExpenseJobs)
type AnyJobState = 
    | Jobs[keyof Jobs] 
    | InvoiceJobs[keyof InvoiceJobs] 
    | CatalystJobs[keyof CatalystJobs] 
    | EmailJobs[keyof EmailJobs]
    | QntrlJobs[keyof QntrlJobs]
    | PeopleJobs[keyof PeopleJobs]
    | CreatorJobs[keyof CreatorJobs]
    | ProjectsJobs[keyof ProjectsJobs]
    | WebinarJobs[keyof WebinarJobs]
    | ExpenseJobs[keyof ExpenseJobs];

// 2. Union of all Job State Objects
type AnyJobsState = Jobs | InvoiceJobs | CatalystJobs | EmailJobs | QntrlJobs | PeopleJobs | CreatorJobs | ProjectsJobs | WebinarJobs | ExpenseJobs;

type SetJobsState<T> = React.Dispatch<React.SetStateAction<T>>;

// 3. Added 'expense' to JobType
type JobType = 'ticket' | 'invoice' | 'catalyst' | 'email' | 'qntrl' | 'people' | 'creator' | 'projects' | 'webinar' | 'expense';

export function useJobTimer<T extends AnyJobsState>(
    jobsState: T, 
    setJobsState: SetJobsState<T>, 
    jobType: JobType 
) {
    // Store timer IDs AND the last tick timestamp for accurate delta calculation
    const timersRef = useRef<{ 
        [key: string]: { 
            processing?: NodeJS.Timeout, 
            countdown?: NodeJS.Timeout,
            lastTickProcessing?: number, // Timestamp of last processing tick
            lastTickCountdown?: number   // Timestamp of last countdown tick
        } 
    }>({});

    // Create a dependency string to trigger updates when status changes
    const jobStatuses = Object.values(jobsState as Record<string, AnyJobState>)
        .map(job => `${job.isProcessing}-${job.isPaused}`)
        .join(',');

    useEffect(() => {
        const timers = timersRef.current;

        Object.keys(jobsState).forEach(profileName => {
            const job = jobsState[profileName as keyof T] as AnyJobState | undefined;
            const timerKey = `${profileName}_${jobType}`;

            if (!job) return;
            if (!timers[timerKey]) timers[timerKey] = {};

            const isProcessingTimerRunning = !!timers[timerKey].processing;
            const isCountdownTimerRunning = !!timers[timerKey].countdown;

            // --- 1. PROCESSING TIMER (Total Time Elapsed) ---
            if (job.isProcessing && !job.isPaused && !isProcessingTimerRunning) {
                // Initialize lastTick to NOW
                timers[timerKey].lastTickProcessing = Date.now();
                
                timers[timerKey].processing = setInterval(() => {
                    const now = Date.now();
                    // Use stored lastTick or fallback to now
                    const lastTick = timers[timerKey].lastTickProcessing || now;
                    const deltaMs = now - lastTick;

                    // Only update if at least 1 second has passed
                    if (deltaMs >= 1000) {
                        const deltaSeconds = Math.floor(deltaMs / 1000);
                        
                        // Update lastTick, keeping the remainder to prevent drift
                        timers[timerKey].lastTickProcessing = now - (deltaMs % 1000);

                        setJobsState(prev => {
                            const currentJob = prev[profileName as keyof T];
                            if (!currentJob || !currentJob.isProcessing || currentJob.isPaused) {
                                return prev;
                            }
                            return {
                                ...prev,
                                [profileName]: {
                                    ...currentJob,
                                    // FIX: Add actual elapsed seconds (e.g. +60s), not just +1
                                    processingTime: (currentJob.processingTime || 0) + deltaSeconds
                                }
                            };
                        });
                    }
                }, 1000);
            } else if ((!job.isProcessing || job.isPaused) && isProcessingTimerRunning) {
                clearInterval(timers[timerKey].processing);
                delete timers[timerKey].processing;
                delete timers[timerKey].lastTickProcessing;
            }

            // --- 2. COUNTDOWN TIMER (Delay between batches) ---
            if (job.isProcessing && !job.isPaused && job.countdown > 0 && !isCountdownTimerRunning) {
                timers[timerKey].lastTickCountdown = Date.now();

                timers[timerKey].countdown = setInterval(() => {
                    const now = Date.now();
                    const lastTick = timers[timerKey].lastTickCountdown || now;
                    const deltaMs = now - lastTick;

                    if (deltaMs >= 1000) {
                        const deltaSeconds = Math.floor(deltaMs / 1000);
                        timers[timerKey].lastTickCountdown = now - (deltaMs % 1000);

                        setJobsState(prev => {
                            const currentJob = prev[profileName as keyof T];
                            if (!currentJob || currentJob.countdown <= 0) {
                                if (timers[timerKey]?.countdown) {
                                    clearInterval(timers[timerKey].countdown);
                                    delete timers[timerKey].countdown;
                                    delete timers[timerKey].lastTickCountdown;
                                }
                                return prev;
                            }
                            
                            // Decrease countdown by actual elapsed time
                            const newCountdown = Math.max(0, currentJob.countdown - deltaSeconds);
                            return { 
                                ...prev, 
                                [profileName]: { 
                                    ...currentJob, 
                                    countdown: newCountdown 
                                } 
                            };
                        });
                    }
                }, 1000);
            } else if ((job.countdown <= 0 || !job.isProcessing || job.isPaused) && isCountdownTimerRunning) {
                clearInterval(timers[timerKey].countdown);
                delete timers[timerKey].countdown;
                delete timers[timerKey].lastTickCountdown;
            }
        });

        return () => {
            Object.values(timers).forEach(t => {
                if (t.processing) clearInterval(t.processing);
                if (t.countdown) clearInterval(t.countdown);
            });
            timersRef.current = {};
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobStatuses, setJobsState, jobType]);
}