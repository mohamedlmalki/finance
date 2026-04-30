import React from 'react';
import { Socket } from "socket.io-client";
import { Profile, InvoiceJobs, InvoiceJobState } from "@/App";
import { BooksInvoiceDashboard } from "@/components/dashboard/books/BooksInvoiceDashboard"; // Import from new folder

interface BooksInvoicesProps {
  jobs: InvoiceJobs;
  setJobs: React.Dispatch<React.SetStateAction<InvoiceJobs>>;
  socket: Socket | null;
  createInitialJobState: () => InvoiceJobState;
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
}

const BooksInvoices = (props: BooksInvoicesProps) => {
  return (
    <BooksInvoiceDashboard 
      {...props} 
    /> 
  );
};

export default BooksInvoices;