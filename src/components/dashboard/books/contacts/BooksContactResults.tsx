import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Eye, Search, Loader2, Users, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

// Define result interface locally or import if shared
export interface ContactResult {
  rowNumber: number;
  email: string;
  stage: 'contact' | 'complete';
  success: boolean;
  details?: string;
  contactResponse?: any;
  emailResponse?: any;
  timestamp?: Date;
}

interface BooksContactResultsProps {
  results: ContactResult[];
  isProcessing: boolean;
  totalRows: number;
  filterText: string;
  onFilterTextChange: (text: string) => void;
}

const ITEMS_PER_PAGE = 100;

export const BooksContactResults: React.FC<BooksContactResultsProps> = ({ 
  results, isProcessing, totalRows, filterText, onFilterTextChange
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  const formatTime = (dateInput?: Date) => {
    if (!dateInput) return '-';
    const date = new Date(dateInput);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  useEffect(() => { setCurrentPage(1); }, [filterText, statusFilter]);

  const filteredResults = useMemo(() => {
    let res = results;
    if (statusFilter === 'success') res = res.filter(r => r.stage === 'complete' && r.success);
    else if (statusFilter === 'error') res = res.filter(r => r.stage === 'complete' && !r.success);
    
    if (filterText) {
        const lower = filterText.toLowerCase();
        res = res.filter(r => r.email.toLowerCase().includes(lower) || (r.details || '').toLowerCase().includes(lower));
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
  const successCount = results.filter(r => r.stage === 'complete' && r.success).length;
  const errorCount = completedCount - successCount;
  const progressPercent = totalRows > 0 ? (completedCount / totalRows) * 100 : 0;

  const handleExportTxt = () => {
    const content = filteredResults.map(r => r.email).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contacts_${statusFilter}.txt`;
    link.click();
  };

  if (results.length === 0 && !isProcessing) return null;

  return (
    <Card className="shadow-medium hover:shadow-large transition-all duration-300 mt-8 border-t-4 border-t-blue-500">
      <CardHeader className="pb-4">
        <div className="flex justify-between items-center">
           <div className="flex items-center gap-2"><Users className="h-5 w-5 text-blue-600" /><CardTitle>Contact Results</CardTitle></div>
           <div className="flex gap-2">
               <Badge variant="outline" className={statusFilter === 'all' ? "bg-blue-100 text-blue-700 border-blue-200" : "cursor-pointer"} onClick={() => setStatusFilter('all')}>All: {results.length}</Badge>
               <Badge variant="outline" className={statusFilter === 'success' ? "bg-green-100 text-green-700 border-green-200" : "cursor-pointer text-green-600"} onClick={() => setStatusFilter(prev => prev === 'success' ? 'all' : 'success')}>Success: {successCount}</Badge>
               <Badge variant="outline" className={statusFilter === 'error' ? "bg-red-100 text-red-700 border-red-200" : "cursor-pointer text-destructive"} onClick={() => setStatusFilter(prev => prev === 'error' ? 'all' : 'error')}>Errors: {errorCount}</Badge>
           </div>
        </div>
        <CardDescription>{isProcessing ? `Processing... ${completedCount}/${totalRows}` : 'Complete'}</CardDescription>
      </CardHeader>
      <CardContent>
        {isProcessing && <div className="w-full bg-muted h-2 mb-6 rounded-full"><div className="bg-blue-600 h-2 rounded-full" style={{ width: `${progressPercent}%` }} /></div>}
        
        {results.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-4 flex-1">
                   <div className="relative w-full max-w-sm">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Filter..." value={filterText} onChange={e => onFilterTextChange(e.target.value)} className="pl-10"/>
                   </div>
                   {/* --- ADDED FOUND COUNT --- */}
                   <div className="text-sm text-muted-foreground font-medium whitespace-nowrap">
                        Found: {filteredResults.length}
                   </div>
               </div>
               <Button variant="outline" size="sm" onClick={handleExportTxt}><FileText className="mr-2 h-4 w-4"/>Export List</Button>
            </div>
            
            <ScrollArea className="h-[600px] border rounded-lg">
                <table className="w-full">
                    <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr>
                            <th className="p-3 text-left text-xs w-16">#</th>
                            <th className="p-3 text-left text-xs">Email</th>
                            <th className="p-3 text-left text-xs">Status</th>
                            <th className="p-3 text-center text-xs w-24">Time</th>
                            <th className="p-3 text-center text-xs w-24">Contact</th>
                            <th className="p-3 text-center text-xs w-24">Email</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedResults.map(r => (
                            <tr key={r.rowNumber} className={r.stage === 'complete' && !r.success ? 'bg-red-50/50' : ''}>
                                <td className="p-3 text-sm text-muted-foreground">{r.rowNumber}</td>
                                <td className="p-3 text-sm font-mono">{r.email}</td>
                                <td className={`p-3 text-sm ${!r.success && r.stage === 'complete' ? 'text-destructive' : 'text-muted-foreground'}`}>{r.details}</td>
                                <td className="p-3 text-center text-xs text-muted-foreground">{formatTime(r.timestamp)}</td>
                                <td className="p-3 text-center">
                                    <div className="flex justify-center items-center gap-2">
                                        {r.contactResponse ? (r.contactResponse.success ? <CheckCircle2 className="h-4 w-4 text-green-500"/> : <XCircle className="h-4 w-4 text-red-500"/>) : (isProcessing ? <Loader2 className="h-4 w-4 animate-spin"/> : <div className="h-4 w-4"/>)}
                                        {r.contactResponse && <Dialog><DialogTrigger><Eye className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground"/></DialogTrigger><DialogContent className="max-w-2xl"><pre className="max-h-[60vh] overflow-auto text-xs bg-muted p-4 rounded">{JSON.stringify(r.contactResponse, null, 2)}</pre></DialogContent></Dialog>}
                                    </div>
                                </td>
                                <td className="p-3 text-center">
                                    <div className="flex justify-center items-center gap-2">
                                        {r.emailResponse ? (r.emailResponse.success ? <CheckCircle2 className="h-4 w-4 text-green-500"/> : <XCircle className="h-4 w-4 text-red-500"/>) : (isProcessing && r.contactResponse?.success && r.stage !== 'complete' ? <Loader2 className="h-4 w-4 animate-spin"/> : <div className="h-4 w-4"/>)}
                                        {r.emailResponse && <Dialog><DialogTrigger><Eye className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground"/></DialogTrigger><DialogContent className="max-w-2xl"><pre className="max-h-[60vh] overflow-auto text-xs bg-muted p-4 rounded">{JSON.stringify(r.emailResponse, null, 2)}</pre></DialogContent></Dialog>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ScrollArea>
            
            {totalPages > 1 && (
                <div className="flex items-center justify-between py-4 border-t mt-4 px-2">
                    <div className="text-xs text-muted-foreground">Page {currentPage} of {totalPages}</div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="icon" onClick={() => setCurrentPage(1)} disabled={currentPage===1}><ChevronsLeft className="h-4 w-4"/></Button>
                        <Button variant="outline" size="icon" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage===1}><ChevronLeft className="h-4 w-4"/></Button>
                        <Button variant="outline" size="icon" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage===totalPages}><ChevronRight className="h-4 w-4"/></Button>
                        <Button variant="outline" size="icon" onClick={() => setCurrentPage(totalPages)} disabled={currentPage===totalPages}><ChevronsRight className="h-4 w-4"/></Button>
                    </div>
                </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};