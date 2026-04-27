import React from 'react';
import { Socket } from "socket.io-client";
import { Profile, ContactJobs, ContactJobState } from "@/App";
import { BooksContactDashboard } from "@/components/dashboard/books/contacts/BooksContactDashboard";

interface BooksContactsProps {
  jobs: ContactJobs;
  setJobs: React.Dispatch<React.SetStateAction<ContactJobs>>;
  socket: Socket | null;
  createInitialJobState: () => ContactJobState;
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileName: string) => void;
}

const BooksContacts = (props: BooksContactsProps) => {
  return (
    <BooksContactDashboard 
      {...props} 
    /> 
  );
};

export default BooksContacts;