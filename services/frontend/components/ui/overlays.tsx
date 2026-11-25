'use client';

import * as React from 'react';
import * as Aria from 'react-aria-components';
import { X } from 'lucide-react';
import { Tooltip as TooltipPrimitive, Popover as PopoverPrimitive } from 'radix-ui';
import {
  Dialog as PanelDialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogClose,
} from '@/components/panelui/dialog';
import {
  Sheet as PanelSheet,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetClose,
  type SheetSide,
} from '@/components/panelui/sheet';
import { OverlayPortalContext } from './overlay-portal';
import { cn } from '@/lib/utils';
import { Indicator } from './primitives';

export function useOverlayState(
  options: { defaultOpen?: boolean; isOpen?: boolean; onOpenChange?: (open: boolean) => void } = {}
) {
  const [localOpen, setLocalOpen] = React.useState(options.defaultOpen ?? false);
  const isOpen = options.isOpen ?? localOpen;
  const onOpenChange = options.onOpenChange;
  const setOpen = React.useCallback(
    (open: boolean) => {
      setLocalOpen(open);
      onOpenChange?.(open);
    },
    [onOpenChange]
  );
  return {
    isOpen,
    setOpen,
    open: React.useCallback(() => setOpen(true), [setOpen]),
    close: React.useCallback(() => setOpen(false), [setOpen]),
    toggle: () => setOpen(!isOpen),
  };
}
type OverlayState = ReturnType<typeof useOverlayState>;
type RootProps = {
  children: React.ReactNode;
  state?: OverlayState;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: SheetSide;
};
const OverlayContext = React.createContext<{
  state: OverlayState;
  kind: 'dialog' | 'sheet';
  side?: SheetSide;
} | null>(null);

