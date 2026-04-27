import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Profile } from '@/App';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';

type ApiStatus = {
  status: 'loading' | 'success' | 'error';
  message: string;
  fullResponse?: any;
};

interface Invoice {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  status: string;
  total: number;
  balance: number;
  is_viewed_by_client: boolean;
  is_emailed: boolean;
  email?: string;
}

interface PageContext {
    page: number;
    per_page: number;
    has_more_page: boolean;
    report_name: string;
    applied_filter: string;
    sort_column: string;
    sort_order: string;
}

interface EmailStaticsProps {
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
}

const SERVER_URL = "http://localhost:3009";

const EmailStatics: React.FC<EmailStaticsProps> = ({ onAddProfile, onEditProfile, onDeleteProfile }) => {
  const { toast } = useToast();
  const socketRef = useRef<Socket | null>(null);
  
  // Refs to access latest state inside socket listeners without triggering re-renders/re-connections
  const activeProfileRef = useRef<string | null>(null);
  const fetchInvoicesRef = useRef<() => void>(() => {});

  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ status: 'loading', message: 'Connecting to server...' });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState({ status: '', search_text: '' });
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [quickFilter, setQuickFilter] = useState<'all' | 'emailed' | 'viewed' | 'not_emailed' | 'not_viewed'>('all');

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
  const selectedProfile = inventoryProfiles.find(p => p.profileName === activeProfileName) || null;

  // Sync ref with state
  useEffect(() => {
    activeProfileRef.current = activeProfileName;
  }, [activeProfileName]);

  const fetchInvoices = useCallback(() => {
    const profileToUse = activeProfileName || activeProfileRef.current;
    if (profileToUse && socketRef.current) {
      setIsLoading(true);
      socketRef.current.emit('getInvoices', { 
          selectedProfileName: profileToUse, 
          ...filters,
          page: currentPage,
          per_page: 200,
        });
    }
  }, [activeProfileName, filters, currentPage]);

  // Keep the ref updated with the latest fetch function
  useEffect(() => {
    fetchInvoicesRef.current = fetchInvoices;
  }, [fetchInvoices]);

  const checkApiStatus = useCallback(() => {
    const profileToUse = activeProfileName || activeProfileRef.current;
    if (profileToUse && socketRef.current) {
      setApiStatus({ status: 'loading', message: 'Checking API connection...' });
      socketRef.current.emit('checkApiStatus', { selectedProfileName: profileToUse, service: 'inventory' });
    }
  }, [activeProfileName]);

  // --- Socket Initialization (Run Once) ---
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
        toast({ title: "Connected to server!" });
        // Automatically fetch if we have a profile selected upon connection
        if (activeProfileRef.current) {
            setTimeout(() => {
                fetchInvoicesRef.current(); 
            }, 100);
        }
    });

    socket.on('apiStatusResult', (result) => setApiStatus({
      status: result.success ? 'success' : 'error',
      message: result.message,
      fullResponse: result.fullResponse || null
    }));
    
    socket.on('invoicesResult', (data) => {
      setIsLoading(false);
      if (data.success) {
        setInvoices(data.invoices);
        setPageContext(data.page_context);
      } else {
        toast({ title: "Error fetching invoices", description: data.error, variant: "destructive" });
      }
    });

    socket.on('invoiceDeleteProgress', (progress) => {
        setDeleteProgress(progress.deletedCount / progress.total * 100);
    });

    socket.on('invoicesDeletedResult', (data) => {
        setIsDeleting(false);
        setDeleteProgress(0);
        setSelectedInvoices([]);
        if (data.success) {
            toast({ title: "Invoices Deleted", description: `${data.deletedCount} invoices have been deleted.` });
            fetchInvoicesRef.current();
        } else {
            toast({ title: "Error Deleting Invoices", description: data.error, variant: "destructive" });
        }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // --- EFFECT 1: Check API Status ONLY on Profile Change ---
  useEffect(() => {
    if (activeProfileName) {
      checkApiStatus();
    }
  }, [activeProfileName, checkApiStatus]);

  // --- EFFECT 2: Fetch Data on Profile OR Filter/Page Change ---
  useEffect(() => {
    if (activeProfileName) {
      fetchInvoices();
    }
  }, [activeProfileName, fetchInvoices]); 

  
  // Set initial profile
  useEffect(() => {
    if (inventoryProfiles.length > 0 && !activeProfileName) {
      setActiveProfileName(inventoryProfiles[0].profileName);
    }
  }, [inventoryProfiles, activeProfileName]);

  const handleProfileChange = (profileName: string) => {
    setActiveProfileName(profileName);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleManualVerify = () => {
    toast({ title: "Re-checking Connection..." });
    checkApiStatus();
  };

  const handleSelectInvoice = (invoiceId: string) => {
    setSelectedInvoices(prev => 
      prev.includes(invoiceId) 
        ? prev.filter(id => id !== invoiceId) 
        : [...prev, invoiceId]
    );
  };

  const handleSelectAll = () => {
    if (selectedInvoices.length === filteredInvoices.length) {
      setSelectedInvoices([]);
    } else {
      setSelectedInvoices(filteredInvoices.map(inv => inv.invoice_id));
    }
  };

  const handleDelete = () => {
    if (selectedInvoices.length > 0 && socketRef.current) {
        setShowDeleteConfirm(false);
        setIsDeleting(true);
        socketRef.current.emit('deleteInvoices', { selectedProfileName: activeProfileName, invoiceIds: selectedInvoices });
    }
  };
  
  const emailedCount = useMemo(() => invoices.filter(inv => inv.is_emailed).length, [invoices]);
  const viewedCount = useMemo(() => invoices.filter(inv => inv.is_viewed_by_client).length, [invoices]);
  const notEmailedCount = useMemo(() => invoices.filter(inv => !inv.is_emailed).length, [invoices]);
  const notViewedCount = useMemo(() => invoices.filter(inv => !inv.is_viewed_by_client).length, [invoices]);

  const filteredInvoices = useMemo(() => {
    switch (quickFilter) {
        case 'emailed': return invoices.filter(inv => inv.is_emailed);
        case 'viewed': return invoices.filter(inv => inv.is_viewed_by_client);
        case 'not_emailed': return invoices.filter(inv => !inv.is_emailed);
        case 'not_viewed': return invoices.filter(inv => !inv.is_viewed_by_client);
        default: return invoices;
    }
  }, [invoices, quickFilter]);

  return (
      <>
        <DashboardLayout
            onAddProfile={onAddProfile}
            profiles={inventoryProfiles}
            selectedProfile={selectedProfile}
            jobs={{}}
            onProfileChange={handleProfileChange}
            apiStatus={apiStatus}
            onShowStatus={() => setIsStatusModalOpen(true)}
            onManualVerify={handleManualVerify}
            socket={socketRef.current}
            onEditProfile={onEditProfile}
            onDeleteProfile={onDeleteProfile}
            service="inventory"
        >
          <div className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>Email Statics</CardTitle>
                <CardDescription>View and filter the status of your invoices.</CardDescription>
                 <div className="flex flex-wrap gap-2 pt-4">
                  <Badge 
                    variant={quickFilter === 'all' ? "default" : "outline"} 
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setQuickFilter('all')}
                  >
                    All: {invoices.length}
                  </Badge>
                  <Badge 
                    variant={quickFilter === 'emailed' ? "default" : "outline"} 
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setQuickFilter(quickFilter === 'emailed' ? 'all' : 'emailed')}
                  >
                    Emailed: {emailedCount}
                  </Badge>
                  <Badge 
                    variant={quickFilter === 'viewed' ? "default" : "outline"} 
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setQuickFilter(quickFilter === 'viewed' ? 'all' : 'viewed')}
                  >
                    Viewed: {viewedCount}
                  </Badge>
                  <Badge 
                    variant={quickFilter === 'not_emailed' ? "destructive" : "outline"} 
                    className={`cursor-pointer hover:opacity-80 transition-opacity ${quickFilter === 'not_emailed' ? '' : 'border-destructive text-destructive hover:bg-destructive/10'}`}
                    onClick={() => setQuickFilter(quickFilter === 'not_emailed' ? 'all' : 'not_emailed')}
                  >
                    Not Emailed: {notEmailedCount}
                  </Badge>
                  <Badge 
                    variant={quickFilter === 'not_viewed' ? "destructive" : "outline"} 
                    className={`cursor-pointer hover:opacity-80 transition-opacity ${quickFilter === 'not_viewed' ? '' : 'border-destructive text-destructive hover:bg-destructive/10'}`}
                    onClick={() => setQuickFilter(quickFilter === 'not_viewed' ? 'all' : 'not_viewed')}
                  >
                    Not Viewed: {notViewedCount}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between mb-4">
                  <div className="flex gap-4">
                    <Input
                      name="search_text"
                      placeholder="Search by name or number..."
                      value={filters.search_text}
                      onChange={handleFilterChange}
                      className="w-64"
                    />
                    <Input
                      name="status"
                      placeholder="Filter by API status..."
                      value={filters.status}
                      onChange={handleFilterChange}
                      className="w-64"
                    />
                  </div>
                   <div className="flex gap-2">
                    <Button onClick={() => setShowDeleteConfirm(true)} disabled={selectedInvoices.length === 0} variant="destructive">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete ({selectedInvoices.length})
                    </Button>
                    <Button onClick={fetchInvoices} disabled={isLoading}>
                      {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Refresh
                    </Button>
                  </div>
                </div>
                 {isDeleting && (
                    <div className="my-4">
                        <Progress value={deleteProgress} className="w-full" />
                        <p className="text-sm text-center mt-2 text-muted-foreground">Deleting {selectedInvoices.length} invoices...</p>
                    </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={selectedInvoices.length === filteredInvoices.length && filteredInvoices.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Customer Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Emailed</TableHead>
                      <TableHead>Viewed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                            </TableRow>
                        ))
                    ) : filteredInvoices.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} className="h-24 text-center">
                                No invoices found matching the current filters.
                            </TableCell>
                        </TableRow>
                    ) : (
                        filteredInvoices.map(invoice => (
                      <TableRow key={invoice.invoice_id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedInvoices.includes(invoice.invoice_id)}
                            onCheckedChange={() => handleSelectInvoice(invoice.invoice_id)}
                          />
                        </TableCell>
                        <TableCell>{invoice.invoice_number}</TableCell>
                        <TableCell>{invoice.customer_name}</TableCell>
                        <TableCell>{invoice.email}</TableCell>
                        <TableCell>{invoice.total}</TableCell>
                        <TableCell>{invoice.balance}</TableCell>
                        <TableCell>
                            <Badge variant={invoice.is_emailed ? "default" : "secondary"}>
                                {invoice.is_emailed ? 'Yes' : 'No'}
                            </Badge>
                        </TableCell>
                        <TableCell>
                            <Badge variant={invoice.is_viewed_by_client ? "default" : "secondary"}>
                                {invoice.is_viewed_by_client ? 'Yes' : 'No'}
                            </Badge>
                        </TableCell>
                      </TableRow>
                    )))}
                  </TableBody>
                </Table>
                {pageContext && (
                    <Pagination className="mt-4">
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious
                                    onClick={() => setCurrentPage(p => p - 1)}
                                    className={currentPage === 1 ? 'pointer-events-none text-muted-foreground' : 'cursor-pointer'}
                                />
                            </PaginationItem>
                            <PaginationItem>
                                <PaginationLink>{currentPage}</PaginationLink>
                            </PaginationItem>
                            <PaginationItem>
                                <PaginationNext
                                    onClick={() => setCurrentPage(p => p + 1)}
                                    className={!pageContext.has_more_page ? 'pointer-events-none text-muted-foreground' : 'cursor-pointer'}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                )}
              </CardContent>
            </Card>
          </div>
        </DashboardLayout>

        <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>API Connection Status</DialogTitle>
                    <DialogDescription>This is the live status of the connection to the Zoho Inventory API for the selected profile.</DialogDescription>
                </DialogHeader>
                <div className={`p-4 rounded-md ${apiStatus.status === 'success' ? 'bg-green-100 dark:bg-green-900/50' : apiStatus.status === 'error' ? 'bg-red-100 dark:bg-red-900/50' : 'bg-muted'}`}>
                    <p className="font-bold text-lg">{apiStatus.status.charAt(0).toUpperCase() + apiStatus.status.slice(1)}</p>
                    <p className="text-sm text-muted-foreground mt-1">{apiStatus.message}</p>
                </div>
                {apiStatus.fullResponse && (
                    <div className="mt-4">
                        <h4 className="text-sm font-semibold mb-2 text-foreground">Full Response from Server:</h4>
                        <pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border max-h-60 overflow-y-auto">
                            {JSON.stringify(apiStatus.fullResponse, null, 2)}
                        </pre>
                    </div>
                )}
                <Button onClick={() => setIsStatusModalOpen(false)} className="mt-4">Close</Button>
            </DialogContent>
        </Dialog>
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Are you sure?</DialogTitle>
                    <DialogDescription>
                        This will permanently delete {selectedInvoices.length} invoice(s). This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDelete}>Delete</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      </>
  );
};

export default EmailStatics;