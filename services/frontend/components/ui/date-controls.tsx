'use client';

import * as React from 'react';
import * as Aria from 'react-aria-components';
import { ChevronLeft, ChevronRight, CalendarDays, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { useOverlayPortal } from './overlay-portal';

const DateControlPopover = ({ className, ...props }: Aria.PopoverProps) => (
  <Aria.Popover
    UNSTABLE_portalContainer={useOverlayPortal()}
    className={cn(
      'z-50 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none',
      typeof className === 'string' && className
    )}
    {...props}
  />
);
const trigger = (props: Aria.ButtonProps) => <Aria.Button aria-label="Open calendar" {...props} />;
const indicator = () => <CalendarDays className="size-4" />;
export const DateField = Object.assign(Aria.DateField, {
  Group: ({
    className,
    variant: _variant,
    fullWidth: _fullWidth,
    ...props
  }: Aria.GroupProps & { variant?: string; fullWidth?: boolean }) => (
    <Aria.Group
      className={cn(
        'flex h-8 min-w-0 items-center gap-1 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        typeof className === 'string' && className
      )}
      {...props}
    />
  ),
  Input: ({ className, ...props }: Aria.DateInputProps) => (
    <Aria.DateInput
      className={cn(
        'inline-flex min-w-0 items-center whitespace-nowrap text-base md:text-sm',
        typeof className === 'string' && className
      )}
      {...props}
    />
  ),
  Segment: ({ className, ...props }: Aria.DateSegmentProps) => (
    <Aria.DateSegment
      className={cn(
        'rounded px-0.5 outline-none data-[focused]:bg-primary data-[focused]:text-primary-foreground data-[placeholder]:text-muted-foreground',
        typeof className === 'string' && className
      )}
      {...props}
    />
  ),
  Suffix: (props: React.ComponentProps<'span'>) => <span {...props} />,
});
export const DatePicker = Object.assign(Aria.DatePicker, {
  Popover: DateControlPopover,
  Trigger: trigger,
  TriggerIndicator: indicator,
});
export const DateRangePicker = Object.assign(Aria.DateRangePicker, {
  Popover: DateControlPopover,
  Trigger: trigger,
  TriggerIndicator: indicator,
  RangeSeparator: () => (
    <span aria-hidden className="px-1 text-muted-foreground">
      –
    </span>
  ),
});
function YearPickerTrigger({ className, children }: React.ComponentProps<'div'>) {
  const portalContainer = useOverlayPortal();
  const calendar = React.useContext(Aria.CalendarStateContext);
  const range = React.useContext(Aria.RangeCalendarStateContext);
  const state = calendar ?? range;
  const [isOpen, setIsOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [startYear, setStartYear] = React.useState(
    () => Math.floor((state?.focusedDate.year ?? new Date().getFullYear()) / 12) * 12
  );
  if (!state) return null;
  return (
    <>
      <Button
        variant="ghost"
        ref={triggerRef}
        aria-label="Choose year"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onPress={() => {
          setStartYear(Math.floor(state.focusedDate.year / 12) * 12);
          setIsOpen(true);
        }}
        className={cn(
          'mr-auto flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium outline-none hover:bg-secondary data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring',
          className
        )}
      >
        {children}
      </Button>
      <Aria.Popover
        UNSTABLE_portalContainer={portalContainer}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        triggerRef={triggerRef}
        className="z-50 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
      >
        <Aria.Dialog aria-label="Choose calendar year" className="outline-none">
          <>
            <div className="mb-2 flex items-center justify-between gap-4">
              <Button
                variant="ghost"
                aria-label="Previous years"
                className="rounded p-1 hover:bg-secondary"
                onPress={() => setStartYear(startYear - 12)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-sm">
                {startYear}–{startYear + 11}
              </span>
              <Button
                variant="ghost"
                aria-label="Next years"
                className="rounded p-1 hover:bg-secondary"
                onPress={() => setStartYear(startYear + 12)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, index) => startYear + index).map((year) => (
                <Button
                  variant="ghost"
                  key={year}
                  className="rounded-md px-3 py-2 text-sm outline-none hover:bg-secondary data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring"
                  aria-pressed={state.focusedDate.year === year}
                  onPress={() => {
                    state.setFocusedDate(state.focusedDate.set({ year }));
                    setIsOpen(false);
                  }}
                >
                  {year}
                </Button>
              ))}
            </div>
          </>
        </Aria.Dialog>
      </Aria.Popover>
    </>
  );
}
const calendarParts = {
  Header: ({ className, ...props }: React.ComponentProps<'header'>) => (
    <header className={cn('mb-3 flex items-center justify-between gap-2', className)} {...props} />
  ),
  NavButton: ({ slot, ...props }: Aria.ButtonProps) => (
    <Aria.Button
      slot={slot}
      className="inline-flex size-7 items-center justify-center rounded-md border border-border outline-none hover:bg-secondary data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring"
      {...props}
    >
      {slot === 'previous' ? (
        <ChevronLeft className="size-4" />
      ) : (
        <ChevronRight className="size-4" />
      )}
    </Aria.Button>
  ),
  Grid: Aria.CalendarGrid,
  GridHeader: Aria.CalendarGridHeader,
  HeaderCell: ({ className, ...props }: Aria.CalendarHeaderCellProps) => (
    <Aria.CalendarHeaderCell
      className={cn(
        'w-9 text-xs font-normal text-muted-foreground',
        typeof className === 'string' && className
      )}
      {...props}
    />
  ),
  GridBody: Aria.CalendarGridBody,
  Cell: ({ className, ...props }: Aria.CalendarCellProps) => (
    <Aria.CalendarCell
      className={cn(
        'flex size-9 cursor-pointer items-center justify-center rounded-md text-sm outline-none hover:bg-secondary data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[disabled]:opacity-40 data-[outside-month]:hidden data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring',
        typeof className === 'string' && className
      )}
      {...props}
    />
  ),
  YearPickerTrigger,
  YearPickerTriggerHeading: Aria.Heading,
  YearPickerTriggerIndicator: () => <ChevronDown className="size-3" />,
};
export const Calendar = Object.assign(Aria.Calendar, calendarParts);
export const RangeCalendar = Object.assign(Aria.RangeCalendar, calendarParts);
export const NumberField = Object.assign(Aria.NumberField, {
  Group: Aria.Group,
  Input: Aria.Input,
  IncrementButton: (props: Aria.ButtonProps) => <Aria.Button slot="increment" {...props} />,
  DecrementButton: (props: Aria.ButtonProps) => <Aria.Button slot="decrement" {...props} />,
});
export const ColorPicker = Object.assign(
  function ColorPicker({ children, ...props }: Aria.ColorPickerProps) {
    return (
      <Aria.ColorPicker {...props}>
        {(renderProps) => (
          <Aria.DialogTrigger>
            {typeof children === 'function' ? children(renderProps) : children}
          </Aria.DialogTrigger>
        )}
      </Aria.ColorPicker>
    );
  },
  {
    Trigger: Aria.Button,
    Popover: DateControlPopover,
  }
);
export const ColorArea = Object.assign(Aria.ColorArea, { Thumb: Aria.ColorThumb });
export const ColorSlider = Object.assign(Aria.ColorSlider, {
  Track: Aria.SliderTrack,
  Thumb: Aria.ColorThumb,
});
export const ColorField = Object.assign(Aria.ColorField, {
  Group: ({
    variant: _variant,
    fullWidth: _fullWidth,
    ...props
  }: Aria.GroupProps & { variant?: string; fullWidth?: boolean }) => <Aria.Group {...props} />,
  Prefix: (props: React.ComponentProps<'span'>) => <span {...props} />,
  Input: Aria.Input,
});
export const ColorSwatch = ({
  size: _size,
  className,
  ...props
}: Aria.ColorSwatchProps & { size?: string }) => (
  <Aria.ColorSwatch
    className={cn(
      'size-6 rounded-md border border-border',
      typeof className === 'string' && className
    )}
    {...props}
  />
);

export function DatePickerCalendar({ 'aria-label': ariaLabel }: { 'aria-label': string }) {
  return (
    <Calendar aria-label={ariaLabel}>
      <Calendar.Header>
        <Calendar.YearPickerTrigger>
          <Calendar.YearPickerTriggerHeading />
          <Calendar.YearPickerTriggerIndicator />
        </Calendar.YearPickerTrigger>
        <Calendar.NavButton slot="previous" />
        <Calendar.NavButton slot="next" />
      </Calendar.Header>
      <Calendar.Grid>
        <Calendar.GridHeader>
          {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
        </Calendar.GridHeader>
        <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
      </Calendar.Grid>
    </Calendar>
  );
}
