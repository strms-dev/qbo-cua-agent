'use client';

import * as React from 'react';
import { Clock, ListTodo, Activity, CheckCircle } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { MetricCard } from '@/components/dashboard/MetricCard';
import { DateFilter } from '@/components/dashboard/DateFilter';
import { SessionsTable } from '@/components/dashboard/SessionsTable';

interface Session {
  id: string;
  created_at: string;
  status: string;
  total_conversation_time_ms: number | null;
  total_iterations: number | null;
  task_count: number;
}

interface SessionsResponse {
  sessions: Session[];
  total: number;
}

function formatTotalTime(sessions: Session[]): string {
  const totalMs = sessions.reduce((acc, s) => acc + (s.total_conversation_time_ms || 0), 0);
  if (totalMs === 0) return '0s';
  if (totalMs < 60000) return `${(totalMs / 1000).toFixed(0)}s`;
  if (totalMs < 3600000) return `${(totalMs / 60000).toFixed(1)}m`;
  return `${(totalMs / 3600000).toFixed(1)}h`;
}

function formatAvgTime(sessions: Session[]): string {
  const sessionsWithTime = sessions.filter(s => s.total_conversation_time_ms);
  if (sessionsWithTime.length === 0) return '-';
  const avgMs = sessionsWithTime.reduce((acc, s) => acc + (s.total_conversation_time_ms || 0), 0) / sessionsWithTime.length;
  if (avgMs < 1000) return `${avgMs.toFixed(0)}ms`;
  if (avgMs < 60000) return `${(avgMs / 1000).toFixed(1)}s`;
  return `${(avgMs / 60000).toFixed(1)}m`;
}

export default function DashboardPage() {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);

  const fetchSessions = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange?.from) {
        params.set('startDate', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        params.set('endDate', dateRange.to.toISOString());
      }

      const response = await fetch(`/api/dashboard/sessions?${params.toString()}`);
      const data: SessionsResponse = await response.json();

      setSessions(data.sessions || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  React.useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const totalIterations = sessions.reduce((acc, s) => acc + (s.total_iterations || 0), 0);
  const totalTasks = sessions.reduce((acc, s) => acc + s.task_count, 0);
  const completedSessions = sessions.filter(s => s.status === 'completed').length;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">
              Session metrics and performance analytics
            </p>
          </div>
          <DateFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
        </div>

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Sessions"
            value={total}
            description={`${completedSessions} completed`}
            icon={<ListTodo className="h-4 w-4" />}
          />
          <MetricCard
            title="Total Time"
            value={formatTotalTime(sessions)}
            description={`Avg: ${formatAvgTime(sessions)}`}
            icon={<Clock className="h-4 w-4" />}
          />
          <MetricCard
            title="Total Iterations"
            value={totalIterations}
            description={`Across all sessions`}
            icon={<Activity className="h-4 w-4" />}
          />
          <MetricCard
            title="Total Tasks"
            value={totalTasks}
            description={`${sessions.length > 0 ? (totalTasks / sessions.length).toFixed(1) : 0} avg/session`}
            icon={<CheckCircle className="h-4 w-4" />}
          />
        </div>

        {/* Sessions Table */}
        <SessionsTable
          sessions={sessions}
          loading={loading}
          onRefresh={fetchSessions}
        />
      </div>
    </div>
  );
}
