import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  secondary: 'border border-border bg-surface text-fg hover:bg-bg',
  ghost: 'text-fg hover:bg-border/40',
  danger: 'bg-danger text-white hover:opacity-90',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50',
          variants[variant],
          className,
        )}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
