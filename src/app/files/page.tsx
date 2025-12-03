'use client';

import * as React from 'react';
import { FileDown } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { MetricCard } from '@/components/dashboard/MetricCard';
import { FilesFilter } from '@/components/files/FilesFilter';
import { FilesTable } from '@/components/files/FilesTable';

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

interface FilesResponse {
  files: DownloadedFile[];
  total: number;
  filters: {
    practices: string[];
    bankAccounts: string[];
  };
}

function formatTotalSize(files: DownloadedFile[]): string {
  const totalBytes = files.reduce((acc, f) => acc + (f.file_size || 0), 0);
  if (totalBytes === 0) return '0 B';
  if (totalBytes < 1024) return `${totalBytes} B`;
  if (totalBytes < 1024 * 1024) return `${(totalBytes / 1024).toFixed(1)} KB`;
  return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPage() {
  const [files, setFiles] = React.useState<DownloadedFile[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [practices, setPractices] = React.useState<string[]>([]);
  const [bankAccounts, setBankAccounts] = React.useState<string[]>([]);

  // Filters
  const [practice, setPractice] = React.useState('');
  const [bankAccount, setBankAccount] = React.useState('');
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);

  const fetchFiles = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (practice && practice !== '__all__') {
        params.set('practice', practice);
      }
      if (bankAccount && bankAccount !== '__all__') {
        params.set('bankAccount', bankAccount);
      }
      if (dateRange?.from) {
        params.set('startDate', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        params.set('endDate', dateRange.to.toISOString());
      }

      const response = await fetch(`/api/files?${params.toString()}`);
      const data: FilesResponse = await response.json();

      setFiles(data.files || []);
      setTotal(data.total || 0);
      setPractices(data.filters?.practices || []);
      setBankAccounts(data.filters?.bankAccounts || []);
    } catch (error) {
      console.error('Failed to fetch files:', error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [practice, bankAccount, dateRange]);

  React.useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleClearFilters = () => {
    setPractice('');
    setBankAccount('');
    setDateRange(undefined);
  };

  // Count unique practices and bank accounts in current results
  const uniquePracticesInResults = new Set(files.map(f => f.practice_protect_name)).size;
  const uniqueBankAccountsInResults = new Set(files.map(f => f.bank_account_name)).size;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Downloaded Files</h1>
          <p className="text-muted-foreground">
            Search and download files by practice, bank account, or date
          </p>
        </div>

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Files"
            value={total}
            description={`${files.length} shown`}
            icon={<FileDown className="h-4 w-4" />}
          />
          <MetricCard
            title="Total Size"
            value={formatTotalSize(files)}
            description="Current selection"
          />
          <MetricCard
            title="Practices"
            value={uniquePracticesInResults}
            description={`of ${practices.length} total`}
          />
          <MetricCard
            title="Bank Accounts"
            value={uniqueBankAccountsInResults}
            description={`of ${bankAccounts.length} total`}
          />
        </div>

        {/* Filters */}
        <FilesFilter
          practice={practice}
          bankAccount={bankAccount}
          dateRange={dateRange}
          practices={practices}
          bankAccounts={bankAccounts}
          onPracticeChange={setPractice}
          onBankAccountChange={setBankAccount}
          onDateRangeChange={setDateRange}
          onClearFilters={handleClearFilters}
        />

        {/* Files Table */}
        <FilesTable
          files={files}
          loading={loading}
          onRefresh={fetchFiles}
        />
      </div>
    </div>
  );
}
