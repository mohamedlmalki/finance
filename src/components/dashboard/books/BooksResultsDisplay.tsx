import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Eye, Search, Loader2, BarChart3, Trash2, FileText, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

// Redefine interface to ensure self-containment
export interface InvoiceResult {
  rowNumber: number;
  email: string;
  stage: 'contact' | 'invoice' | 'complete';
  success: boolean;
  message: string;
  details?: string;
  invoiceNumber?: string;
  contactResponse?: any;
  invoiceResponse?: any;
  emailResponse?: any;
  timestamp?: Date;
}

interface BooksResultsDisplayProps {
  results: InvoiceResult[];
  isProcessing: boolean;
  totalRows: number;
  filterText: string;
  onFilterTextChange: (text: string) => void;
  onDeleteInvoices: (invoiceIds: string[]) => void;
}

const ITEMS_PER_PAGE = 100;

export const BooksResultsDisplay: React.FC<BooksResultsDisplayProps> = ({ 
  results, 
  isProcessing, 
  totalRows,
  filterText,
  onFilterTextChange,
  onDeleteInvoices
}) => {
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Helper: Format Time
  const formatTime = (dateInput?: Date) => {
    if (!dateInput) return '-';
    const date = new Date(dateInput);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterText, statusFilter]);

  const filteredResults = useMemo(() => {
    let res = results;

    // 1. Apply Status Filter
    if (statusFilter === 'success') {
        res = res.filter(r => r.stage === 'complete' && r.success);
    } else if (statusFilter === 'error') {
        res = res.filter(r => r.stage === 'complete' && !r.success);
    }

    // 2. Apply Text Filter
    if (filterText) {
        const lowerFilter = filterText.toLowerCase();
        res = res.filter(r => 
          r.email.toLowerCase().includes(lowerFilter) ||
          (r.details || '').toLowerCase().includes(lowerFilter)
        );
    }
    return res;
  }, [results, filterText, statusFilter]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);
  const paginatedResults = useMemo(() => {
      // Reverse first to show newest at top, then paginate
      const reversed = [...filteredResults].reverse();
      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      return reversed.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredResults, currentPage]);

  const completedCount = results.filter(r => r.stage === 'complete').length;
  const successCount = results.filter(r => r.stage === 'complete' && r.success).length;
  const errorCount = completedCount - successCount;
  const progressPercent = totalRows > 0 ? (completedCount / totalRows) * 100 : 0;
  
  const getInvoiceId = (result: InvoiceResult) => {
    // Works for both Books and Inventory structure
    return result.invoiceResponse?.fullResponse?.invoice?.invoice_id;
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Select ONLY items on the current page that have IDs
      const pageIds = paginatedResults
        .filter(r => getInvoiceId(r))
        .map(r => r.rowNumber);
        
      // Merge with existing selection
      setSelectedRows(prev => Array.from(new Set([...prev, ...pageIds])));
    } else {
      // Deselect items on the current page
      const pageRowNumbers = paginatedResults.map(r => r.rowNumber);
      setSelectedRows(prev => prev.filter(id => !pageRowNumbers.includes(id)));
    }
  };

  const handleSelectRow = (rowNumber: number, checked: boolean) => {
    if (checked) {
      setSelectedRows(prev => [...prev, rowNumber]);
    } else {
      setSelectedRows(prev => prev.filter(id => id !== rowNumber));
    }
  };

  const handleDeleteSelected = () => {
    const idsToDelete = results
        .filter(r => selectedRows.includes(r.rowNumber))
        .map(r => getInvoiceId(r))
        .filter(Boolean);
    
    if (idsToDelete.length > 0) {
        onDeleteInvoices(idsToDelete);
        setSelectedRows([]); 
        setIsDeleteDialogOpen(false);
    }
  };

  const handleExportTxt = () => {
    const content = filteredResults.map(r => r.email).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `books_emails_${statusFilter}_${new Date().toISOString().slice(0,10)}.txt`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleFilter = (type: 'success' | 'error') => {
      setStatusFilter(prev => prev === type ? 'all' : type);
  };
  
  if (results.length === 0 && !isProcessing) {
    return null;
  }

  // Check if all selectable items on CURRENT page are selected
  const allOnPageSelected = paginatedResults.length > 0 && paginatedResults
      .filter(r => getInvoiceId(r))
      .every(r => selectedRows.includes(r.rowNumber));

  return (
    <Card className="shadow-medium hover:shadow-large transition-all duration-300 mt-8 border-t-4 border-t-orange-500">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Books Processing Results</CardTitle>
          </div>
          
          <div className="flex items-center space-x-3 select-none">
            <Badge 
                variant="outline" 
                className={cn(
                    "cursor-pointer transition-all hover:bg-muted",
                    statusFilter === 'all' ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-muted-foreground"
                )}
                onClick={() => setStatusFilter('all')}
            >
                All: {results.length}
            </Badge>

            <Badge 
                variant="outline" 
                className={cn(
                    "bg-green-500/10 text-green-600 cursor-pointer transition-all border-transparent hover:border-green-200",
                    statusFilter === 'success' && "ring-2 ring-green-500 ring-offset-2 bg-green-500/20"
                )}
                onClick={() => toggleFilter('success')}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {successCount} Success
            </Badge>
            
            {errorCount > 0 && (
              <Badge 
                variant="destructive" 
                className={cn(
                    "bg-destructive/10 cursor-pointer transition-all border-transparent hover:border-destructive/20",
                    statusFilter === 'error' && "ring-2 ring-destructive ring-offset-2 bg-destructive/20"
                )}
                onClick={() => toggleFilter('error')}
              >
                <XCircle className="h-3 w-3 mr-1" />
                {errorCount} Errors
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>
          {isProcessing ? `Processing... ${completedCount} / ${totalRows} complete.` : 'Processing complete.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isProcessing && (
           <div className="w-full bg-muted rounded-full h-2 mb-6">
              <div 
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
        )}
        
        {results.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4 flex-1">
                <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Filter results..."
                    value={filterText}
                    onChange={(e) => onFilterTextChange(e.target.value)}
                    className="pl-10"
                />
                </div>
                <div className="text-sm text-muted-foreground font-medium whitespace-nowrap">
                    Found: {filteredResults.length}
                </div>
            </div>

            <div className="flex items-center space-x-2">
                {selectedRows.length > 0 && (
                    <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                                <Trash2 className="h-4 w-4 mr-2"/>
                                Delete ({selectedRows.length})
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Delete Books Invoices?</DialogTitle>
                                <DialogDescription>
                                    Are you sure you want to delete <b>{selectedRows.length}</b> invoices from Zoho Books? This action cannot be undone.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                                <Button variant="destructive" onClick={handleDeleteSelected}>Confirm Delete</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}
                
                <Button variant="outline" size="sm" onClick={handleExportTxt} disabled={filteredResults.length === 0}>
                    <FileText className="h-4 w-4 mr-2"/>
                    Export Emails (.txt)
                </Button>
            </div>
          </div>
        )}
        
        {results.length > 0 && (
          <>
            <ScrollArea className="h-[600px] w-full rounded-lg border">
                <table className="w-full">
                <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                    <th className="p-3 w-10">
                        <Checkbox 
                            checked={allOnPageSelected}
                            onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                        />
                    </th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground w-16">Row #</th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground">Email</th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="p-3 text-center text-xs font-medium text-muted-foreground w-20">Time</th>
                    <th className="p-3 text-center text-xs font-medium text-muted-foreground w-24">Contact</th>
                    <th className="p-3 text-center text-xs font-medium text-muted-foreground w-24">Invoice</th>
                    <th className="p-3 text-center text-xs font-medium text-muted-foreground w-24">Email</th>
                    </tr>
                </thead>
                <tbody className="bg-card divide-y divide-border">
                    {paginatedResults.length === 0 ? (
                        <tr>
                            <td colSpan={8} className="p-8 text-center text-muted-foreground">
                                No results match your filter.
                            </td>
                        </tr>
                    ) : (
                        paginatedResults.map((result) => {
                            const invoiceId = getInvoiceId(result);
                            const isSelectable = !!invoiceId;
                            
                            return (
                            <tr key={result.rowNumber} className={result.stage === 'complete' && !result.success ? 'bg-destructive/5' : ''}>
                                <td className="p-3">
                                    <Checkbox 
                                        checked={selectedRows.includes(result.rowNumber)}
                                        onCheckedChange={(checked) => handleSelectRow(result.rowNumber, checked as boolean)}
                                        disabled={!isSelectable}
                                    />
                                </td>
                                <td className="p-3 text-sm font-mono text-center text-muted-foreground">{result.rowNumber}</td>
                                <td className="p-3 text-sm font-mono">{result.email}</td>
                                <td className={`p-3 text-sm ${result.stage === 'complete' && !result.success ? 'text-destructive' : 'text-muted-foreground'}`}>{result.details}</td>
                                
                                <td className="p-3 text-center text-xs text-muted-foreground">{formatTime(result.timestamp)}</td>

                                <td className="p-3">
                                <div className="flex items-center justify-center space-x-2">
                                    {result.contactResponse ? (
                                    result.contactResponse.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />
                                    ) : (isProcessing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/> : <div className='h-4 w-4' />)}
                                    
                                    {result.contactResponse && (
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl">
                                            <DialogHeader><DialogTitle>Contact Response</DialogTitle></DialogHeader>
                                            <pre className="mt-2 max-h-[60vh] overflow-y-auto rounded-md bg-muted p-4 text-xs font-mono">
                                            {JSON.stringify(result.contactResponse.fullResponse || result.contactResponse, null, 2)}
                                            </pre>
                                        </DialogContent>
                                        </Dialog>
                                    )}
                                </div>
                                </td>

                                <td className="p-3">
                                <div className="flex items-center justify-center space-x-2">
                                    {result.invoiceResponse ? (
                                    result.invoiceResponse.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />
                                    ) : (isProcessing && result.contactResponse ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/> : <div className='h-4 w-4' />)}

                                    {result.invoiceResponse && (
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl">
                                            <DialogHeader><DialogTitle>Invoice Response</DialogTitle></DialogHeader>
                                            <pre className="mt-2 max-h-[60vh] overflow-y-auto rounded-md bg-muted p-4 text-xs font-mono">
                                            {JSON.stringify(result.invoiceResponse.fullResponse || result.invoiceResponse, null, 2)}
                                            </pre>
                                        </DialogContent>
                                        </Dialog>
                                    )}
                                </div>
                                </td>
                                
                                <td className="p-3">
                                <div className="flex items-center justify-center space-x-2">
                                    {result.emailResponse ? (
                                    result.emailResponse.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />
                                    ) : (isProcessing && result.invoiceResponse && !result.emailResponse ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/> : <div className='h-4 w-4' />)}

                                    {result.emailResponse && (
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-4 w-4" /></Button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl">
                                            <DialogHeader><DialogTitle>Email Response</DialogTitle></DialogHeader>
                                            <pre className="mt-2 max-h-[60vh] overflow-y-auto rounded-md bg-muted p-4 text-xs font-mono">
                                            {JSON.stringify(result.emailResponse.fullResponse || result.emailResponse, null, 2)}
                                            </pre>
                                        </DialogContent>
                                        </Dialog>
                                    )}
                                </div>
                                </td>
                            </tr>
                            );
                        })
                    )}
                </tbody>
                </table>
            </ScrollArea>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between py-4 border-t mt-4">
                    <div className="text-xs text-muted-foreground">
                        Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredResults.length)} of {filteredResults.length} entries
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(1)}
                            disabled={currentPage === 1}
                        >
                            <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        
                        <div className="text-sm font-medium mx-2">
                            Page {currentPage} of {totalPages}
                        </div>

                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(totalPages)}
                            disabled={currentPage === totalPages}
                        >
                            <ChevronsRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};