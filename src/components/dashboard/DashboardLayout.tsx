import React, { useContext, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom'; 
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Ticket, UserPlus, Package, BarChart3, Activity, Receipt, Book, Users, Layers, Save, Download, Database, FileCode, Code, GripVertical, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProfileSelector } from './ProfileSelector';
import { Profile, InvoiceJobs, ExpenseJobs, CustomModuleJobs, ContactJobs, SaveLoadContext } from '@/App'; 
import { Socket } from 'socket.io-client';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type ApiStatus = { status: 'loading' | 'success' | 'error'; message: string; fullResponse?: any; };
type AllJobs = InvoiceJobs | ExpenseJobs | CustomModuleJobs | ContactJobs | any;

interface DashboardLayoutProps {
  children: React.ReactNode;
  stats?: { totalTickets: number; totalToProcess: number; isProcessing: boolean; };
  onAddProfile: () => void;
  profiles: Profile[];
  selectedProfile: Profile | null;
  jobs: AllJobs;
  onProfileChange: (string: string) => void;
  apiStatus: ApiStatus;
  onShowStatus: () => void;
  onManualVerify: () => void;
  socket: Socket | null;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
  service?: 'inventory' | 'books' | 'billing' | 'expense';
}

const SidebarNavLink = ({ to, children }: { to: string, children: React.ReactNode }) => (
  <NavLink to={to} className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all hover:text-primary", isActive ? "bg-muted text-primary" : "text-muted-foreground hover:bg-muted/50")}>
    {children}
  </NavLink>
);

const SidebarDivider = () => ( <div className="px-4 py-2"><div className="border-t border-muted/50" /></div> );

function SortableSection({ id, children, isFirst }: { id: string, children: React.ReactNode, isFirst: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div {...attributes} {...listeners} className="absolute -left-1 top-4 cursor-grab active:cursor-grabbing p-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground z-10"><GripVertical className="h-3 w-3" /></div>
      <div className="space-y-1">{!isFirst && <SidebarDivider />}{children}</div>
    </div>
  );
}

