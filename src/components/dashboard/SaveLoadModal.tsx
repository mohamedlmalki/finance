import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Save, Download, FileJson, Trash2, X } from 'lucide-react';
import { formatTime } from '@/lib/utils'; // Assuming this exists, or use generic date format

interface SaveLoadModalProps {
    isOpen: boolean;
    onClose: () => void;
    mode: 'save' | 'load';
    onSave: (filename: string) => Promise<void>;
    onLoad: (filename: string) => Promise<void>;
}

const SERVER_URL = "http://localhost:3009";

export const SaveLoadModal: React.FC<SaveLoadModalProps> = ({ isOpen, onClose, mode, onSave, onLoad }) => {
    const [filename, setFilename] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [saveFiles, setSaveFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            setFilename(`progress_${new Date().toISOString().split('T')[0]}`);
            setSelectedFile(null);
            setIsLoading(false);
            if (mode === 'load') fetchSaves();
        }
    }, [isOpen, mode]);

    const fetchSaves = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${SERVER_URL}/api/list-saves`);
            const data = await res.json();
            if (data.success) setSaveFiles(data.files || []);
        } catch (e) {
            console.error("Failed to list saves", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAction = async () => {
        setIsLoading(true);
        try {
            if (mode === 'save') {
                if (!filename) return;
                await onSave(filename);
            } else {
                if (!selectedFile) return;
                await onLoad(selectedFile);
            }
            onClose();
        } catch (error) {
            console.error("Action failed", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{mode === 'save' ? 'Save Progress' : 'Load Progress'}</DialogTitle>
                    <DialogDescription>
                        {mode === 'save' 
                            ? "Save the current state of all jobs, counters, and forms to a file." 
                            : "Select a previously saved file to restore the application state."}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {mode === 'save' ? (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Filename</Label>
                                <div className="flex items-center gap-2">
                                    <Input 
                                        value={filename} 
                                        onChange={(e) => setFilename(e.target.value)} 
                                        placeholder="e.g. backup_2023"
                                    />
                                    <span className="text-sm text-muted-foreground">.json</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label>Available Saves</Label>
                            <ScrollArea className="h-[200px] border rounded-md p-2 bg-muted/20">
                                {isLoading && saveFiles.length === 0 ? (
                                    <div className="flex justify-center p-4"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
                                ) : saveFiles.length === 0 ? (
                                    <div className="text-center p-4 text-sm text-muted-foreground">No save files found.</div>
                                ) : (
                                    <div className="space-y-1">
                                        {saveFiles.map((file) => (
                                            <div 
                                                key={file} 
                                                className={`flex items-center justify-between p-2 rounded cursor-pointer text-sm transition-colors ${selectedFile === file ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                                                onClick={() => setSelectedFile(file)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <FileJson className="h-4 w-4" />
                                                    <span>{file.replace('.json', '')}</span>
                                                </div>
                                                {selectedFile === file && <CheckIcon />}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
                    <Button onClick={handleAction} disabled={isLoading || (mode === 'load' && !selectedFile) || (mode === 'save' && !filename)}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {mode === 'save' ? 'Save' : 'Load'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><polyline points="20 6 9 17 4 12"/></svg>
)