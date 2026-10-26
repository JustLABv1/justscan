'use client';

import * as React from 'react';
import * as Aria from 'react-aria-components';
import { X } from 'lucide-react';
import { Tooltip as TooltipPrimitive, Popover as PopoverPrimitive } from 'radix-ui';
import {
  Dialog as DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from './dialog';
import { cn } from '@/lib/utils';
import { Indicator } from './primitives';

export function useOverlayState(
  options: { defaultOpen?: boolean; isOpen?: boolean; onOpenChange?: (open: boolean) => void } = {}
) {
  const [localOpen, setLocalOpen] = React.useState(options.defaultOpen ?? false);
  const isOpen = options.isOpen ?? localOpen;
  const setOpen = (open: boolean) => {
    setLocalOpen(open);
    options.onOpenChange?.(open);
  };
  return {
    isOpen,
    setOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen),
  };
}
type OverlayState = ReturnType<typeof useOverlayState>;
const OverlayContext = React.createContext<OverlayState | null>(null);
function Root({
  children,
  state,
  isOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  state?: OverlayState;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const local = useOverlayState({ isOpen, onOpenChange });
  return <OverlayContext.Provider value={state ?? local}>{children}</OverlayContext.Provider>;
}
type BackdropProps = React.ComponentProps<'div'> & {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  isDismissable?: boolean;
  variant?: string;
};
const DismissContext = React.createContext(true);
function Backdrop({
  className,
  isDismissable = true,
  variant: _variant,
  isOpen,
  onOpenChange,
  children,
  ...props
}: BackdropProps) {
  const state = React.useContext(OverlayContext);
  return (
    <DialogRoot
      open={isOpen ?? state?.isOpen ?? false}
      onOpenChange={onOpenChange ?? state?.setOpen}
    >
      <DismissContext.Provider value={isDismissable}>
        <DialogPortal>
          <DialogOverlay>
            <div
              className={cn(
                'fixed inset-0 flex items-center justify-center overflow-y-auto p-4',
                className
              )}
              {...props}
            >
              {children}
            </div>
          </DialogOverlay>
        </DialogPortal>
      </DismissContext.Provider>
    </DialogRoot>
  );
}
function Container({
  className,
  size = 'md',
  placement: _placement,
  scroll: _scroll,
  ...props
}: React.ComponentProps<'div'> & { size?: string; placement?: string; scroll?: string }) {
  return (
    <div
      className={cn(
        'relative my-auto w-full',
        size === 'sm'
          ? 'max-w-sm'
          : size === 'lg'
            ? 'max-w-3xl'
            : size === 'xl'
              ? 'max-w-5xl'
              : 'max-w-lg',
        className
      )}
      {...props}
    />
  );
}
function Dialog({
  onInteractOutside,
  onEscapeKeyDown,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const dismissable = React.useContext(DismissContext);
  const previousFocus = React.useRef<HTMLElement | null>(null);
  return (
    <DialogContent
      {...props}
      onOpenAutoFocus={(event) => {
        previousFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        onOpenAutoFocus?.(event);
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented && previousFocus.current?.isConnected) {
          event.preventDefault();
          previousFocus.current.focus();
        }
      }}
      onInteractOutside={(event) => {
        if (!dismissable) event.preventDefault();
        onInteractOutside?.(event);
      }}
      onEscapeKeyDown={(event) => {
        if (!dismissable) event.preventDefault();
        onEscapeKeyDown?.(event);
      }}
    />
  );
}
function Header({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 items-start justify-between gap-3 p-4 pb-3', className)}
      {...props}
    />
  );
}
function Body({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-h-0 overflow-y-auto px-4 py-1', className)} {...props} />;
}
function Footer({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex shrink-0 justify-end gap-2 p-4 pt-3', className)} {...props} />;
}
function Heading(props: React.ComponentProps<typeof DialogTitle>) {
  return <DialogTitle {...props} />;
}
function CloseTrigger({ className, children, ...props }: React.ComponentProps<typeof DialogClose>) {
  return (
    <DialogClose
      aria-label="Close"
      className={cn(
        'ml-auto rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      {...props}
    >
      {children ?? <X className="size-4" />}
    </DialogClose>
  );
}
function Icon({ status: _status, ...props }: React.ComponentProps<'span'> & { status?: string }) {
  return <span {...props} />;
}
export const Modal = Object.assign(Root, {
  Backdrop,
  Container,
  Dialog,
  Header,
  Body,
  Footer,
  Heading,
  CloseTrigger,
  Icon,
});
export const AlertDialog = Modal;
export const Drawer = Object.assign(
  function Drawer(props: React.ComponentProps<typeof Root>) {
    return <Root {...props} />;
  },
  {
    Backdrop: ({ className, ...props }: BackdropProps) => (
      <Backdrop
        className={cn('justify-end p-0', typeof className === 'string' && className)}
        {...props}
      />
    ),
    Content: ({
      className,
      placement = 'right',
      ...props
    }: React.ComponentProps<typeof Container>) => (
      <Container
        className={cn(
          'fixed inset-y-0 my-0 h-full max-w-lg',
          placement === 'left' ? 'left-0' : 'right-0',
          className
        )}
        {...props}
      />
    ),
    Dialog: ({ className, ...props }: React.ComponentProps<typeof DialogContent>) => (
      <Dialog
        className={cn('h-dvh max-h-dvh rounded-none', typeof className === 'string' && className)}
        {...props}
      />
    ),
    Header,
    Body,
    Footer,
    Heading,
    CloseTrigger,
  }
);
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
