'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Iteration {
  id: string;
  iteration: number;
  api_response_time_ms: number | null;
  tool_execution_time_ms: number | null;
  iteration_total_time_ms: number | null;
  created_at: string;
}

interface IterationsTableProps {
  iterations: Iteration[];
  loading?: boolean;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString();
}

export function IterationsTable({ iterations, loading }: IterationsTableProps) {
  if (loading) {
    return <div className="text-sm text-muted-foreground p-4">Loading iterations...</div>;
  }

  if (iterations.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">No iteration data available</div>;
  }

  return (
    <div className="bg-muted/30 rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">Iteration</TableHead>
            <TableHead>API Time</TableHead>
            <TableHead>Tool Time</TableHead>
            <TableHead>Total Time</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {iterations.map((iteration) => (
            <TableRow key={iteration.id}>
              <TableCell className="font-mono">#{iteration.iteration}</TableCell>
              <TableCell>{formatMs(iteration.api_response_time_ms)}</TableCell>
              <TableCell>{formatMs(iteration.tool_execution_time_ms)}</TableCell>
              <TableCell className="font-medium">{formatMs(iteration.iteration_total_time_ms)}</TableCell>
              <TableCell className="text-muted-foreground">{formatTime(iteration.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
