// --- FILE: src/components/dashboard/ProfileModal.tsx ---
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Profile } from '@/App';
import { useToast } from '@/hooks/use-toast';
import { KeyRound, Loader2, Building, Receipt, Book, Banknote, Package, Link2, CloudDownload, List, Zap } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profileData: Profile, originalProfileName?: string) => void;
  profile: Profile | null;
  socket: Socket | null;
}

const SERVER_URL = "http://localhost:3009";

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, onSave, profile, socket }) => {
  const { toast } = useToast();
  
  const [formData, setFormData] = useState<Profile>({
    profileName: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    cloudflareTrackingUrl: '',
    inventory: { orgId: '', customModuleApiName: 'cm_', note: '' },
    books: { orgId: '', customModuleApiName: '', note: '' },
    billing: { orgId: '', customModuleApiName: 'cm_', note: '' },
    expense: { orgId: '', customModuleApiName: '', note: '' },
    flow: { webhookUrl: '', workerUrl: '', note: '' } 
  });
  const [activeTab, setActiveTab] = useState('inventory');

  const [isFetchingOrgs, setIsFetchingOrgs] = useState(false);
  const [fetchedOrgs, setFetchedOrgs] = useState<any[]>([]);
  const [isFetchingModules, setIsFetchingModules] = useState(false);
  const [fetchedModules, setFetchedModules] = useState<any[]>([]);

  useEffect(() => {
    setFetchedOrgs([]);
    setFetchedModules([]);
  }, [activeTab]);

  useEffect(() => {
    if (!socket) return;

    const handleOrgs = (res: any) => {
        setIsFetchingOrgs(false);
        if (res.success) {
            setFetchedOrgs(res.organizations);
            toast({ title: "Organizations Found", description: `Discovered ${res.organizations.length} accounts.` });
        } else {
            toast({ title: "Fetch Failed", description: res.message, variant: "destructive" });
        }
    };

    const handleModules = (res: any) => {
        setIsFetchingModules(false);
        if (res.success) {
            setFetchedModules(res.modules);
            toast({ title: "Modules Found", description: `Discovered ${res.modules.length} modules.` });
        } else {
            toast({ title: "Fetch Failed", description: res.message, variant: "destructive" });
        }
    };

    socket.on('fetchOrgsResult', handleOrgs);
    socket.on('fetchCustomModulesResult', handleModules);

    return () => {
        socket.off('fetchOrgsResult', handleOrgs);
        socket.off('fetchCustomModulesResult', handleModules);
    };
  }, [socket, toast]);

  useEffect(() => {
    if (profile) {
      setFormData({
        profileName: profile.profileName || '',
        clientId: profile.clientId || '',
        clientSecret: profile.clientSecret || '',
        refreshToken: profile.refreshToken || '',
        cloudflareTrackingUrl: profile.cloudflareTrackingUrl || (profile as any).inventory?.cloudflareTrackingUrl || (profile as any).billing?.cloudflareTrackingUrl || '',
        inventory: { 
            orgId: profile.inventory?.orgId || '', 
            customModuleApiName: profile.inventory?.customModuleApiName || 'cm_',
            note: profile.inventory?.note || ''
        },
        books: { 
            orgId: profile.books?.orgId || '', 
            customModuleApiName: profile.books?.customModuleApiName || '',
            note: profile.books?.note || ''
        },
        billing: { 
            orgId: profile.billing?.orgId || '', 
            customModuleApiName: profile.billing?.customModuleApiName || 'cm_',
            note: profile.billing?.note || ''
        },
        expense: { 
            orgId: profile.expense?.orgId || '', 
            customModuleApiName: profile.expense?.customModuleApiName || '',
            note: profile.expense?.note || ''
        },
        flow: {
            webhookUrl: profile.flow?.webhookUrl || '',
            workerUrl: profile.flow?.workerUrl || '',
            note: profile.flow?.note || ''
        }
      });
    } else {
      setFormData({
        profileName: '', clientId: '', clientSecret: '', refreshToken: '', cloudflareTrackingUrl: '',
        inventory: { orgId: '', customModuleApiName: 'cm_', note: '' },
        books: { orgId: '', customModuleApiName: '', note: '' },
        billing: { orgId: '', customModuleApiName: 'cm_', note: '' },
        expense: { orgId: '', customModuleApiName: '', note: '' },
        flow: { webhookUrl: '', workerUrl: '', note: '' } 
      });
    }
    setActiveTab('inventory');
    setFetchedOrgs([]);
    setFetchedModules([]);
  }, [profile, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.profileName) {
      toast({ title: "Error", description: "Profile Name is required.", variant: "destructive" });
      return;
    }
    
    const hasZohoCreds = formData.clientId && formData.clientSecret && formData.refreshToken;
    const hasFlowWebhook = formData.flow?.webhookUrl && formData.flow.webhookUrl.trim() !== '';

    if (!hasZohoCreds && !hasFlowWebhook) {
      toast({ title: "Error", description: "You must provide either Zoho API Credentials OR a Flow Webhook URL.", variant: "destructive" });
      return;
    }
    
    const cleanFormData = { ...formData };
    if (cleanFormData.inventory) delete (cleanFormData.inventory as any).cloudflareTrackingUrl;
    if (cleanFormData.billing) delete (cleanFormData.billing as any).cloudflareTrackingUrl;

    onSave(cleanFormData, profile?.profileName);
  };

  const handleAuthorize = async () => {
    if (!formData.clientId || !formData.clientSecret || !socket) return toast({ title: "Error", description: "Enter Client ID and Secret first.", variant: "destructive" });
    try {
        const response = await fetch(`${SERVER_URL}/api/zoho/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: formData.clientId, clientSecret: formData.clientSecret, socketId: socket.id }),
        });
        const data = await response.json();
        if (data.authUrl) {
            window.open(data.authUrl, '_blank', 'width=600,height=700');
            toast({ title: "Auth Started", description: "Please approve in the popup." });
        }
    } catch (e) { toast({ title: "Error", variant: "destructive" }); }
  };

  const handleFetchOrgs = (service: string) => {
    if (!formData.clientId || !formData.clientSecret || !formData.refreshToken) {
        return toast({ title: "Missing Keys", description: "Please enter Client ID, Secret, and Refresh Token first.", variant: "destructive" });
    }
    
    setIsFetchingOrgs(true);
    socket?.emit('fetchOrgs', { profile: formData, service });
  };

  const handleFetchModules = (service: string) => {
    const orgId = (formData as any)[service]?.orgId;
    if (!formData.clientId || !formData.clientSecret || !formData.refreshToken || !orgId) {
        return toast({ title: "Missing Info", description: `Please enter keys and fetch an Org ID for ${service} first.`, variant: "destructive" });
    }

    setIsFetchingModules(true);
    socket?.emit('fetchCustomModules', { profile: formData, service });
  };

  useEffect(() => {
      if(!socket) return;
      const handleToken = (data: { refreshToken: string }) => {
          setFormData(prev => ({ ...prev, refreshToken: data.refreshToken }));
          toast({ title: "Authorized!", description: "Refresh Token captured." });
      };
      socket.on('zoho-refresh-token', handleToken);
      return () => { socket.off('zoho-refresh-token', handleToken); };
  }, [socket, toast]);

  const renderServiceFields = (service: 'inventory' | 'books' | 'billing' | 'expense', labelPrefix: string) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="grid gap-2">
            <Label>{labelPrefix} Organization ID</Label>
            <div className="flex gap-2">
                <Input 
                    value={formData[service]?.orgId || ''} 
                    onChange={e => setFormData({ ...formData, [service]: { ...formData[service]!, orgId: e.target.value } })} 
                    placeholder="e.g. 123456789" 
                    className="flex-1" 
                />
                {fetchedOrgs.length > 0 && activeTab === service ? (
                    <Select onValueChange={(val) => setFormData({ ...formData, [service]: { ...formData[service]!, orgId: val } })}>
                        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Select Org" /></SelectTrigger>
                        <SelectContent>
                            {fetchedOrgs.map(org => (<SelectItem key={String(org.organization_id)} value={String(org.organization_id)}>{org.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                ) : (
                    <Button type="button" variant="secondary" className="px-3" disabled={isFetchingOrgs || !formData.clientId || !formData.refreshToken} onClick={() => handleFetchOrgs(service)} title="Fetch Organizations">
                        {isFetchingOrgs && activeTab === service ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                    </Button>
                )}
            </div>
        </div>
        <div className="grid gap-2">
            <Label>{labelPrefix} Module API Name</Label>
            <div className="flex gap-2">
                <Input 
                    value={formData[service]?.customModuleApiName || ''} 
                    onChange={e => setFormData({ ...formData, [service]: { ...formData[service]!, customModuleApiName: e.target.value } })} 
                    placeholder="e.g. cm_a" 
                    className="flex-1" 
                />
                {fetchedModules.length > 0 && activeTab === service ? (
                    <Select onValueChange={(val) => setFormData({ ...formData, [service]: { ...formData[service]!, customModuleApiName: val } })}>
                        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Select Module" /></SelectTrigger>
                        <SelectContent>
                            {fetchedModules.map(mod => (<SelectItem key={mod.api_name} value={mod.api_name}>{mod.module_name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                ) : (
                    <Button type="button" variant="secondary" className="px-3" disabled={isFetchingModules || !formData[service]?.orgId} onClick={() => handleFetchModules(service)} title="Fetch Modules">
                        {isFetchingModules && activeTab === service ? <Loader2 className="h-4 w-4 animate-spin" /> : <List className="h-4 w-4" />}
                    </Button>
                )}
            </div>
        </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[750px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile ? 'Edit Profile' : 'Add New Profile'}</DialogTitle>
          <DialogDescription>Configure API credentials and webhooks.</DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <form id="profile-form" onSubmit={handleSubmit} className="space-y-4">
            
            <div className="p-4 border rounded-md bg-muted/20 space-y-4">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-primary"/>
                        <h3 className="font-semibold text-sm">Zoho API Credentials</h3>
                    </div>
                    <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground font-medium uppercase tracking-wider">Optional for Webhooks</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label>Profile Name <span className="text-red-500">*</span></Label>
                        <Input value={formData.profileName} onChange={e => setFormData({ ...formData, profileName: e.target.value })} placeholder="e.g. My Company" />
                    </div>
                    <div className="grid gap-2">
                        <Label>Client ID</Label>
                        <Input value={formData.clientId} onChange={e => setFormData({ ...formData, clientId: e.target.value })} placeholder="Zoho Client ID" />
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label>Client Secret</Label>
                        <Input value={formData.clientSecret} onChange={e => setFormData({ ...formData, clientSecret: e.target.value })} placeholder="Zoho Client Secret" />
                    </div>
                    <div className="grid gap-2">
                        <Label>Refresh Token</Label>
                        <div className="flex gap-2">
                            <Input value={formData.refreshToken} onChange={e => setFormData({ ...formData, refreshToken: e.target.value })} placeholder="Click 'Get Token'" />
                            <Button type="button" size="sm" variant="secondary" onClick={handleAuthorize} disabled={!formData.clientId || !formData.clientSecret}>Get Token</Button>
                        </div>
                    </div>
                </div>

                <div className="grid gap-1 pt-2">
                    <Label className="text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-2">
                        <Link2 className="h-4 w-4" /> Global Tracking Server URL (Optional)
                    </Label>
                    <Input 
                        value={formData.cloudflareTrackingUrl || ''} 
                        onChange={e => setFormData({ ...formData, cloudflareTrackingUrl: e.target.value })} 
                        placeholder="e.g. https://logger.workers.dev" 
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">This URL applies to all Apps for Base64 Email Tracking Injection.</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="inventory" className="flex items-center gap-2"><Package className="h-3 w-3 sm:h-4 sm:w-4"/><span className="hidden sm:inline">Inventory</span></TabsTrigger>
                <TabsTrigger value="books" className="flex items-center gap-2"><Book className="h-3 w-3 sm:h-4 sm:w-4"/><span className="hidden sm:inline">Books</span></TabsTrigger>
                <TabsTrigger value="billing" className="flex items-center gap-2"><Banknote className="h-3 w-3 sm:h-4 sm:w-4"/><span className="hidden sm:inline">Billing</span></TabsTrigger>
                <TabsTrigger value="expense" className="flex items-center gap-2"><Receipt className="h-3 w-3 sm:h-4 sm:w-4"/><span className="hidden sm:inline">Expense</span></TabsTrigger>
                <TabsTrigger value="flow" className="flex items-center gap-2"><Zap className="h-3 w-3 sm:h-4 sm:w-4 text-yellow-500 fill-yellow-500"/><span className="hidden sm:inline">Flow</span></TabsTrigger>
              </TabsList>

              <TabsContent value="inventory" className="space-y-4 border p-4 rounded-md mt-2">
                {renderServiceFields('inventory', 'Inventory')}
                <div className="grid gap-2 pt-2 border-t mt-2">
                    <Label>Inventory Note</Label>
                    <Textarea value={formData.inventory?.note || ''} onChange={e => setFormData({ ...formData, inventory: { ...formData.inventory!, note: e.target.value } })} placeholder="Optional notes..." className="min-h-[60px]" />
                </div>
              </TabsContent>

              <TabsContent value="books" className="space-y-4 border p-4 rounded-md mt-2">
                {renderServiceFields('books', 'Books')}
                <div className="grid gap-2 pt-2 border-t mt-2">
                    <Label>Books Note</Label>
                    <Textarea value={formData.books?.note || ''} onChange={e => setFormData({ ...formData, books: { ...formData.books!, note: e.target.value } })} placeholder="Optional notes..." className="min-h-[60px]" />
                </div>
              </TabsContent>

              <TabsContent value="billing" className="space-y-4 border p-4 rounded-md mt-2">
                {renderServiceFields('billing', 'Billing')}
                <div className="grid gap-2 pt-2 border-t mt-2">
                    <Label>Billing Note</Label>
                    <Textarea value={formData.billing?.note || ''} onChange={e => setFormData({ ...formData, billing: { ...formData.billing!, note: e.target.value } })} placeholder="Optional notes for Billing..." className="min-h-[60px]" />
                </div>
              </TabsContent>

              <TabsContent value="expense" className="space-y-4 border p-4 rounded-md mt-2">
                {renderServiceFields('expense', 'Expense')}
                <div className="grid gap-2 pt-2 border-t mt-2">
                    <Label>Expense Note</Label>
                    <Textarea value={formData.expense?.note || ''} onChange={e => setFormData({ ...formData, expense: { ...formData.expense!, note: e.target.value } })} placeholder="Optional notes for Expense..." className="min-h-[60px]" />
                </div>
              </TabsContent>

              <TabsContent value="flow" className="space-y-4 border p-4 rounded-md mt-2">
                <div className="grid gap-2">
                    <Label>Flow Webhook URL</Label>
                    <Input 
                        value={formData.flow?.webhookUrl || ''} 
                        onChange={e => setFormData({ ...formData, flow: { ...formData.flow!, webhookUrl: e.target.value } })} 
                        placeholder="https://flow.zoho.com/..." 
                        className="font-mono text-xs"
                    />
                </div>
                
                {/* 🚨 ADDED WORKER URL FIELD */}
                <div className="grid gap-2 pt-2 border-t mt-2">
                    <Label className="text-amber-600 font-semibold">Cloudflare Worker URL (Strict Polling)</Label>
                    <Input 
                        value={formData.flow?.workerUrl || ''} 
                        onChange={e => setFormData({ ...formData, flow: { ...formData.flow!, workerUrl: e.target.value } })} 
                        placeholder="https://your-worker.workers.dev" 
                        className="font-mono text-xs border-amber-200"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Required to use the "Waiting Room" strict polling feature. If left empty, Strict Mode will be disabled.</p>
                </div>

                <div className="grid gap-2 pt-2 border-t mt-2">
                    <Label>Flow Note</Label>
                    <Textarea 
                        value={formData.flow?.note || ''} 
                        onChange={e => setFormData({ ...formData, flow: { ...formData.flow!, note: e.target.value } })} 
                        placeholder="Optional notes about this webhook..." 
                        className="min-h-[60px]" 
                    />
                </div>
              </TabsContent>

            </Tabs>
            <div className="h-4"></div>
          </form>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-background">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="profile-form">Save Profile</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};