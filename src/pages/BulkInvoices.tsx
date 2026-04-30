import React from 'react';
import { Socket } from "socket.io-client";
import { Profile, InvoiceJobs, InvoiceJobState } from "@/App";
import { InvoiceDashboard } from "@/components/dashboard/inventory/InvoiceDashboard"; 

interface BulkInvoicesProps {
  jobs: InvoiceJobs;
  setJobs: React.Dispatch<React.SetStateAction<InvoiceJobs>>;
  socket: Socket | null;
  createInitialJobState: () => InvoiceJobState;
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
}

const BulkInvoices = (props: BulkInvoicesProps) => {
  return (
    <InvoiceDashboard 
      {...props} 
      service="inventory" // <-- ADD THIS LINE
    /> 
  );
};

export default BulkInvoices;