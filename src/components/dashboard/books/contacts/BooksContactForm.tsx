import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Send, Mail, Users, Clock, Edit, RefreshCw, Pause, Play, Square, CheckCircle2, XCircle, ImagePlus, Eye, RotateCcw, AlertOctagon, UserPlus } from 'lucide-react';
import { ContactFormData, ContactJobState } from '@/App';
import { formatTime } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface BooksContactFormProps {
  onSubmit: () => void;
  isProcessing: boolean;
  isPaused: boolean;
  onPauseResume: () => void;
  onEndJob: () => void;
  formData: ContactFormData;
  onFormDataChange: (data: ContactFormData) => void;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  onUpdateName: () => void;
  isLoadingName: boolean;
  onRefreshName: () => void;
  jobState: ContactJobState | null;
  failedCount?: number;
  onRetryFailed?: () => void;
}

const ImageToolDialog = ({ onApply }: { onApply: (html: string) => void }) => {
    const [imageUrl, setImageUrl] = useState('');
    const [altText, setAltText] = useState('');
    const [linkUrl, setLinkUrl] = useState('');
    const [width, setWidth] = useState('80');
    const [maxWidth, setMaxWidth] = useState('500');
    const [alignment, setAlignment] = useState('center');
    const [isOpen, setIsOpen] = useState(false);

    const handleApply = () => {
        let style = `width: ${width}%; max-width: ${maxWidth}px; height: auto; border: 1px solid #dddddd; margin-top: 10px; margin-bottom: 10px;`;
        let imgTag = `<img src="${imageUrl}" alt="${altText}" style="${style}" />`;
        if (linkUrl) imgTag = `<a href="${linkUrl}">${imgTag}</a>`;
        const containerStyle = `text-align: ${alignment};`;
        onApply(`<div style="${containerStyle}">${imgTag}</div>`);
        setIsOpen(false); 
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-7 px-2 text-xs"><ImagePlus className="h-3 w-3 mr-1" />Add Image</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader><DialogTitle>Add and Style Image</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4"><Label className="text-right">Image URL</Label><Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="col-span-3" /></div>
                    <div className="grid grid-cols-4 items-center gap-4"><Label className="text-right">Alt Text</Label><Input value={altText} onChange={(e) => setAltText(e.target.value)} className="col-span-3" /></div>
                    <div className="grid grid-cols-4 items-center gap-4"><Label className="text-right">Link URL</Label><Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="col-span-3" /></div>
                    <div className="grid grid-cols-4 items-center gap-4"><Label className="text-right">Width (%)</Label><Input value={width} onChange={(e) => setWidth(e.target.value)} className="col-span-3" /></div>
                    <div className="grid grid-cols-4 items-center gap-4"><Label className="text-right">Max Width (px)</Label><Input value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} className="col-span-3" /></div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Alignment</Label>
                        <Select value={alignment} onValueChange={setAlignment}>
                            <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="left">Left</SelectItem><SelectItem value="center">Center</SelectItem><SelectItem value="right">Right</SelectItem></SelectContent>
                        </Select>
                    </div>
                </div>
                <Button onClick={handleApply} disabled={!imageUrl}>Apply</Button>
            </DialogContent>
        </Dialog>
    );
};

