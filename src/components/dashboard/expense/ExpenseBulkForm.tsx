import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge'; 
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Play, Pause, Square, ShieldCheck, AlertOctagon, RotateCcw, AlertCircle } from 'lucide-react'; 
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export interface ExpenseField {
    label: string;
    api_name: string;
    data_type: string;
    is_mandatory: boolean;
    is_system: boolean;
    is_read_only: boolean;
}

const humanizeLabel = (text: string) => {
    if (!text) return "";
    return text.replace(/^cf_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).trim();
};

const formatLabel = (field: ExpenseField) => {
    let displayLabel = field.label;
    if (!displayLabel || displayLabel === field.api_name || displayLabel.includes('_')) {
        displayLabel = humanizeLabel(field.api_name);
    }
    return <span>{displayLabel}</span>;
};

const DynamicExpenseField = ({ field, value, onChange, disabled }: { field: ExpenseField, value: any, onChange: (val: any) => void, disabled: boolean }) => {
    const id = `field-${field.api_name}`;
    const dataType = field.data_type?.toLowerCase() || 'text';

    if (dataType === 'boolean') {
        return (
            <div className="flex items-center space-x-2 pt-4">
                <Switch id={id} checked={value === true} onCheckedChange={onChange} disabled={disabled} />
                <Label htmlFor={id} className="flex items-center cursor-pointer">{formatLabel(field)}</Label>
            </div>
        );
    }

    if (dataType === 'textarea' || dataType === 'multiline') {
        return (
            <div className="space-y-2">
                <Label htmlFor={id} className="flex items-center">
                    {formatLabel(field)} {field.is_mandatory && <span className="text-destructive ml-1">*</span>}
                </Label>
                <Textarea id={id} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={`Enter ${humanizeLabel(field.api_name)}...`} className="min-h-[100px]" />
            </div>
        );
    }

    let inputType = 'text';
    if (['integer', 'double', 'amount', 'currency', 'decimal', 'percent'].includes(dataType)) inputType = 'number';
    else if (dataType === 'email') inputType = 'email';
    else if (dataType === 'date') inputType = 'date';

    return (
        <div className="space-y-2">
            <Label htmlFor={id} className="flex items-center">
                {formatLabel(field)} {field.is_mandatory && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input id={id} type={inputType} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={humanizeLabel(field.api_name)} />
        </div>
    );
};

interface ExpenseBulkFormProps {
    moduleName: string;
    setModuleName: (val: string) => void;
    fields: ExpenseField[];
    isLoadingFields: boolean;
    onFetchFields: () => void;
    bulkPrimaryField: string;
    setBulkPrimaryField: (val: string) => void;
    bulkValues: string;
    setBulkValues: (val: string) => void;
    
    // --- ADDED MISSING PROPS ---
    bulkDelay: number;
    setBulkDelay: (val: number) => void;
    concurrency: number;
    setConcurrency: (val: number) => void;
    stopAfterFailures: number;
    setStopAfterFailures: (val: number) => void;
    
    defaultData: Record<string, any>;
    onDefaultDataChange: (field: string, value: any) => void;
    onStart: () => void;
    onPause: () => void;
    onResume: () => void;
    onEnd: () => void;
    isProcessing: boolean;
    isPaused: boolean;
    verifyLog: boolean;
    setVerifyLog: (val: boolean) => void;
    
    onRetryFailed: () => void;
    failedCount: number;
}

export const ExpenseBulkForm: React.FC<ExpenseBulkFormProps> = (props) => {
    // FIX: Safely access fields
    const fields = props.fields || [];
    const safeBulkValues = props.bulkValues || '';
    const primaryCount = safeBulkValues.split('\n').filter(l => l.trim()).length;
    const secondaryFields = fields.filter(f => f.api_name !== props.bulkPrimaryField && !f.is_read_only && !f.is_system);

    return (
        <div className="space-y-6">
            
            {!props.moduleName && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Configuration Missing</AlertTitle>
                    <AlertDescription>
                        Please set the <strong>Expense Module API Name</strong> in the account settings to load this form.
                    </AlertDescription>
                </Alert>
            )}

            {props.moduleName && fields.length === 0 && (
                <div className="flex flex-col items-center justify-center p-8 border rounded-lg border-dashed bg-muted/20 text-muted-foreground">
                    <p>Loading fields for <strong>{props.moduleName}</strong>...</p>
                    <Button variant="link" onClick={props.onFetchFields} className="mt-2">Retry Fetch</Button>
                </div>
            )}

            {fields.length > 0 && (
                <Tabs defaultValue="bulk" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="single" disabled={props.isProcessing}>Single Record</TabsTrigger>
                        <TabsTrigger value="bulk" disabled={props.isProcessing}>Bulk Import</TabsTrigger>
                    </TabsList>

                    <TabsContent value="bulk">
                        <Card>
                            <CardHeader>
                                <CardTitle>Bulk Configuration</CardTitle>
                                <CardDescription>
                                    Target Module: <Badge variant="outline" className="ml-2 font-mono">{props.moduleName}</Badge>
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Primary Field (Unique per row)</Label>
                                        <Select value={props.bulkPrimaryField} onValueChange={props.setBulkPrimaryField} disabled={props.isProcessing}>
                                            <SelectTrigger><SelectValue placeholder="Select field..." /></SelectTrigger>
                                            <SelectContent>
                                                {fields.filter(f => !f.is_read_only).map(f => (
                                                    <SelectItem key={f.api_name} value={f.api_name}>{formatLabel(f)}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <Label>Values (One per line)</Label>
                                            <Badge variant="secondary">{primaryCount} records</Badge>
                                        </div>
                                        <Textarea 
                                            value={safeBulkValues} 
                                            onChange={e => props.setBulkValues(e.target.value)} 
                                            className="h-[200px] font-mono" 
                                            placeholder="Item 1&#10;Item 2" 
                                            disabled={props.isProcessing} 
                                        />
                                    </div>
                                    
                                    {/* --- CONFIGURATION GRID --- */}
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                            <Label>Delay (Sec)</Label>
                                            <Input type="number" value={props.bulkDelay} onChange={e => props.setBulkDelay(Number(e.target.value))} disabled={props.isProcessing} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Concurrency</Label>
                                            <Input 
                                                type="number" 
                                                value={props.concurrency} 
                                                onChange={e => props.setConcurrency(Number(e.target.value))} 
                                                disabled={props.isProcessing} 
                                                min={1} max={10} 
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="flex items-center" title="Stop job after X failures">
                                                <AlertOctagon className="h-3 w-3 mr-1 text-red-500" /> Auto-Pause
                                            </Label>
                                            <Input 
                                                type="number" 
                                                value={props.stopAfterFailures} 
                                                onChange={e => props.setStopAfterFailures(Number(e.target.value))} 
                                                disabled={props.isProcessing} 
                                                placeholder="0 (Disabled)"
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center space-x-2 pt-2">
                                        <Switch id="verify" checked={props.verifyLog} onCheckedChange={props.setVerifyLog} disabled={props.isProcessing} />
                                        <Label htmlFor="verify" className="flex items-center cursor-pointer">
                                            <ShieldCheck className="h-4 w-4 mr-1 text-green-600" />
                                            Verify Automation Log
                                        </Label>
                                    </div>
                                </div>

                                <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                                    <Label className="font-semibold text-lg">Default Values</Label>
                                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                                        {secondaryFields.map(f => (
                                            <DynamicExpenseField key={f.api_name} field={f} value={props.defaultData[f.api_name]} onChange={(v) => props.onDefaultDataChange(f.api_name, v)} disabled={props.isProcessing} />
                                        ))}
                                    </div>
                                </div>
                            </CardContent>

                            <CardFooter className="flex flex-col gap-3">
                                {!props.isProcessing ? (
                                    <div className="flex gap-2 w-full">
                                        <Button className="flex-1" onClick={props.onStart} disabled={!props.bulkPrimaryField || !safeBulkValues}>
                                            <Send className="mr-2 h-4 w-4" /> Start Bulk Creation
                                        </Button>
                                        
                                        {props.failedCount > 0 && (
                                            <Button 
                                                variant="secondary" 
                                                className="border-red-200 hover:bg-red-50 text-red-700"
                                                onClick={props.onRetryFailed}
                                            >
                                                <RotateCcw className="mr-2 h-4 w-4" /> 
                                                Retry Failed ({props.failedCount})
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex gap-4 w-full justify-center">
                                        <Button variant="outline" onClick={props.isPaused ? props.onResume : props.onPause}>{props.isPaused ? <><Play className="mr-2 h-4 w-4"/> Resume</> : <><Pause className="mr-2 h-4 w-4"/> Pause</>}</Button>
                                        <Button variant="destructive" onClick={props.onEnd}><Square className="mr-2 h-4 w-4"/> End Job</Button>
                                    </div>
                                )}
                            </CardFooter>
                        </Card>
                    </TabsContent>
                    
                    <TabsContent value="single">
                        <div className="p-4 text-center text-muted-foreground border rounded-md">Single record creation logic can be placed here.</div>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
};