const DEFAULT_SECTIONS = [
  { id: 'inventory', content: (<><h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-2">Zoho Inventory</h4><SidebarNavLink to="/bulk-invoices"><Package className="h-4 w-4" />Bulk Invoices</SidebarNavLink><SidebarNavLink to="/custom-modules"><Database className="h-4 w-4" />Custom Modules</SidebarNavLink><SidebarNavLink to="/email-statics"><BarChart3 className="h-4 w-4" />Email Statistics</SidebarNavLink></>) },
  { id: 'books', content: (<><h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-2">Zoho Books</h4><SidebarNavLink to="/books-invoices"><Book className="h-4 w-4" />Bulk Invoices</SidebarNavLink><SidebarNavLink to="/books-contacts"><Users className="h-4 w-4" />Bulk Contacts</SidebarNavLink><SidebarNavLink to="/books-custom-modules"><Layers className="h-4 w-4" />Custom Modules</SidebarNavLink><SidebarNavLink to="/books-email-statics"><BarChart3 className="h-4 w-4" />Email Statistics</SidebarNavLink></>) },
  { id: 'billing', content: (<><h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-2">Zoho Billing</h4><SidebarNavLink to="/billing-contacts"><Users className="h-4 w-4" />Bulk Contacts</SidebarNavLink><SidebarNavLink to="/billing-custom-modules"><Layers className="h-4 w-4" />Custom Modules</SidebarNavLink></>) },
  { id: 'expense', content: (<><h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-2">Zoho Expense</h4><SidebarNavLink to="/expense"><Receipt className="h-4 w-4" />Custom Module</SidebarNavLink></>) },
  // 🚨 NEW FLOW / WEBHOOKS SECTION ADDED HERE
  { id: 'flow', content: (<><h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-2">Automation</h4><SidebarNavLink to="/flow-bulk"><Zap className="h-4 w-4 text-yellow-500 fill-yellow-500" />Flow / Webhooks</SidebarNavLink></>) }
];

const getSortedSections = (savedIds: string[]) => {
  if (!savedIds || savedIds.length === 0) return DEFAULT_SECTIONS;
  // Make sure new sections that aren't in the saved order get appended to the bottom automatically
  return [...DEFAULT_SECTIONS].sort((a, b) => { const aIndex = savedIds.indexOf(a.id); const bIndex = savedIds.indexOf(b.id); return (aIndex !== -1 ? aIndex : 999) - (bIndex !== -1 ? bIndex : 999); });
};

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children, stats, onAddProfile, profiles, selectedProfile, jobs, onProfileChange, apiStatus, onShowStatus, onManualVerify, socket, onEditProfile, onDeleteProfile, service
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { openSaveModal, openLoadModal } = useContext(SaveLoadContext);
  const isStatsPage = location.pathname === '/live-stats';

  const progressPercent = stats && stats.totalToProcess > 0 ? (stats.totalTickets / stats.totalToProcess) * 100 : 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [sections, setSections] = useState(() => {
    try { const cached = localStorage.getItem('zoho_finance_sidebar_order'); if (cached) return getSortedSections(JSON.parse(cached)); } catch (e) {}
    return DEFAULT_SECTIONS;
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSections((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id); const newIndex = items.findIndex(i => i.id === over.id);
        const newList = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem('zoho_finance_sidebar_order', JSON.stringify(newList.map(i => i.id)));
        return newList;
      });
    }
  };

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[250px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/20 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6 shrink-0 bg-background">
            <NavLink to="/" className="flex items-center gap-2 font-semibold">
              <Ticket className="h-5 w-5 text-primary" />
              <span>Zoho Bulk Tools</span>
            </NavLink>
          </div>

          <div className="flex-1 overflow-auto py-4">
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4 space-y-0">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  {sections.map((section, index) => (
                    <SortableSection key={section.id} id={section.id} isFirst={index === 0}>
                      {section.content}
                    </SortableSection>
                  ))}
                </SortableContext>
              </DndContext>
            </nav>
          </div>
          
          <div className="mt-auto p-4 border-t space-y-2 shrink-0 bg-background/50">
            <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="w-full border-blue-200 text-blue-700 hover:bg-blue-50" onClick={openSaveModal}><Save className="h-4 w-4 mr-2" /> Save</Button>
                <Button size="sm" variant="outline" className="w-full border-green-200 text-green-700 hover:bg-green-50" onClick={openLoadModal}><Download className="h-4 w-4 mr-2" /> Load</Button>
            </div>
            <Button size="sm" className="w-full" onClick={onAddProfile}><UserPlus className="h-4 w-4 mr-2" />Add Account</Button>
          </div>
        </div>
      </div>
      
      <div className="flex flex-col">
        {/* --- Top Navbar contains the Profile Selector --- */}
        <header className="flex h-14 items-center gap-4 border-b bg-card px-4 lg:h-[60px] lg:px-6 sticky top-0 z-30 justify-between">
          
          <div className="flex items-center gap-4">
            <a href="https://kangax.github.io/html-minifier/" target="_blank" rel="noopener noreferrer" className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"><FileCode className="h-3 w-3" /> Minify HTML</a>
            <a href="https://www.base64encode.org/" target="_blank" rel="noopener noreferrer" className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"><Code className="h-3 w-3" /> Base64</a>
          </div>
          
          {/* Centered Profile Selector */}
          {!isStatsPage && (
            <div className="flex-1 flex justify-center items-center">
                <ProfileSelector 
                    profiles={profiles} 
                    selectedProfile={selectedProfile} 
                    onProfileChange={onProfileChange}
                    apiStatus={apiStatus}
                    onShowStatus={onShowStatus}
                    onManualVerify={onManualVerify}
                    socket={socket}
                    onEditProfile={onEditProfile}
                    onDeleteProfile={onDeleteProfile}
                    service={service}
                    jobs={jobs} 
                    onAddProfile={onAddProfile} 
                />
            </div>
          )}

          <Button variant={isStatsPage ? "default" : "outline"} size="sm" className="hidden md:flex items-center gap-2" onClick={() => navigate('/live-stats')}>
            <Activity className="h-4 w-4" /> Live Statistics
          </Button>

          {stats && stats.isProcessing && stats.totalToProcess > 0 && (
            <div className="absolute bottom-0 left-0 w-full"><Progress value={progressPercent} className="h-[2px] w-full rounded-none bg-muted/50" /></div>
          )}
        </header>
        
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 overflow-x-hidden bg-muted/10">
          {children}
        </main>
      </div>
    </div>
  );
};