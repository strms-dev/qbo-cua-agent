'use client';

import * as React from 'react';
import { CalendarIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilesFilterProps {
  practice: string;
  bankAccount: string;
  dateRange: DateRange | undefined;
  practices: string[];
  bankAccounts: string[];
  onPracticeChange: (value: string) => void;
  onBankAccountChange: (value: string) => void;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onClearFilters: () => void;
}

export function FilesFilter({
  practice,
  bankAccount,
  dateRange,
  practices,
  bankAccounts,
  onPracticeChange,
  onBankAccountChange,
  onDateRangeChange,
  onClearFilters,
}: FilesFilterProps) {
  const hasFilters = practice || bankAccount || dateRange;

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Practice filter */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-muted-foreground">Practice</label>
        <Select value={practice} onValueChange={onPracticeChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All practices" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All practices</SelectItem>
            {practices.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bank Account filter */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-muted-foreground">Bank Account</label>
        <Select value={bankAccount} onValueChange={onBankAccountChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All accounts</SelectItem>
            {bankAccounts.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date Range filter */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-muted-foreground">Date Range</label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-[240px] justify-start text-left font-normal',
                !dateRange && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, 'LLL dd')} - {format(dateRange.to, 'LLL dd')}
                  </>
                ) : (
                  format(dateRange.from, 'LLL dd, y')
                )
              ) : (
                <span>Pick a date range</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={onDateRangeChange}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Clear filters button */}
      {hasFilters && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-muted-foreground invisible">Clear</label>
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
