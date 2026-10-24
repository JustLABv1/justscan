'use client';

import { useState } from 'react';
import { Heading } from 'react-aria-components';
import { CalendarDays } from 'lucide-react';
import { type DateValue, getLocalTimeZone } from '@internationalized/date';
import { Button } from './button';
import { DateField, RangeCalendar } from './date-controls';
import { Popover } from './overlays';

type DateRange = { start: DateValue; end: DateValue };

/** A compact filter trigger with editable dates and a keyboard-accessible range calendar. */
export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange | null;
  onChange: (value: DateRange | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | null>(value);
  const invalid = Boolean(draft && draft.start.compare(draft.end) > 0);
  const format = (date: DateValue) =>
    date
      .toDate(getLocalTimeZone())
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <Popover.Trigger>
        <Button
          variant="outline"
          className="w-full justify-start font-normal"
          aria-label={
            value
              ? `Scan date range: ${format(value.start)} to ${format(value.end)}`
              : 'Choose scan date range'
          }
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="truncate">
            {value ? `${format(value.start)} – ${format(value.end)}` : 'Choose dates'}
          </span>
        </Button>
      </Popover.Trigger>
      <Popover.Content
        placement="bottom start"
        className="w-[300px] max-w-[calc(100vw-2rem)] p-3"
        aria-label="Scan date range"
      >
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(['start', 'end'] as const).map((part) => (
            <DateField
              key={part}
              aria-label={part === 'start' ? 'Start date' : 'End date'}
              value={draft?.[part] ?? null}
              onChange={(date) => {
                if (date)
                  setDraft((current) => ({
                    start: current?.start ?? date,
                    end: current?.end ?? date,
                    [part]: date,
                  }));
              }}
            >
              <span className="mb-1 block text-xs text-muted-foreground">
                {part === 'start' ? 'From' : 'To'}
              </span>
              <DateField.Group>
                <DateField.Input>
                  {(segment) => <DateField.Segment segment={segment} />}
                </DateField.Input>
              </DateField.Group>
            </DateField>
          ))}
        </div>
        <RangeCalendar
          aria-label="Scan dates"
          value={invalid ? null : draft}
          onChange={setDraft}
          className="w-full"
        >
          <RangeCalendar.Header>
            <RangeCalendar.NavButton slot="previous" />
            <Heading className="text-sm font-medium" />
            <RangeCalendar.NavButton slot="next" />
          </RangeCalendar.Header>
          <RangeCalendar.Grid className="w-full border-collapse">
            <RangeCalendar.GridHeader>
              {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
            </RangeCalendar.GridHeader>
            <RangeCalendar.GridBody>
              {(date) => <RangeCalendar.Cell date={date} />}
            </RangeCalendar.GridBody>
          </RangeCalendar.Grid>
        </RangeCalendar>
        {invalid ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            End date must be on or after start date.
          </p>
        ) : null}
        <div className="mt-3 flex justify-between gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              onChange(null);
              setDraft(null);
              setOpen(false);
            }}
          >
            Clear dates
          </Button>
          <Button
            size="sm"
            isDisabled={!draft || invalid}
            onPress={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  );
}
