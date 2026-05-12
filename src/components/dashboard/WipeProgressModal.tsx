// --- FILE: src/components/dashboard/WipeProgressModal.tsx ---
import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WipeProgressModalProps {
    isOpen: boolean;
    onClose: () => void;
    isWiping: boolean;
    wipeProgress: string;
    targetName: string | null;
}

export function WipeProgressModal({
    isOpen, onClose, isWiping, wipeProgress, targetName
}: WipeProgressModalProps) {
    const [logs, setLogs] = useState<string[]>([]);
    const [isSuccess, setIsSuccess] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setLogs([]);
            setIsSuccess(false);
        }
    }, [isOpen]);

    // Track incoming wipe messages and build the terminal log
    useEffect(() => {
        if (isWiping && wipeProgress) {
            setLogs(prev => {
                // Prevent duplicate consecutive logs
                if (prev[prev.length - 1] === wipeProgress) return prev;
                return [...prev, wipeProgress];
            });
        }
    }, [isWiping, wipeProgress]);

    // Handle the transition from Wiping to Success
    useEffect(() => {
        let timeout: NodeJS.Timeout;
        // If we have logs, and isWiping just turned false, the job is done!
        if (!isWiping && logs.length > 0 && isOpen && !isSuccess) {
            setLogs(prev => [...prev, "✅ Wipe operation completed successfully."]);
            setIsSuccess(true);
            
            // Hold the success screen for 2.5 seconds so the user feels satisfied
            timeout = setTimeout(() => {
                onClose();
            }, 2500);
        }
        return () => clearTimeout(timeout);
    }, [isWiping, logs.length, isOpen, isSuccess, onClose]);

    // Auto-scroll the terminal to the bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <Dialog open={isOpen} onOpenChange={() => {}}>
            {/* The hidden DialogHeader/Title is required by Radix UI for accessibility */}
            <DialogHeader className="hidden">
                <DialogTitle>Secure Wipe Terminal</DialogTitle>
            </DialogHeader>
            <DialogContent className="sm:max-w-xl bg-zinc-950 border-zinc-800 text-green-400 p-0 overflow-hidden shadow-[0_0_50px_rgba(220,38,38,0.15)]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-zinc-400" />
                        <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Secure Wipe Terminal</span>
                    </div>
                    {isWiping && <Loader2 className="h-4 w-4 animate-spin text-red-500" />}
                    {isSuccess && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                </div>
                
                <div className="p-4 space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-sm font-mono text-red-400">Executing destruction protocol for: {targetName}</span>
                    </div>
                    
                    <ScrollArea className="h-[250px] w-full rounded-md border border-zinc-800 bg-black/50 p-4" ref={scrollRef}>
                        <div className="space-y-2 font-mono text-xs">
                            {logs.map((log, i) => (
                                <div key={i} className="flex gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <span className="text-zinc-600">[{new Date().toISOString().split('T')[1].slice(0,8)}]</span>
                                    <span className={cn(
                                        log.includes('Error') ? "text-red-400" : 
                                        log.includes('Complete') ? "text-green-400 font-bold" : 
                                        "text-green-400/80"
                                    )}>
                                        {log}
                                    </span>
                                </div>
                            ))}
                            {isWiping && (
                                <div className="flex gap-2 mt-2 opacity-50">
                                    <span className="text-zinc-600">[{new Date().toISOString().split('T')[1].slice(0,8)}]</span>
                                    <span className="animate-pulse">_</span>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                    
                    {/* Fake Hollywood Progress Bar */}
                    <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                            <span>SYSTEM STATUS</span>
                            <span>{isSuccess ? '100%' : 'PROCESSING...'}</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                            <div 
                                className={cn("h-full transition-all duration-1000", isSuccess ? "bg-green-500 w-full" : "bg-red-500 w-2/3 animate-pulse")}
                            />
                        </div>
                    </div>

                    {/* 🚀 INLINE BANNER (No longer blocking the screen) */}
                    {isSuccess && (
                        <div className="bg-green-500/10 border border-green-500/30 px-4 py-3 rounded-lg flex items-center justify-center gap-3 animate-in fade-in duration-500">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                            <span className="text-green-400 font-bold font-mono tracking-widest">DATA VAPORIZED</span>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}