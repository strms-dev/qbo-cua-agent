'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

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
import { TasksTable } from './TasksTable';

interface Session {
  id: string;
  created_at: string;
  status: string;
  total_conversation_time_ms: number | null;
  total_iterations: number | null;
  task_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
}

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
  total_cost: number | null;
}

interface SessionsTableProps {
  sessions: Session[];
  loading?: boolean;
  onRefresh?: () => void;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTokens(tokens: number | null): string {
  if (tokens === null || tokens === 0) return '-';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString();
}

function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'active':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function SessionsTable({ sessions, loading, onRefresh }: SessionsTableProps) {
  const [expandedSessions, setExpandedSessions] = React.useState<Set<string>>(new Set());
  const [tasksData, setTasksData] = React.useState<Record<string, Task[]>>({});
  const [loadingTasks, setLoadingTasks] = React.useState<Set<string>>(new Set());

  const toggleSession = async (sessionId: string) => {
    const newExpanded = new Set(expandedSessions);

    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId);
    } else {
      newExpanded.add(sessionId);

      // Fetch tasks if not already loaded
      if (!tasksData[sessionId]) {
        setLoadingTasks(prev => new Set(prev).add(sessionId));
        try {
          const response = await fetch(`/api/dashboard/tasks/${sessionId}`);
          const data = await response.json();
          setTasksData(prev => ({ ...prev, [sessionId]: data.tasks || [] }));
        } catch (error) {
          console.error('Failed to fetch tasks:', error);
          setTasksData(prev => ({ ...prev, [sessionId]: [] }));
        } finally {
          setLoadingTasks(prev => {
            const next = new Set(prev);
            next.delete(sessionId);
            return next;
          });
        }
      }
    }

    setExpandedSessions(newExpanded);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        Loading sessions...
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-medium">Sessions</h3>
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
            <TableHead className="w-[40px]"></TableHead>
            <TableHead>Session ID</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Total Time</TableHead>
            <TableHead>Iterations</TableHead>
            <TableHead>In Tokens</TableHead>
            <TableHead>Out Tokens</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Tasks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="text-center text-muted-foreground">
                No sessions found
              </TableCell>
            </TableRow>
          ) : (
            sessions.map((session) => (
              <React.Fragment key={session.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => toggleSession(session.id)}
                >
                  <TableCell>
                    <Button variant="ghost" size="icon-sm">
                      {expandedSessions.has(session.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {session.id.substring(0, 8)}...
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(session.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(session.status)}>
                      {session.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">
                    {formatDuration(session.total_conversation_time_ms)}
                  </TableCell>
                  <TableCell className="font-mono">
                    {session.total_iterations ?? '-'}
                  </TableCell>
                  <TableCell className="font-mono text-blue-600">
                    {formatTokens(session.total_input_tokens)}
                  </TableCell>
                  <TableCell className="font-mono text-green-600">
                    {formatTokens(session.total_output_tokens)}
                  </TableCell>
                  <TableCell className="font-mono text-emerald-600">
                    ${session.total_cost?.toFixed(2) ?? '-'}
                  </TableCell>
                  <TableCell className="font-mono">
                    {session.task_count}
                  </TableCell>
                </TableRow>
                {expandedSessions.has(session.id) && (
                  <TableRow>
                    <TableCell colSpan={10} className="p-0">
                      <div className="pl-12 pr-4 py-4">
                        <h4 className="text-sm font-medium mb-2">Tasks</h4>
                        <TasksTable
                          tasks={tasksData[session.id] || []}
                          loading={loadingTasks.has(session.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
