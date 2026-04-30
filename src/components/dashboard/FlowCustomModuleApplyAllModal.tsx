// --- FILE: src/components/dashboard/FlowCustomModuleApplyAllModal.tsx ---
import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Profile } from '@/App';
import { CopyCheck, Building, Database, ChevronDown, ChevronUp, Zap, AlertOctagon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface FlowCustomModuleApplyAllModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedProfiles: string[], modalFormData: any, modalTrackingData: any, applyOptions: any) => void;
  profiles: Profile[];
  initialData: {
      bulkData: string;
      staticData: Record<string, string>;
      delay: number;
      concurrency: number;
      stopAfterFailures: number; 
      trackingEnabled: boolean;
      targetHtmlField: string;
      appendAccountName: boolean; 
  };
}

export const FlowCustomModuleApplyAllModal: React.FC<FlowCustomModuleApplyAllModalProps> = ({ 
    isOpen, onClose, onApply, profiles, initialData
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkData, setBulkData] = useState('');
  const [staticData, setStaticData] = useState<Record<string, string>>({});
  const [delay, setDelay] = useState(0);
  const [concurrency, setConcurrency] = useState(1);
  const [stopAfterFailures, setStopAfterFailures] = useState(0); 
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [targetHtmlField, setTargetHtmlField] = useState('');
  const [appendAccountName, setAppendAccountName] = useState(false);
  const [isAccountsExpanded, setIsAccountsExpanded] = useState(false);

  const [applyOptions, setApplyOptions] = useState({
      iterator: true,
      staticFields: true,
      execution: true,
      tracking: true
  });

  const eligibleProfiles = useMemo(() => {
      return profiles.filter(p => p.flow && p.flow.webhookUrl);
  }, [profiles]);

  useEffect(() => {
    if (isOpen) {
      setBulkData(initialData.bulkData || '');
      setStaticData(initialData.staticData || {});
      setDelay(initialData.delay ?? 0);
      setConcurrency(initialData.concurrency ?? 1);
      setStopAfterFailures(initialData.stopAfterFailures ?? 0); 
      setTrackingEnabled(initialData.trackingEnabled || false);
      setTargetHtmlField(initialData.targetHtmlField || '');
      setAppendAccountName(initialData.appendAccountName || false); 

      setSelected(eligibleProfiles.map(p => p.profileName));
      setIsAccountsExpanded(false); 
      setApplyOptions({ iterator: true, staticFields: true, execution: true, tracking: true });
    }
  // 🚨 FIX: Removed initialData from dependencies so it doesn't wipe when typing!
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const toggleProfile = (name: string) => setSelected(prev => prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]);
  const handleStaticChange = (key: string, value: string) => setStaticData(prev => ({ ...prev, [key]: value }));

  const recordCount = useMemo(() => bulkData.split('\n').filter(line => line.trim() !== '').length, [bulkData]);

  const handleApply = () => {
    onApply(
        selected, 
        { bulkData, staticData, delay, concurrency, stopAfterFailures }, 
        { trackingEnabled, targetHtmlField, appendAccountName }, 
        applyOptions 
    );
    onClose();
  };

  const isApplyDisabled = selected.length === 0 || 
                          (!applyOptions.iterator && !applyOptions.staticFields && !applyOptions.execution && !applyOptions.tracking);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] xl:max-w-[1200px] w-full flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="px-6 py-4 border-b bg-muted/10">
          <DialogTitle className="flex items-center text-xl"><Zap className="w-5 h-5 mr-2 text-yellow-500 fill-yellow-500" /> Apply Flow Settings to Accounts</DialogTitle>
          <DialogDescription>Uncheck the sections you want to ignore. Checked sections will overwrite the target accounts.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pb-4">
            
            <div className="lg:col-span-5 space-y-6">
              {/* 1. ACCOUNTS */}
              <div className="space-y-3">
                <Label className="text-primary font-bold text-base flex items-center border-b pb-1">1. Select Target Accounts</Label>
                <div className="flex flex-col bg-muted/30 border rounded-md overflow-hidden">
                  <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setIsAccountsExpanded(!isAccountsExpanded)}>
                    <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                       <Checkbox id="select-all" checked={selected.length === eligibleProfiles.length && eligibleProfiles.length > 0} onCheckedChange={(c) => setSelected(c ? eligibleProfiles.map(p => p.profileName) : [])} />
                       <Label htmlFor="select-all" className="font-bold cursor-pointer text-primary">Selected Accounts ({selected.length} / {eligibleProfiles.length})</Label>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-transparent">{isAccountsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
                  </div>
                  {isAccountsExpanded && (
                    <div className="p-3 pt-0 border-t bg-background/50">
                        <ScrollArea className="h-[200px] pr-4 mt-2">
                          <div className="grid grid-cols-2 gap-2">
                            {eligibleProfiles.map(p => (
                              <div key={p.profileName} className="flex items-center space-x-2 p-1.5 hover:bg-muted/50 rounded-md transition-colors">
                                <Checkbox id={`profile-${p.profileName}`} checked={selected.includes(p.profileName)} onCheckedChange={() => toggleProfile(p.profileName)} />
                                <Label htmlFor={`profile-${p.profileName}`} className="flex items-center gap-2 cursor-pointer flex-1 font-medium text-sm truncate"><Building className="h-4 w-4 text-muted-foreground flex-shrink-0" /> <span className="truncate">{p.profileName}</span></Label>
                              </div>
                            ))}
                            {eligibleProfiles.length === 0 && (<div className="col-span-2 text-center p-4 text-sm text-muted-foreground italic">No other accounts are configured for Webhooks.</div>)}
                          </div>
                        </ScrollArea>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. ITERATOR */}
              <div className="space-y-3">
                <Label className="text-primary font-bold text-base flex items-center border-b pb-1 gap-2 cursor-pointer" onClick={() => setApplyOptions({...applyOptions, iterator: !applyOptions.iterator})}>
                    <Checkbox checked={applyOptions.iterator} onCheckedChange={(c) => setApplyOptions({...applyOptions, iterator: !!c})} onClick={(e) => e.stopPropagation()}/> 2. Apply Bulk Emails
                </Label>
                <div className={`grid gap-4 p-4 bg-muted/30 border rounded-md transition-opacity duration-200 ${!applyOptions.iterator ? 'opacity-40 pointer-events-none' : ''}`}>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center"><Label>Bulk Data</Label><Badge variant="secondary" className="font-mono">{recordCount} Records</Badge></div>
                        <Textarea className="min-h-[120px] font-mono bg-background" value={bulkData} onChange={e => setBulkData(e.target.value)} placeholder="admin@example.com&#10;sales@example.com" />
                    </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              
              {/* 3. STATIC FIELDS */}
              <div className="space-y-3">
                <Label className="text-primary font-bold text-base flex items-center border-b pb-1 gap-2 cursor-pointer" onClick={() => setApplyOptions({...applyOptions, staticFields: !applyOptions.staticFields})}>
                    <Checkbox checked={applyOptions.staticFields} onCheckedChange={(c) => setApplyOptions({...applyOptions, staticFields: !!c})} onClick={(e) => e.stopPropagation()} /> 3. Apply Static Payload Details
                </Label>
                
                <div className={`grid gap-4 p-4 bg-muted/30 border rounded-md max-h-[350px] overflow-y-auto transition-opacity duration-200 ${!applyOptions.staticFields ? 'opacity-40 pointer-events-none' : ''}`}>
                    <div className="grid gap-1.5"><Label className="text-sm font-semibold text-muted-foreground">Name</Label><Input value={staticData['name'] || ''} onChange={e => handleStaticChange('name', e.target.value)} className="bg-background" placeholder="e.g., John Doe" /></div>
                    <div className="grid gap-1.5"><Label className="text-sm font-semibold text-muted-foreground">Subject</Label><Input value={staticData['subject'] || ''} onChange={e => handleStaticChange('subject', e.target.value)} className="bg-background" placeholder="Email Subject" /></div>
                    <div className="grid gap-1.5"><Label className="text-sm font-semibold text-muted-foreground">Description / Body</Label><Textarea value={staticData['description'] || ''} onChange={e => handleStaticChange('description', e.target.value)} className="bg-background" rows={3} placeholder="Main email content..." /></div>
                </div>
              </div>

              {/* 4. SETTINGS & TRACKING */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Label className="text-primary font-bold text-base flex items-center border-b pb-1 gap-2 cursor-pointer" onClick={() => setApplyOptions({...applyOptions, tracking: !applyOptions.tracking})}>
                        <Checkbox checked={applyOptions.tracking} onCheckedChange={(c) => setApplyOptions({...applyOptions, tracking: !!c})} onClick={(e) => e.stopPropagation()} /> 4. Apply Tracking Options
                    </Label>
                    <Label className="text-primary font-bold text-base flex items-center border-b pb-1 gap-2 cursor-pointer" onClick={() => setApplyOptions({...applyOptions, execution: !applyOptions.execution})}>
                        <Checkbox checked={applyOptions.execution} onCheckedChange={(c) => setApplyOptions({...applyOptions, execution: !!c})} onClick={(e) => e.stopPropagation()} /> 5. Apply Execution Rules
                    </Label>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-muted/30 border rounded-md items-start">
                  
                  {/* Tracking Block */}
                  <div className={`p-4 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-900/30 rounded-lg space-y-4 transition-opacity duration-200 ${!applyOptions.tracking ? 'opacity-40 pointer-events-none' : ''}`}>
                      <div className="flex items-center space-x-2">
                          <Checkbox id="modalTracking" checked={trackingEnabled} onCheckedChange={(c) => setTrackingEnabled(!!c)} className="data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600" />
                          <Label htmlFor="modalTracking" className="font-medium cursor-pointer flex items-center gap-2 text-purple-900 dark:text-purple-300">
                              Enable Link Injection & Tracking
                          </Label>
                      </div>
                      {trackingEnabled && (
                          <div className="pl-6">
                              <Input placeholder="JSON Key for HTML Target (e.g. description)" value={targetHtmlField} onChange={(e) => setTargetHtmlField(e.target.value)} className="h-9 text-xs bg-background border-purple-200 dark:border-purple-800" />
                          </div>
                      )}
                      <div className="flex items-center space-x-2 pt-3 border-t border-purple-200/50 dark:border-purple-800/50 mt-2">
                          <Checkbox id="modal-appendAccountName" checked={appendAccountName} onCheckedChange={(c) => setAppendAccountName(!!c)} className="data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600" />
                          <Label htmlFor="modal-appendAccountName" className="font-medium cursor-pointer text-purple-900 dark:text-purple-300 text-sm">Append Account Index to Description</Label>
                      </div>
                  </div>

                  {/* Execution Block */}
                  <div className={`grid grid-cols-3 gap-3 transition-opacity duration-200 ${!applyOptions.execution ? 'opacity-40 pointer-events-none' : ''}`}>
                      <div><Label className="text-xs">Delay (s)</Label><Input type="number" value={delay} onChange={e => setDelay(Number(e.target.value))} className="mt-1 bg-background h-8 text-sm" min={0}/></div>
                      <div><Label className="text-xs">Concurrency</Label><Input type="number" value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} className="mt-1 bg-background h-8 text-sm" min={1} max={10}/></div>
                      <div><Label className="text-xs text-red-600/80 flex items-center"><AlertOctagon className="h-3 w-3 mr-1" /> Pause At</Label><Input type="number" value={stopAfterFailures || ''} onChange={e => setStopAfterFailures(Number(e.target.value))} className="mt-1 bg-background h-8 text-sm" min={0} placeholder="0 (Off)"/></div>
                  </div>

                </div>
              </div>

            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/10">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={isApplyDisabled} className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold px-8">
            <CopyCheck className="h-4 w-4 mr-2" /> Apply Flow Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};