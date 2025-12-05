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
  // Token metrics
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  context_cleared_tokens: number | null;
  context_cleared_tool_uses: number | null;
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

function formatTokens(tokens: number | null): string {
  if (tokens === null || tokens === 0) return '-';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
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
    <div className="bg-muted/30 rounded-md overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]">Iteration</TableHead>
            <TableHead>API Time</TableHead>
            <TableHead>Tool Time</TableHead>
            <TableHead>In Tokens</TableHead>
            <TableHead>Out Tokens</TableHead>
            <TableHead>Cache Read</TableHead>
            <TableHead>Cache Write</TableHead>
            <TableHead>Cleared</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {iterations.map((iteration) => (
            <TableRow key={iteration.id}>
              <TableCell className="font-mono">#{iteration.iteration}</TableCell>
              <TableCell>{formatMs(iteration.api_response_time_ms)}</TableCell>
              <TableCell>{formatMs(iteration.tool_execution_time_ms)}</TableCell>
              <TableCell className="font-mono text-blue-600">{formatTokens(iteration.input_tokens)}</TableCell>
              <TableCell className="font-mono text-green-600">{formatTokens(iteration.output_tokens)}</TableCell>
              <TableCell className="font-mono text-purple-600">{formatTokens(iteration.cache_read_input_tokens)}</TableCell>
              <TableCell className="font-mono text-orange-600">{formatTokens(iteration.cache_creation_input_tokens)}</TableCell>
              <TableCell className="font-mono text-red-600">
                {iteration.context_cleared_tokens ? `${formatTokens(iteration.context_cleared_tokens)} / ${iteration.context_cleared_tool_uses || 0}` : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
