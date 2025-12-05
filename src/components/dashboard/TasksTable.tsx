'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IterationsTable } from './IterationsTable';

interface Task {
  id: string;
  session_id: string;
  status: string;
  user_message: string;
  result_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  current_iteration: number | null;
  max_iterations: number | null;
  agent_status: string | null;
  duration_ms: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
}

interface Iteration {
  id: string;
  iteration: number;
  api_response_time_ms: number | null;
  tool_execution_time_ms: number | null;
  iteration_total_time_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  context_cleared_tokens: number | null;
  context_cleared_tool_uses: number | null;
  created_at: string;
}

interface TasksTableProps {
  tasks: Task[];
  loading?: boolean;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleTimeString();
}

function formatTokens(tokens: number | null): string {
  if (tokens === null || tokens === 0) return '-';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

function truncateMessage(message: string, maxLength: number = 60): string {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + '...';
}

function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'running':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function TasksTable({ tasks, loading }: TasksTableProps) {
  const [expandedTasks, setExpandedTasks] = React.useState<Set<string>>(new Set());
  const [iterationsData, setIterationsData] = React.useState<Record<string, Iteration[]>>({});
  const [loadingIterations, setLoadingIterations] = React.useState<Set<string>>(new Set());

  const toggleTask = async (taskId: string) => {
    const newExpanded = new Set(expandedTasks);

    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);

      // Fetch iterations if not already loaded
      if (!iterationsData[taskId]) {
        setLoadingIterations(prev => new Set(prev).add(taskId));
        try {
          const response = await fetch(`/api/dashboard/iterations/${taskId}`);
          const data = await response.json();
          setIterationsData(prev => ({ ...prev, [taskId]: data.iterations || [] }));
        } catch (error) {
          console.error('Failed to fetch iterations:', error);
          setIterationsData(prev => ({ ...prev, [taskId]: [] }));
        } finally {
          setLoadingIterations(prev => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        }
      }
    }

    setExpandedTasks(newExpanded);
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground p-4">Loading tasks...</div>;
  }

  if (tasks.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">No tasks for this session</div>;
  }

  return (
    <div className="bg-muted/30 rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]"></TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Iterations</TableHead>
            <TableHead>In Tokens</TableHead>
            <TableHead>Out Tokens</TableHead>
            <TableHead>Agent Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <React.Fragment key={task.id}>
              <TableRow className="cursor-pointer" onClick={() => toggleTask(task.id)}>
                <TableCell>
                  <Button variant="ghost" size="icon-sm">
                    {expandedTasks.has(task.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusBadgeVariant(task.status)}>
                    {task.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[300px]">
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <span className="cursor-help hover:underline decoration-dotted">
                          {truncateMessage(task.user_message)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="start"
                        className="max-w-lg max-h-80 overflow-auto whitespace-pre-wrap text-sm"
                      >
                        {task.user_message}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatTime(task.started_at)}
                </TableCell>
                <TableCell className="font-mono">
                  {formatDuration(task.duration_ms)}
                </TableCell>
                <TableCell className="font-mono">
                  {task.current_iteration || 0}/{task.max_iterations || '-'}
                </TableCell>
                <TableCell className="font-mono text-blue-600">
                  {formatTokens(task.total_input_tokens)}
                </TableCell>
                <TableCell className="font-mono text-green-600">
                  {formatTokens(task.total_output_tokens)}
                </TableCell>
                <TableCell>
                  {task.agent_status && (
                    <Badge variant={task.agent_status === 'completed' ? 'default' : 'outline'}>
                      {task.agent_status}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
              {expandedTasks.has(task.id) && (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <div className="pl-12 pr-4 py-4">
                      <h4 className="text-sm font-medium mb-2">Iterations</h4>
                      <IterationsTable
                        iterations={iterationsData[task.id] || []}
                        loading={loadingIterations.has(task.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
