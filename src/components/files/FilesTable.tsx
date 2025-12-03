'use client';

import * as React from 'react';
import { Download, RefreshCw, FileText } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface DownloadedFile {
  id: string;
  filename: string;
  supabase_path: string;
  file_size: number | null;
  content_type: string | null;
  file_type: string;
  practice_protect_name: string;
  bank_account_name: string;
  quickbooks_company_name: string;
  quickbooks_bank_account_name: string;
  downloaded_at: string;
}

interface FilesTableProps {
  files: DownloadedFile[];
  loading?: boolean;
  onRefresh?: () => void;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString();
}

function getFileTypeBadgeVariant(type: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (type) {
    case 'bank_statement':
      return 'default';
    case 'invoice':
      return 'secondary';
    case 'receipt':
      return 'outline';
    default:
      return 'outline';
  }
}

export function FilesTable({ files, loading, onRefresh }: FilesTableProps) {
  const [downloading, setDownloading] = React.useState<Set<string>>(new Set());

  const handleDownload = async (file: DownloadedFile) => {
    setDownloading(prev => new Set(prev).add(file.id));

    try {
      const response = await fetch(`/api/files/${file.id}/download`);
      const data = await response.json();

      if (data.downloadUrl) {
        // Create a temporary link and click it to trigger download
        const link = document.createElement('a');
        link.href = data.downloadUrl;
        link.download = file.filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        console.error('Failed to get download URL:', data.error);
        alert('Failed to download file. Please try again.');
      }
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download file. Please try again.');
    } finally {
      setDownloading(prev => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        Loading files...
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-medium">Downloaded Files</h3>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Filename</TableHead>
            <TableHead>Practice</TableHead>
            <TableHead>Bank Account</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Downloaded</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                <div className="flex flex-col items-center py-8">
                  <FileText className="h-12 w-12 mb-4 text-muted-foreground/50" />
                  <p>No files found</p>
                  <p className="text-sm">Try adjusting your filters</p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            files.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="font-medium max-w-[200px] truncate" title={file.filename}>
                  {file.filename}
                </TableCell>
                <TableCell>{file.practice_protect_name}</TableCell>
                <TableCell>{file.bank_account_name}</TableCell>
                <TableCell>
                  <Badge variant={getFileTypeBadgeVariant(file.file_type)}>
                    {file.file_type.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {formatFileSize(file.file_size)}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(file.downloaded_at)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(file)}
                    disabled={downloading.has(file.id)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
