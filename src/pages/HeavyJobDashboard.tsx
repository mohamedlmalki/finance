import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Play, AlertCircle, CheckCircle2, Activity, Database } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

// Define the shape of our number-only state
interface JobStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
}

export default function HeavyJobDashboard() {
  const { toast } = useToast();
  
  // 1. MEMORY SAFE STATE: We only track numbers, NEVER massive arrays.
  const [stats, setStats] = useState<JobStats>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
  });
  const [isJobRunning, setIsJobRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // Modal State for Failed Items
  const [isFailedModalOpen, setIsFailedModalOpen] = useState(false);
  const [failedItems, setFailedItems] = useState<any[]>([]);
  const [isLoadingFails, setIsLoadingFails] = useState(false);

  // Calculate percentage dynamically
  const progressPercentage = stats.total > 0 
    ? Math.round((stats.processed / stats.total) * 100) 
    : 0;

  // 2. MOCK START FUNCTION (Replace with your actual API call)
  const startHeavyJob = async () => {
    setIsJobRunning(true);
    // Reset stats
    setStats({ total: 50000, processed: 0, success: 0, failed: 0 });
    
    try {
      // TODO: Replace with your actual POST request to /api/flow with { isHeavyJob: true }
      /*
      const response = await fetch('/api/flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: 10, action: 'flow', isHeavyJob: true })
      });
      const data = await response.json();
      setJobId(data.jobId);
      */
      
      toast({
        title: "Heavy Job Started",
        description: "Background workers are processing chunks.",
      });
    } catch (error) {
      console.error(error);
      setIsJobRunning(false);
    }
  };

  // 3. LISTEN FOR LIVE UPDATES (Throttled numbers only)
  useEffect(() => {
    if (!isJobRunning) return;

    // TODO: Connect this to your Socket.io / Server-Sent-Events listener
    // It should listen for messages sent by redisPubSub in the worker
    const handleJobUpdate = (updateData: Partial<JobStats>) => {
      setStats((prev) => {
        const newStats = { ...prev, ...updateData };
        
        // Stop the job if we hit the total
        if (newStats.processed >= newStats.total) {
          setIsJobRunning(false);
          toast({ title: "Job Complete", description: "All chunks processed." });
        }
        
        return newStats;
      });
    };

    /* Example Socket listener:
       socket.on('heavy-job-update', handleJobUpdate);
       return () => socket.off('heavy-job-update', handleJobUpdate);
    */
  }, [isJobRunning, toast]);


  // 4. FETCH ONLY FAILED ITEMS
  const fetchFailedItems = async () => {
    setIsLoadingFails(true);
    setIsFailedModalOpen(true);
    
    try {
      // TODO: Replace with your actual new backend GET endpoint
      /*
      const res = await fetch(`/api/flow/failed-items?jobId=${jobId}&limit=50`);
      const data = await res.json();
      setFailedItems(data.items);
      */
      
      // Mock data for UI testing
      setTimeout(() => {
        setFailedItems([
          { id: 1, account: 'Account 2', error: 'Rate limit exceeded' },
          { id: 2, account: 'Account 4', error: 'Invalid credentials' },
        ]);
        setIsLoadingFails(false);
      }, 1000);
      
    } catch (error) {
      console.error(error);
      setIsLoadingFails(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Heavy Processing Mode</h1>
          <p className="text-slate-500 mt-1">Optimized dashboard for massive &gt;50k item jobs. UI rendering is disabled to prevent memory crashes.</p>
        </div>
        <Button 
          onClick={startHeavyJob} 
          disabled={isJobRunning}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isJobRunning ? <Activity className="mr-2 h-4 w-4 animate-pulse" /> : <Play className="mr-2 h-4 w-4" />}
          {isJobRunning ? 'Processing...' : 'Start Heavy Job'}
        </Button>
      </div>

      {/* Progress Bar Section */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex justify-between items-end">
            <CardTitle className="text-lg font-medium text-slate-700">Overall Progress</CardTitle>
            <span className="text-2xl font-bold text-slate-900">{progressPercentage}%</span>
          </div>
        </CardHeader>
        <CardContent>
          <Progress value={progressPercentage} className="h-4 bg-slate-100" />
          <p className="text-sm text-slate-500 mt-3 text-right">
            {stats.processed.toLocaleString()} / {stats.total.toLocaleString()} processed
          </p>
        </CardContent>
      </Card>

      {/* Statistic Cards (Numbers Only) */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Total Items</CardTitle>
            <Database className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.total.toLocaleString()}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Successful</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600">{stats.success.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Failed</CardTitle>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-rose-600">{stats.failed.toLocaleString()}</div>
            {stats.failed > 0 && progressPercentage === 100 && (
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-4 w-full border-rose-200 text-rose-700 hover:bg-rose-50"
                onClick={fetchFailedItems}
              >
                View Failed Items
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Failed Items Modal */}
      <Dialog open={isFailedModalOpen} onOpenChange={setIsFailedModalOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Failed Processing Items</DialogTitle>
            <DialogDescription>
              Displaying the items that failed during the bulk operation.
            </DialogDescription>
          </DialogHeader>
          
          {isLoadingFails ? (
            <div className="py-10 text-center text-slate-500">Loading database records...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">ID</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Error Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedItems.map((item, i) => (
                  <TableRow key={item.id || i}>
                    <TableCell className="font-medium">{item.id || 'N/A'}</TableCell>
                    <TableCell>{item.account}</TableCell>
                    <TableCell className="text-right text-rose-600">{item.error}</TableCell>
                  </TableRow>
                ))}
                {failedItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-slate-500">
                      No failed items found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}