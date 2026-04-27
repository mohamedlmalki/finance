// --- FILE: src/pages/Index.tsx ---

import React from 'react';
import BulkInvoices from './BulkInvoices';
import { InvoiceJobs, InvoiceJobState, Profile } from '@/App';
import { Socket } from 'socket.io-client';

// Pass-through props to match what BulkInvoices expects
interface IndexProps {
  jobs: InvoiceJobs;
  setJobs: React.Dispatch<React.SetStateAction<InvoiceJobs>>;
  socket: Socket | null;
  createInitialJobState: () => InvoiceJobState;
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
}

const Index = (props: IndexProps) => {
  // Acts as a redirection wrapper to the main Inventory module
  return (
    <BulkInvoices 
      {...props}
    />
  );
};

export default Index;