export const BooksContactForm: React.FC<BooksContactFormProps> = ({ 
  onSubmit, isProcessing, isPaused, onPauseResume, onEndJob, formData, onFormDataChange, 
  displayName, onDisplayNameChange, onUpdateName, isLoadingName, onRefreshName, jobState, 
  failedCount = 0, onRetryFailed
}) => {
  const emailCount = formData.emails.split('\n').filter(email => email.trim() !== '').length;
  const successCount = jobState?.results.filter(r => r.success).length || 0;
  const errorCount = jobState?.results.filter(r => r.success === false).length || 0;

  const handleInputChange = (field: keyof ContactFormData, value: any) => {
    onFormDataChange({ ...formData, [field]: value });
  };

  const handleApplyImage = (html: string) => {
    onFormDataChange({ ...formData, body: formData.body + '\n' + html });
  };

  return (
    <Card className="shadow-medium hover:shadow-large transition-all duration-300 border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <UserPlus className="h-5 w-5 text-blue-600" />
          <CardTitle className="text-lg">Books: Bulk Create Contacts</CardTitle>
        </div>
        <CardDescription>Create contacts in bulk and optionally send them a welcome email.</CardDescription>
      </CardHeader>
      
      <CardContent>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* LEFT COLUMN */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="emails" className="flex items-center space-x-2"><Mail className="h-4 w-4" /><span>Target Emails</span></Label>
                  <Badge variant="secondary" className="text-xs"><Users className="h-3 w-3 mr-1" />{emailCount} contacts</Badge>
                </div>
                <Textarea
                  id="emails"
                  placeholder="user1@example.com&#10;user2@example.com"
                  value={formData.emails}
                  onChange={(e) => handleInputChange('emails', e.target.value)}
                  className="min-h-[200px] font-mono text-sm bg-muted/30"
                  disabled={isProcessing}
                />
                <p className="text-xs text-muted-foreground">One email per line. Name will be extracted from email prefix.</p>

                {jobState && (jobState.isProcessing || jobState.results.length > 0) && (
                    <div className="pt-4 border-t border-dashed">
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div><Label className="text-xs text-muted-foreground">Time</Label><p className="text-lg font-bold font-mono">{formatTime(jobState.processingTime)}</p></div>
                            <div><Label className="text-xs text-muted-foreground">Success</Label><p className="text-lg font-bold font-mono text-green-600">{successCount}</p></div>
                            <div><Label className="text-xs text-muted-foreground">Failed</Label><p className="text-lg font-bold font-mono text-destructive">{errorCount}</p></div>
                        </div>
                    </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="space-y-4">
               {/* SENDER NAME (Optional for context) */}
               <div className="space-y-2">
                <Label className="flex items-center space-x-2"><Edit className="h-4 w-4" /><span>Organization Name (Sender)</span></Label>
                <div className="flex items-center space-x-2">
                    <Input value={displayName} onChange={(e) => onDisplayNameChange(e.target.value)} placeholder="Loading..." disabled={isLoadingName} />
                    <Button type="button" size="sm" onClick={onUpdateName} disabled={isLoadingName}>Update</Button>
                    <Button type="button" size="icon" variant="ghost" onClick={onRefreshName}><RefreshCw className={`h-4 w-4 ${isLoadingName ? 'animate-spin' : ''}`} /></Button>
                </div>
              </div>

              {/* EMAIL TOGGLE */}
              <div className="p-4 bg-muted/30 border rounded-lg space-y-4">
                  <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="sendEmail" 
                        checked={formData.sendEmail} 
                        onCheckedChange={(c) => handleInputChange('sendEmail', !!c)} 
                        disabled={isProcessing}
                      />
                      <Label htmlFor="sendEmail" className="font-medium cursor-pointer">Send Welcome Email?</Label>
                  </div>

                  {formData.sendEmail && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                          <div className="space-y-2">
                            <Label>Subject</Label>
                            <Input value={formData.subject} onChange={(e) => handleInputChange('subject', e.target.value)} placeholder="Welcome to our service..." disabled={isProcessing} />
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label>Body</Label>
                                <div className="flex gap-2">
                                    <ImageToolDialog onApply={handleApplyImage} />
                                    <Dialog>
                                        <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-7 text-xs"><Eye className="h-3 w-3 mr-1"/>Preview</Button></DialogTrigger>
                                        <DialogContent className="max-w-2xl"><div className="p-4 border rounded max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{__html: formData.body}}/></DialogContent>
                                    </Dialog>
                                </div>
                            </div>
                            <Textarea value={formData.body} onChange={(e) => handleInputChange('body', e.target.value)} className="min-h-[100px]" placeholder="HTML supported..." disabled={isProcessing} />
                          </div>
                      </div>
                  )}
              </div>

              {/* SETTINGS */}
              <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                        <Label className="flex items-center gap-2"><Clock className="h-4 w-4"/>Delay (s)</Label>
                        <Input type="number" min="0" value={formData.delay} onChange={(e) => handleInputChange('delay', parseInt(e.target.value))} disabled={isProcessing}/>
                   </div>
                   <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-red-600"><AlertOctagon className="h-4 w-4"/>Auto-Pause</Label>
                        <Input type="number" min="0" placeholder="0 (Off)" value={formData.stopAfterFailures} onChange={(e) => handleInputChange('stopAfterFailures', parseInt(e.target.value))} disabled={isProcessing}/>
                   </div>
               </div>
            </div>
          </div>

          <div className="pt-4 border-t">
              {!isProcessing ? (
                <div className="flex gap-4">
                    <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" size="lg" disabled={formData.sendEmail && (!formData.subject || !formData.body)}>
                        <UserPlus className="h-4 w-4 mr-2" /> 
                        {formData.sendEmail ? `Create & Email ${emailCount} Contacts` : `Create ${emailCount} Contacts`}
                    </Button>
                    {failedCount > 0 && onRetryFailed && (
                        <Button type="button" variant="secondary" size="lg" onClick={onRetryFailed}><RotateCcw className="h-4 w-4 mr-2" />Retry ({failedCount})</Button>
                    )}
                </div>
              ) : (
                <div className="flex gap-4">
                    <Button type="button" variant="secondary" size="lg" onClick={onPauseResume} className="flex-1">{isPaused ? <><Play className="mr-2 h-4 w-4"/>Resume</> : <><Pause className="mr-2 h-4 w-4"/>Pause</>}</Button>
                    <Button type="button" variant="destructive" size="lg" onClick={onEndJob} className="flex-1"><Square className="mr-2 h-4 w-4"/>End Job</Button>
                </div>
              )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};