function Root({
  children,
  state,
  isOpen,
  onOpenChange,
  side,
  kind = 'dialog',
}: RootProps & { kind?: 'dialog' | 'sheet' }) {
  const local = useOverlayState({ isOpen, onOpenChange });
  const value = React.useMemo(
    () => ({ state: state ?? local, kind, side }),
    [state, local, kind, side]
  );
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}
const SurfaceContext = React.createContext({ className: '', size: 'md' });
const BackdropContext = React.createContext({ className: '' });
const subscribeMobile = (notify: () => void) => {
  const query = window.matchMedia('(max-width: 639px)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const mobileSnapshot = () => window.matchMedia('(max-width: 639px)').matches;
const serverMobileSnapshot = () => false;
type BackdropProps = React.ComponentProps<'div'> & {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  isDismissable?: boolean;
  variant?: string;
};
/** Compatibility composition: PanelUI owns the portal, focus scope and backdrop. */
function Backdrop({
  className = '',
  isDismissable = true,
  variant: _variant,
  isOpen,
  onOpenChange,
  children,
}: BackdropProps) {
  const overlay = React.useContext(OverlayContext);
  const mobile = React.useSyncExternalStore(subscribeMobile, mobileSnapshot, serverMobileSnapshot);
  const open = isOpen ?? overlay?.state.isOpen ?? false;
  const setOpen = onOpenChange ?? overlay?.state.setOpen;
  const backdropValue = React.useMemo(() => ({ className }), [className]);
  const content = (
    <BackdropContext.Provider value={backdropValue}>{children}</BackdropContext.Provider>
  );
  if (overlay?.kind === 'sheet') {
    return (
      <PanelSheet
        open={open}
        onOpenChange={setOpen}
        side={overlay.side ?? (mobile ? 'bottom' : 'right')}
        dismissible={isDismissable}
      >
        {content}
      </PanelSheet>
    );
  }
  return (
    <PanelDialog
      open={open}
      dismissible={isDismissable}
      onOpenChange={(next, details) => {
        // Existing form callers disable both Escape and outside dismissal, but explicit Cancel/Close still work.
        if (
          !next &&
          !isDismissable &&
          details.reason !== 'close-press' &&
          details.reason !== 'imperative-action'
        ) {
          details.cancel();
          return;
        }
        setOpen?.(next);
      }}
    >
      {content}
    </PanelDialog>
  );
}
function Container({
  className = '',
  size = 'md',
  placement: _placement,
  scroll: _scroll,
  children,
}: React.ComponentProps<'div'> & { size?: string; placement?: string; scroll?: string }) {
  const value = React.useMemo(() => ({ className, size }), [className, size]);
  return <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>;
}
const DIALOG_WIDTHS: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  cover: 'max-w-5xl',
  full: 'max-w-6xl',
};
const SHEET_WIDTHS: Record<string, string> = {
  sm: 'sm:w-[24rem]',
  md: 'sm:w-[32rem]',
  lg: 'sm:w-[48rem]',
  xl: 'sm:w-[64rem]',
  cover: 'sm:w-[64rem]',
  full: 'sm:w-[72rem]',
};
/** Programmatically opened overlays restore focus to the initiating control. */
function usePopupPortal() {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const popupNode = React.useRef<HTMLDivElement | null>(null);
  const ref = React.useCallback((node: HTMLDivElement | null) => {
    popupNode.current = node;
    setContainer(node);
  }, []);
  const initialFocus = React.useCallback((interaction: string) => {
    // Preserve touch keyboard behavior; keyboard/mouse forms start at the first field, not Close.
    if (interaction === 'touch') return true;
    return (
      popupNode.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), [contenteditable="true"]'
      ) ?? true
    );
  }, []);
  return { container, ref, initialFocus };
}
function Dialog({
  className,
  children,
  ...props
}: React.ComponentProps<typeof PanelDialog.Content>) {
  const surface = React.useContext(SurfaceContext);
  const backdrop = React.useContext(BackdropContext);
  const { container, ref: popupRef, initialFocus } = usePopupPortal();
  return (
    <OverlayPortalContext.Provider value={container}>
      <PanelDialog.Content
        showClose={false}
        ref={popupRef}
        initialFocus={initialFocus}
        backdropClassName={backdrop.className}
        viewportClassName={backdrop.className}
        className={cn(
          DIALOG_WIDTHS[surface.size] ?? DIALOG_WIDTHS.md,
          surface.className,
          className
        )}
        {...props}
      >
        {children}
      </PanelDialog.Content>
    </OverlayPortalContext.Provider>
  );
}
function SheetDialog({
  className,
  children,
  ...props
}: React.ComponentProps<typeof PanelSheet.Content>) {
  const surface = React.useContext(SurfaceContext);
  const backdrop = React.useContext(BackdropContext);
  const { container, ref: popupRef, initialFocus } = usePopupPortal();
  return (
    <OverlayPortalContext.Provider value={container}>
      <PanelSheet.Content
        showClose={false}
        ref={popupRef}
        initialFocus={initialFocus}
        backdropClassName={backdrop.className}
        viewportClassName={backdrop.className}
        className={cn(
          'max-sm:w-full max-sm:max-w-none max-sm:max-h-[calc(100dvh-1rem)] sm:max-w-[calc(100vw-1.5rem)]',
          SHEET_WIDTHS[surface.size] ?? SHEET_WIDTHS.md,
          surface.className,
          className,
          backdrop.className
        )}
        {...props}
      >
        {children}
      </PanelSheet.Content>
    </OverlayPortalContext.Provider>
  );
}
function Header({ className, ...props }: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader className={cn('relative pe-14', className)} {...props} />;
}
function SheetHeadingHeader({ className, ...props }: React.ComponentProps<typeof SheetHeader>) {
  return <SheetHeader className={cn('relative pe-14', className)} {...props} />;
}
function CloseTrigger({ className, children, ...props }: React.ComponentProps<typeof DialogClose>) {
  return (
    <DialogClose
      icon={children === undefined}
      aria-label="Close"
      className={cn(
        'absolute end-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4',
        className
      )}
      {...props}
    >
      {children}
    </DialogClose>
  );
}
function SheetCloseTrigger({ className, ...props }: React.ComponentProps<typeof SheetClose>) {
  return (
    <SheetClose
      icon
      aria-label="Close"
      className={cn('absolute end-4 top-4 z-10', className)}
      {...props}
    />
  );
}
function Icon({
  status: _status,
  className,
  ...props
}: React.ComponentProps<'span'> & { status?: string }) {
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}
export const Modal = Object.assign(Root, {
  Backdrop,
  Container,
  Dialog,
  Header,
  Body: DialogBody,
  Footer: DialogFooter,
  Heading: DialogTitle,
  Description: PanelDialog.Description,
  CloseTrigger,
  Icon,
});
/** Contextual inspection/editing: right sheet on desktop, bottom sheet on phones. */
export const DetailSheet = Object.assign(
  function DetailSheet(props: RootProps) {
    return <Root {...props} kind="sheet" />;
  },
  {
    Backdrop,
    Container,
    Content: Container,
    Dialog: SheetDialog,
    Header: SheetHeadingHeader,
    Body: SheetBody,
    Footer: SheetFooter,
    Heading: SheetTitle,
    Description: PanelSheet.Description,
    CloseTrigger: SheetCloseTrigger,
    Icon,
  }
);
export const Drawer = DetailSheet;
export { AlertDialog } from './alert-dialog';
export const Tooltip = Object.assign(
  function Tooltip({
    children,
    delay = 300,
    isDisabled = false,
  }: {
    children: React.ReactNode;
    delay?: number;
    isDisabled?: boolean;
  }) {
    return (
      <>
        <TooltipPrimitive.Provider delayDuration={delay}>
          <TooltipPrimitive.Root open={isDisabled ? false : undefined}>
            {children}
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
      </>
    );
  },
  {
    Trigger: function Trigger({ children, ...props }: React.ComponentProps<'span'>) {
      return (
        <TooltipPrimitive.Trigger asChild>
          <span tabIndex={React.isValidElement(children) ? undefined : 0} {...props}>
            {children}
          </span>
        </TooltipPrimitive.Trigger>
      );
    },
    Content: ({
      className,
      placement = 'top',
      showArrow,
      children,
    }: {
      className?: string;
      placement?: string;
      showArrow?: boolean;
      children?: React.ReactNode;
    }) => (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={placement.split(' ')[0] as 'top' | 'bottom' | 'left' | 'right'}
          sideOffset={5}
          className={cn(
            'z-50 max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md',
            className
          )}
        >
          {children}
          {showArrow && <TooltipPrimitive.Arrow className="fill-foreground" />}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    ),
    Arrow: TooltipPrimitive.Arrow,
  }
);
export const Popover = Object.assign(PopoverPrimitive.Root, {
  Trigger: ({ children }: { children: React.ReactElement }) => (
    <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
  ),
  Content: ({
    className,
    placement = 'bottom',
    ...props
  }: React.ComponentProps<typeof PopoverPrimitive.Content> & { placement?: string }) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side={placement.split(' ')[0] as 'top' | 'bottom' | 'left' | 'right'}
        align={placement.includes('end') ? 'end' : placement.includes('start') ? 'start' : 'center'}
        sideOffset={6}
        className={cn(
          'z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
  Dialog: (props: React.ComponentProps<'div'>) => <div {...props} />,
  Heading: (props: React.ComponentProps<'h3'>) => <h3 {...props} />,
  Arrow: PopoverPrimitive.Arrow,
});
const trigger = ({ className, ...props }: Aria.ButtonProps) => (
  <Aria.Button
    slot="trigger"
    className={cn(
      'flex w-full items-center justify-between gap-2 py-4 text-left text-sm font-medium outline-none hover:underline data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring',
      typeof className === 'string' && className
    )}
    {...props}
  />
);
const heading = (props: React.ComponentProps<typeof Aria.Heading>) => <Aria.Heading {...props} />;
const body = (props: React.ComponentProps<'div'>) => <div {...props} />;
const disclosure = ({ className, ...props }: Aria.DisclosureProps) => (
  <Aria.Disclosure className={cn('group', typeof className === 'string' && className)} {...props} />
);
const DisclosureIndicator = ({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) => {
  const state = React.useContext(Aria.DisclosureStateContext);
  return (
    <span
      aria-hidden
      className={cn(
        'ml-auto flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-transform duration-150 motion-reduce:transition-none',
        state?.isExpanded && 'rotate-180',
        className
      )}
    >
      {children ?? <Indicator />}
    </span>
  );
};
export const Disclosure = Object.assign(disclosure, {
  Heading: heading,
  Trigger: trigger,
  Content: Aria.DisclosurePanel,
  Body: body,
  Indicator: DisclosureIndicator,
});
export const Accordion = Object.assign(
  function Accordion({
    variant: _variant,
    hideSeparator: _hide,
    ...props
  }: Aria.DisclosureGroupProps & { variant?: string; hideSeparator?: boolean }) {
    return <Aria.DisclosureGroup {...props} />;
  },
  {
    Item: disclosure,
    Heading: heading,
    Trigger: trigger,
    Panel: Aria.DisclosurePanel,
    Body: body,
    Indicator: DisclosureIndicator,
  }
);
