import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { Badge, badgeVariants, type BadgeProps } from './badge';
import { Button, buttonVariants, type ButtonProps } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Input } from './input';
import { Separator } from './separator';
import { Skeleton } from './skeleton';

describe('Button', () => {
  it('renders its label and the default variant applies bg-primary', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('bg-primary');
    expect(button).toHaveClass('text-primary-foreground');
    // Default size.
    expect(button).toHaveClass('h-9');
  });

  it('asChild renders the styling onto a child anchor', () => {
    render(
      <Button asChild>
        <a href="/somewhere">Go</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveClass('bg-primary');
  });

  it.each<[NonNullable<ButtonProps['variant']>, string]>([
    ['default', 'bg-primary'],
    ['destructive', 'bg-destructive'],
    ['outline', 'border-input'],
    ['secondary', 'bg-secondary'],
    ['ghost', 'hover:bg-accent'],
    ['link', 'underline-offset-4'],
  ])('applies the %s variant class', (variant, cls) => {
    render(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole('button', { name: variant })).toHaveClass(cls);
  });

  it.each<[NonNullable<ButtonProps['size']>, string]>([
    ['default', 'h-9'],
    ['sm', 'h-8'],
    ['lg', 'h-10'],
    ['icon', 'w-9'],
  ])('applies the %s size class', (size, cls) => {
    render(<Button size={size}>{size}</Button>);
    expect(screen.getByRole('button', { name: size })).toHaveClass(cls);
  });

  it('buttonVariants composes variant + size + extra className', () => {
    const out = buttonVariants({ variant: 'ghost', size: 'sm', className: 'extra-x' });
    expect(out).toContain('extra-x');
  });
});

describe('Badge', () => {
  it('renders with the default variant token class', () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText('New');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-primary');
  });

  it.each<[NonNullable<BadgeProps['variant']>, string]>([
    ['default', 'bg-primary'],
    ['secondary', 'bg-secondary'],
    ['destructive', 'bg-destructive'],
    ['outline', 'text-foreground'],
  ])('applies the %s variant class', (variant, cls) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant)).toHaveClass(cls);
  });

  it('badgeVariants returns a string', () => {
    expect(typeof badgeVariants({ variant: 'outline' })).toBe('string');
  });
});

describe('Avatar', () => {
  it('renders its fallback content', () => {
    render(
      <Avatar>
        <AvatarFallback>WC</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('WC')).toBeInTheDocument();
  });

  it('merges a custom className onto the root', () => {
    const { container } = render(<Avatar className="custom-root" />);
    expect(container.firstChild).toHaveClass('custom-root');
  });

  it('renders the AvatarImage element', () => {
    // Radix only swaps in the image after a successful load; mount it to exercise the
    // AvatarImage component code path regardless of jsdom's image loading.
    render(
      <Avatar>
        <AvatarImage src="https://example.com/a.png" alt="me" className="img-x" />
        <AvatarFallback>FB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('FB')).toBeInTheDocument();
  });
});

describe('Card family', () => {
  it('composes every sub-component', () => {
    render(
      <Card className="card-x">
        <CardHeader className="hdr-x">
          <CardTitle className="title-x">Title</CardTitle>
          <CardDescription className="desc-x">Description</CardDescription>
        </CardHeader>
        <CardContent className="content-x">Body</CardContent>
        <CardFooter className="footer-x">Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByText('Title')).toHaveClass('font-semibold', 'title-x');
    expect(screen.getByText('Description')).toHaveClass('text-muted-foreground', 'desc-x');
    expect(screen.getByText('Body')).toHaveClass('content-x');
    expect(screen.getByText('Footer')).toHaveClass('footer-x');
  });
});

describe('Input', () => {
  it('renders a native input with the passed type and forwards props', () => {
    render(<Input type="email" placeholder="you@example.com" className="input-x" />);
    const input = screen.getByPlaceholderText('you@example.com');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveClass('input-x');
  });

  it('renders without an explicit type', () => {
    render(<Input aria-label="bare" />);
    expect(screen.getByLabelText('bare')).toBeInTheDocument();
  });
});

describe('Separator', () => {
  it('renders a horizontal divider by default', () => {
    const { container } = render(<Separator className="sep-x" />);
    const sep = container.firstChild as HTMLElement;
    expect(sep).toHaveClass('h-[1px]', 'w-full', 'sep-x');
  });

  it('renders a vertical divider when orientation is vertical', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const sep = container.firstChild as HTMLElement;
    expect(sep).toHaveClass('h-full', 'w-[1px]');
  });
});

describe('Skeleton', () => {
  it('renders an animated placeholder and merges className', () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('animate-pulse', 'rounded-md', 'bg-accent', 'h-4', 'w-10');
  });
});

describe('DropdownMenu family', () => {
  it('renders the full menu surface (items, label, checkbox, radio, separators, shortcuts)', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Section</DropdownMenuLabel>
          <DropdownMenuLabel inset>Inset Section</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Plain item
              <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem inset>Inset item</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked>Checked box</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="r1">
            <DropdownMenuRadioItem value="r1">Radio one</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Sub plain</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>Sub inset</DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await waitFor(() => {
      expect(screen.getByText('Section')).toBeInTheDocument();
    });
    expect(screen.getByText('Inset Section')).toHaveClass('pl-8');
    expect(screen.getByText('Plain item')).toBeInTheDocument();
    expect(screen.getByText('Inset item')).toHaveClass('pl-8');
    expect(screen.getByText('⌘P')).toHaveClass('ml-auto');
    expect(screen.getByText('Checked box')).toBeInTheDocument();
    expect(screen.getByText('Radio one')).toBeInTheDocument();
    expect(screen.getByText('Sub plain')).toBeInTheDocument();
    expect(screen.getByText('Sub inset')).toHaveClass('pl-8');
  });

  it('opens the submenu content via the sub-trigger to render SubContent', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Submenu</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="sub-x">
              <DropdownMenuItem>Inside sub</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = await screen.findByText('Submenu');
    fireEvent.pointerMove(trigger);
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText('Inside sub')).toBeInTheDocument();
    });
  });
});
