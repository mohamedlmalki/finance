import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { 
    Activity, CheckCircle2, AlertCircle, ExternalLink, 
    Package, Database, CreditCard, Clock, Play, Pause, Square, Book, Users, Layers, GripVertical
} from 'lucide-react';
import { 
    InvoiceJobs, CustomModuleJobs, ExpenseJobs, Profile, ContactJobs
} from '@/App';
import { formatTime } from '@/lib/utils';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useQuery } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';

const SERVER_URL = "http://localhost:3009";

interface LiveStatsProps {
    invoiceJobs: InvoiceJobs;
    booksJobs: InvoiceJobs;
    booksContactJobs: ContactJobs;
    customJobs: CustomModuleJobs;
    booksCustomJobs: CustomModuleJobs;
    // --- BILLING PROPS ---
    billingJobs: InvoiceJobs;
    billingContactJobs: ContactJobs;
    billingCustomJobs: CustomModuleJobs;
    
    expenseJobs: ExpenseJobs;
    onAddProfile: () => void;
    onEditProfile: (profile: Profile) => void;
    onDeleteProfile: (profileName: string) => void;
    socket: Socket | null;
}

// Reusable Card Component
const ServiceStatCard = ({ 
    title, 
    icon: Icon, 
    jobMap,
    route,
    isDragging 
}: { 
    title: string, 
    icon: any, 
    jobMap: any,
    route: string,
    isDragging?: boolean
}) => {
    const navigate = useNavigate(); 

    const activeProfiles = Object.entries(jobMap).filter(([_, job]: [string, any]) => 
        (job.results?.length > 0 || job.isProcessing)
    );

    if (activeProfiles.length === 0) {
        return (
            <Card className={`opacity-60 border-dashed h-full ${isDragging ? 'opacity-30' : ''}`}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-move" />
                        <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    </div>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-xs text-muted-foreground italic pl-6">No active jobs</div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className={`border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow h-full ${isDragging ? 'opacity-50 ring-2 ring-primary' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                     <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-move" />
                     <CardTitle className="text-sm font-medium font-bold uppercase tracking-wider">{title}</CardTitle>
                </div>
                <Icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
                {activeProfiles.map(([profileName, job]: [string, any]) => {
                    const successCount = job.results.filter((r: any) => r.success === true).length;
                    const failCount = job.results.filter((r: any) => r.success === false).length;
                    const totalProcessed = job.results.length;
                    const totalToProcess = job.totalToProcess || 0;
                    const progress = totalToProcess > 0 ? (totalProcessed / totalToProcess) * 100 : 0;
                    
                    return (
                        <div key={profileName} className="space-y-2 border-b last:border-0 pb-3 last:pb-0">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Badge 
                                        variant="outline" 
                                        className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors flex items-center gap-1 group"
                                        onClick={() => navigate(route, { state: { targetProfile: profileName } })}
                                        title={`Go to ${title}`}
                                    >
                                        {profileName}
                                        <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                                    </Badge>
                                    {job.isPaused && <Badge variant="secondary" className="text-xs">Paused</Badge>}
                                </div>
                                {job.isProcessing ? (
                                    <span className="flex items-center text-xs text-blue-600 font-medium animate-pulse">
                                        <Activity className="h-3 w-3 mr-1" /> Running
                                    </span>
                                ) : job.isComplete ? (
                                    <span className="flex items-center text-xs text-green-600 font-medium">
                                        <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                                    </span>
                                ) : (
                                    <span className="text-xs text-muted-foreground">Idle</span>
                                )}
                            </div>

                            <div className="space-y-1">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Progress</span>
                                    <span>{totalProcessed} / {totalToProcess}</span>
                                </div>
                                <Progress value={progress} className="h-1.5" />
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-1">
                                <div className="flex flex-col items-center bg-green-50/50 dark:bg-green-900/10 p-1 rounded">
                                    <span className="text-[10px] text-muted-foreground uppercase">Success</span>
                                    <span className="text-sm font-bold text-green-600">{successCount}</span>
                                </div>
                                <div className="flex flex-col items-center bg-red-50/50 dark:bg-red-900/10 p-1 rounded">
                                    <span className="text-[10px] text-muted-foreground uppercase">Failed</span>
                                    <span className="text-sm font-bold text-red-600">{failCount}</span>
                                </div>
                                <div className="flex flex-col items-center bg-muted/50 p-1 rounded">
                                    <span className="text-[10px] text-muted-foreground uppercase">Time</span>
                                    <span className="text-xs font-mono font-medium mt-0.5">{formatTime(job.processingTime || 0)}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
};

export const LiveStats: React.FC<LiveStatsProps> = ({ 
    invoiceJobs, booksJobs, booksContactJobs, customJobs, booksCustomJobs, 
    billingJobs, billingContactJobs, billingCustomJobs,
    expenseJobs, 
    onAddProfile, onEditProfile, onDeleteProfile, socket 
}) => {
    const [now, setNow] = useState(Date.now());
    
    // --- DRAG AND DROP STATE ---
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [statsCards, setStatsCards] = useState([
        { id: 'inv-inv', title: "Inventory: Invoices", icon: Package, jobMap: invoiceJobs, route: "/bulk-invoices" },
        { id: 'inv-cust', title: "Inventory: Custom", icon: Database, jobMap: customJobs, route: "/custom-modules" },
        
        { id: 'books-inv', title: "Books: Invoices", icon: Book, jobMap: booksJobs, route: "/books-invoices" },
        { id: 'books-cont', title: "Books: Contacts", icon: Users, jobMap: booksContactJobs, route: "/books-contacts" },
        { id: 'books-cust', title: "Books: Custom", icon: Layers, jobMap: booksCustomJobs, route: "/books-custom-modules" },
        
        // --- BILLING CARDS (Removed Invoices) ---
        // { id: 'bill-inv', title: "Billing: Invoices", icon: Banknote, jobMap: billingJobs, route: "/billing-invoices" }, // REMOVED
        { id: 'bill-cont', title: "Billing: Contacts", icon: Users, jobMap: billingContactJobs, route: "/billing-contacts" },
        { id: 'bill-cust', title: "Billing: Custom", icon: Layers, jobMap: billingCustomJobs, route: "/billing-custom-modules" },

        { id: 'expense', title: "Zoho Expense", icon: CreditCard, jobMap: expenseJobs, route: "/expense" },
    ]);

    // Update jobMaps in state when props change
    useEffect(() => {
        setStatsCards(prev => prev.map(card => {
            if (card.id === 'inv-inv') return { ...card, jobMap: invoiceJobs };
            if (card.id === 'inv-cust') return { ...card, jobMap: customJobs };
            
            if (card.id === 'books-inv') return { ...card, jobMap: booksJobs };
            if (card.id === 'books-cont') return { ...card, jobMap: booksContactJobs };
            if (card.id === 'books-cust') return { ...card, jobMap: booksCustomJobs };
            
            // if (card.id === 'bill-inv') return { ...card, jobMap: billingJobs }; // REMOVED
            if (card.id === 'bill-cont') return { ...card, jobMap: billingContactJobs };
            if (card.id === 'bill-cust') return { ...card, jobMap: billingCustomJobs };

            if (card.id === 'expense') return { ...card, jobMap: expenseJobs };
            return card;
        }));
    }, [invoiceJobs, booksJobs, booksContactJobs, customJobs, booksCustomJobs, billingJobs, billingContactJobs, billingCustomJobs, expenseJobs]);

    const { data: profiles = [] } = useQuery<Profile[]>({
        queryKey: ['profiles'],
        queryFn: async () => {
            const res = await fetch(`${SERVER_URL}/api/profiles`);
            if (!res.ok) throw new Error("Failed to fetch profiles");
            return res.json();
        },
    });

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    // --- GLOBAL STATS CALCULATION ---
    const allJobs = [
        invoiceJobs, booksJobs, booksContactJobs, customJobs, booksCustomJobs, 
        // billingJobs, // REMOVED from Global Stats
        billingContactJobs, billingCustomJobs,
        expenseJobs
    ];
    let activeJobCount = 0;
    let totalSuccess = 0;
    let totalErrors = 0;
    let globalStartTime: number | null = null;
    let globalEndTime: number | null = null;
    let globalTotalProcessed = 0;
    let globalTotalToProcess = 0;
    let globalIsProcessing = false;

    allJobs.forEach(jobMap => {
        if (!jobMap) return;
        Object.values(jobMap).forEach((job: any) => {
            const hasActivity = job.results?.length > 0 || job.isProcessing;
            if (hasActivity) {
                if (job.isProcessing) {
                    activeJobCount++;
                    globalIsProcessing = true;
                }
                if (job.results) {
                    totalSuccess += job.results.filter((r: any) => r.success === true).length;
                    totalErrors += job.results.filter((r: any) => r.success === false).length;
                    globalTotalProcessed += job.results.length;
                }
                if (job.totalToProcess) globalTotalToProcess += job.totalToProcess;

                if (job.processingStartTime) {
                    const start = new Date(job.processingStartTime).getTime();
                    if (globalStartTime === null || start < globalStartTime) globalStartTime = start;
                    
                    let end = start; 
                    if (job.isProcessing) end = now;
                    else if (job.processingTime) end = start + (job.processingTime * 1000); 

                    if (globalEndTime === null || end > globalEndTime) globalEndTime = end;
                }
            }
        });
    });

    const totalElapsedSeconds = (globalStartTime && globalEndTime) 
        ? Math.floor(Math.max(0, globalEndTime - globalStartTime) / 1000) 
        : 0;

    const emitToAll = (action: 'pauseJob' | 'resumeJob' | 'endJob') => {
        if (!socket) return;
        
        const emitForMap = (map: any, type: string) => {
             Object.keys(map).forEach(profileName => {
                const job = map[profileName];
                if (job.isProcessing || job.isPaused || job.results.length > 0) {
                    if (action === 'endJob' || (action === 'pauseJob' && !job.isPaused) || (action === 'resumeJob' && job.isPaused)) {
                        socket.emit(action, { profileName, jobType: type });
                    }
                }
            });
        };

        emitForMap(invoiceJobs, 'invoice');
        emitForMap(booksJobs, 'books');
        emitForMap(booksContactJobs, 'books-contact');
        
        // emitForMap(billingJobs, 'billing'); // REMOVED
        emitForMap(billingContactJobs, 'billing-contact');

        Object.keys(customJobs).forEach(profileName => {
            const job = customJobs[profileName];
            if (job.isProcessing || job.isPaused || job.results.length > 0) {
                 if (action === 'endJob' || (action === 'pauseJob' && !job.isPaused) || (action === 'resumeJob' && job.isPaused)) {
                    socket.emit(action, { profileName, jobType: job.formData.moduleApiName });
                }
            }
        });

        emitForMap(booksCustomJobs, 'books-custom');
        emitForMap(billingCustomJobs, 'billing-custom');
        emitForMap(expenseJobs, 'expense');
    };

    // --- DRAG HANDLERS ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = "move"; 
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault(); 
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (draggedIndex === null) return;
        if (draggedIndex === dropIndex) return;

        const newCards = [...statsCards];
        const [movedCard] = newCards.splice(draggedIndex, 1);
        newCards.splice(dropIndex, 0, movedCard);
        
        setStatsCards(newCards);
        setDraggedIndex(null);
    };

    return (
        <DashboardLayout
            onAddProfile={onAddProfile}
            onEditProfile={onEditProfile}
            onDeleteProfile={onDeleteProfile}
            profiles={profiles}
            selectedProfile={null}
            onProfileChange={() => {}}
            socket={socket}
            apiStatus={{ status: 'success', message: 'Monitoring' }}
            onManualVerify={() => {}}
            onShowStatus={() => {}}
            jobs={invoiceJobs} 
            stats={{
                totalTickets: globalTotalProcessed,
                totalToProcess: globalTotalToProcess,
                isProcessing: globalIsProcessing
            }}
        >
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Live Statistics</h1>
                        <p className="text-muted-foreground">Real-time monitoring of active jobs. Drag cards to reorder.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => emitToAll('resumeJob')}>
                            <Play className="h-4 w-4 mr-2" /> Resume All
                        </Button>
                        <Button variant="outline" onClick={() => emitToAll('pauseJob')}>
                            <Pause className="h-4 w-4 mr-2" /> Pause All
                        </Button>
                        <Button variant="destructive" onClick={() => emitToAll('endJob')}>
                            <Square className="h-4 w-4 mr-2" /> End All
                        </Button>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
                            <Activity className={`h-4 w-4 ${activeJobCount > 0 ? 'text-blue-500 animate-spin' : 'text-muted-foreground'}`} />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{activeJobCount}</div>
                            <p className="text-xs text-muted-foreground">Currently processing</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Success</CardTitle>
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{totalSuccess}</div>
                            <p className="text-xs text-muted-foreground">Records processed</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Errors</CardTitle>
                            <AlertCircle className="h-4 w-4 text-red-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{totalErrors}</div>
                            <p className="text-xs text-muted-foreground">Records failed</p>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Time Elapsed</CardTitle>
                            <Clock className="h-4 w-4 text-purple-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{formatTime(totalElapsedSeconds)}</div>
                            <p className="text-xs text-muted-foreground">Global duration</p>
                        </CardContent>
                    </Card>
                </div>

                {/* --- DRAGGABLE GRID --- */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {statsCards.map((card, index) => (
                        <div
                            key={card.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            className="cursor-grab active:cursor-grabbing transition-transform"
                            style={{ opacity: draggedIndex === index ? 0.4 : 1 }}
                        >
                            <ServiceStatCard 
                                title={card.title} 
                                icon={card.icon} 
                                jobMap={card.jobMap} 
                                route={card.route}
                                isDragging={draggedIndex === index}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </DashboardLayout>
    );
};

export default LiveStats;