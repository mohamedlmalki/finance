// --- FILE: src/components/dashboard/ExportButton.tsx (FIXED) ---

import React from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface ExportButtonProps {
  results: any[];
  filename: string;
}

const convertToCSV = (objArray: any[]) => {
  // --- FIX: Added safety check for non-array or empty array ---
  if (!Array.isArray(objArray) || objArray.length === 0) {
    return '';
  }

  const array = typeof objArray !== 'object' ? JSON.parse(objArray) : objArray;
  let str = '';
  let line = '';

  // Get headers
  const headers = Object.keys(array[0]);
  line = headers.map(header => `"${header.replace(/"/g, '""')}"`).join(',');
  str += line + '\r\n';

  // Add rows
  for (let i = 0; i < array.length; i++) {
    line = '';
    for (let index = 0; index < headers.length; index++) {
      if (line !== '') line += ',';
      
      let value = array[i][headers[index]];
      if (typeof value === 'object' && value !== null) {
        value = JSON.stringify(value).replace(/"/g, '""');
      }

      line += `"${value !== null && value !== undefined ? String(value).replace(/"/g, '""') : ''}"`;
    }
    str += line + '\r\n';
  }
  return str;
};

export const ExportButton: React.FC<ExportButtonProps> = ({ results, filename }) => {
  
  // --- FIX: Create a 'safeResults' variable ---
  // This ensures 'safeResults' is ALWAYS an array, even if 'results' is undefined.
  const safeResults = Array.isArray(results) ? results : [];

  const handleExport = () => {
    // Use safeResults instead of results
    const csvData = convertToCSV(safeResults);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Button 
      variant="outline" 
      size="sm" 
      onClick={handleExport} 
      // --- FIX: Use safeResults.length ---
      // This will now be [].length (which is 0) instead of undefined.length
      disabled={safeResults.length === 0}
    >
      <Download className="mr-2 h-4 w-4" />
      Export CSV
    </Button>
  );
};