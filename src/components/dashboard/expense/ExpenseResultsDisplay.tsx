import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    CheckCircle2, XCircle, Eye, Hash, BarChart3, Download, Search, 
    ShieldCheck, Loader2, Clock, Hourglass,
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ExpenseResult {
    primaryValue: string;
    success: boolean;
    details?: string;
    message?: string;
    error?: string;
    fullResponse?: any;
    verificationResponse?: any;
    recordId?: string;
    timestamp?: Date; // Timestamp field
    rowNumber?: number;
}

interface ResultsDisplayProps {
  results: ExpenseResult[];
  isProcessing: boolean;
  isComplete: boolean;
  totalToProcess: number;
  countdown: number;
  processingTime: number; 
  filterText: string;
  onFilterTextChange: (text: string) => void;
  primaryFieldLabel: string;
}

const ITEMS_PER_PAGE = 50;

export const ExpenseResultsDisplay: React.FC<ResultsDisplayProps> = ({ 
    results, 
    isProcessing, 
    isComplete, 
    totalToProcess, 
    countdown, 
    processingTime, 
    filterText, 
    onFilterTextChange, 
    primaryFieldLabel 
}) => {
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
    const [currentPage, setCurrentPage] = useState(1);

    // --- Time Formatter ---
    const formatTime = (dateInput?: Date) => {
        if (!dateInput) return '-';
        const date = new Date(dateInput);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [filterText, statusFilter, results.length]);

    const filteredResults = useMemo(() => {
        let res = [...results].reverse();
        
        if (statusFilter === 'success') res = res.filter(r => r.success);
        else if (statusFilter === 'error') res = res.filter(r => !r.success);

        if (filterText) {
            const lowerFilter = filterText.toLowerCase();
            res = res.filter(r => 
                (r.primaryValue || '').toLowerCase().includes(lowerFilter) ||
                (r.details || '').toLowerCase().includes(lowerFilter) ||
                (r.message || '').toLowerCase().includes(lowerFilter)
            );
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
    const progressPercent = totalToProcess > 0 ? (completedCount / totalToProcess) * 100 : 0;
    const remaining = Math.max(0, totalToProcess - completedCount);

    const handleExportTxt = () => {
        const content = filteredResults.map(r => 
            `${r.rowNumber || '-'} | ${r.primaryValue} | ${r.success ? 'SUCCESS' : 'FAILED'} | ${r.message || ''} | ${r.details || ''}`
        ).join('\n');
        
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `expense_results_${new Date().getTime()}.txt`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const toggleFilter = (type: 'success' | 'error') => {
        setStatusFilter(prev => prev === type ? 'all' : type);
    };

    return (
    <div className="flex flex-col space-y-4">
        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-4">
            <Card>
                <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-muted-foreground text-xs font-medium uppercase">Time</span>
                    <div className="text-2xl font-bold flex items-center mt-1">
                        <Clock className="w-5 h-5 mr-2 text-primary"/> {formatDuration(processingTime)}
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-muted-foreground text-xs font-medium uppercase">Success</span>
                    <div className="text-2xl font-bold flex items-center mt-1 text-green-600">
                        <CheckCircle2 className="w-5 h-5 mr-2"/> {successCount}
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-muted-foreground text-xs font-medium uppercase">Failed</span>
                    <div className="text-2xl font-bold flex items-center mt-1 text-red-600">
                        <XCircle className="w-5 h-5 mr-2"/> {errorCount}
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-muted-foreground text-xs font-medium uppercase">Remaining</span>
                    <div className="text-2xl font-bold flex items-center mt-1 text-blue-600">
                        <Hourglass className="w-5 h-5 mr-2"/> {remaining}
                    </div>
                </CardContent>
            </Card>
        </div>

        {/* Main Table Card */}
        <Card className="shadow-medium h-full flex flex-col">
        <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
                <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary" />
                        Processing Results
                    </CardTitle>
                    <CardDescription>
                        {isProcessing ? 
                            `Processing... ${completedCount} / ${totalToProcess}` : 
                            isComplete ? "Job Completed" : "Waiting..."}
                    </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("cursor-pointer", statusFilter === 'all' && "bg-secondary")} onClick={() => setStatusFilter('all')}>
                        All: {results.length}
                    </Badge>
                    <Badge variant="outline" className={cn("text-green-600 border-green-200 cursor-pointer", statusFilter === 'success' && "bg-green-50")} onClick={() => setStatusFilter('success')}>
                        <CheckCircle2 className="w-3 h-3 mr-1"/> {successCount}
                    </Badge>
                    <Badge variant="outline" className={cn("text-red-600 border-red-200 cursor-pointer", statusFilter === 'error' && "bg-red-50")} onClick={() => setStatusFilter('error')}>
                        <XCircle className="w-3 h-3 mr-1"/> {errorCount}
                    </Badge>
                </div>
            </div>
            
            {isProcessing && (
                <div className="w-full bg-muted rounded-full h-1.5 mt-4 overflow-hidden">
                    <div className="bg-primary h-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
                </div>
            )}
        </CardHeader>

        <CardContent className="flex-1 flex flex-col min-h-0 space-y-4">
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder={`Filter by ${primaryFieldLabel.toLowerCase()}...`} 
                        value={filterText}
                        onChange={(e) => onFilterTextChange(e.target.value)}
                        className="pl-9"
                    />
                </div>
                
                {/* --- ADDED: Found Count --- */}
                <div className="text-sm text-muted-foreground font-medium whitespace-nowrap min-w-[80px] text-right">
                    Found: {filteredResults.length}
                </div>

                <Button variant="outline" size="icon" onClick={handleExportTxt} title="Export Filtered">
                    <FileText className="h-4 w-4" />
                </Button>
            </div>

            <ScrollArea className="h-[600px] w-full rounded-lg border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
                        <tr>
                            <th className="px-4 py-3 text-left w-12"><Hash className="h-4 w-4" /></th>
                            <th className="px-4 py-3 text-left font-medium">{primaryFieldLabel}</th>
                            <th className="px-4 py-3 text-left w-32">Status</th>
                            <th className="px-4 py-3 text-left">Details</th>
                            {/* --- ADDED: Time Column --- */}
                            <th className="px-4 py-3 text-center w-20">Time</th>
                            <th className="px-4 py-3 text-center w-20">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {paginatedResults.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                                    No results found matching your filter.
                                </td>
                            </tr>
                        ) : (
                            paginatedResults.map((result, index) => {
                                const displayDetails = result.details || result.message || result.error;
                                const isVerified = displayDetails?.includes('Verified');
                                const isPending = displayDetails?.includes('Verifying') || displayDetails?.includes('Pending');
                                const actualIndex = filteredResults.length - ((currentPage - 1) * ITEMS_PER_PAGE + index);

                                return (
                                    <tr key={`${index}-${result.primaryValue}`} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-4 py-3 text-center text-muted-foreground font-mono">{actualIndex}</td>
                                        <td className="px-4 py-3 font-medium">{result.primaryValue}</td>
                                        <td className="px-4 py-3">
                                            {result.success ? (
                                                isVerified ? (
                                                    <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
                                                        <ShieldCheck className="w-3 h-3 mr-1"/> Verified
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                                                        {isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                                                        Success
                                                    </Badge>
                                                )
                                            ) : (
                                                <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
                                                    <XCircle className="w-3 h-3 mr-1"/> Failed
                                                </Badge>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground truncate max-w-[300px]" title={displayDetails}>
                                            {displayDetails}
                                        </td>
                                        
                                        {/* --- ADDED: Time Cell --- */}
                                        <td className="px-4 py-3 text-center text-muted-foreground">{formatTime(result.timestamp)}</td>
                                        
                                        <td className="px-4 py-3 text-center">
                                            <Dialog>
                                                <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button></DialogTrigger>
                                                <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                                                    <DialogHeader><DialogTitle>Record Details</DialogTitle></DialogHeader>
                                                    <Tabs defaultValue="create" className="w-full">
                                                        <TabsList className="grid w-full grid-cols-2">
                                                            <TabsTrigger value="create">1. Creation Response</TabsTrigger>
                                                            <TabsTrigger value="verify">2. Verification Log</TabsTrigger>
                                                        </TabsList>
                                                        <TabsContent value="create">
                                                            <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono border max-h-[400px] overflow-auto">
                                                                {JSON.stringify(result.fullResponse, null, 2)}
                                                            </pre>
                                                        </TabsContent>
                                                        <TabsContent value="verify">
                                                            {result.verificationResponse ? (
                                                                <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono border max-h-[400px] overflow-auto">
                                                                    {JSON.stringify(result.verificationResponse, null, 2)}
                                                                </pre>
                                                            ) : (
                                                                <div className="p-8 text-center text-muted-foreground border rounded-md bg-muted/20">
                                                                    <p>No verification data available.</p>
                                                                    <p className="text-xs mt-1">Wait for the process to complete or enable 'Verify Log'.</p>
                                                                </div>
                                                            )}
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

            {totalPages > 1 && (
                <div className="flex items-center justify-between px-2 pt-4 border-t mt-4">
                    <div className="text-xs text-muted-foreground">
                        Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredResults.length)} of {filteredResults.length} entries
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                            <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center justify-center text-sm font-medium w-[80px]">
                            Page {currentPage} / {totalPages}
                        </div>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                            <ChevronsRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </CardContent>
        </Card>
    </div>
  );
};