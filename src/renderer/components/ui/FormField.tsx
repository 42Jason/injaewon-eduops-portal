import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Shared wrapper for form fields. Handles the label + required star + inline
 * error + helper-text + counter so every page doesn't re-implement that block.
 *
 *   <FormField label="제목" required error={errors.title} hint="최대 120자">
 *     <TextInput value={title} onChange={e => setTitle(e.target.value)} maxLength={120} />
 *   </FormField>
 *
 * `children` can be anything, but the TextInput / Textarea / SelectInput
 * components below pair nicely: they auto-wire `aria-invalid` / `aria-describedby`
 * when rendered via FormField.Slot (see bottom).
 */

export interface FormFieldProps {
  label?: ReactNode;
  required?: boolean;
  /** Inline error message; when present the field is styled in `danger` color. */
  error?: string | null;
  /** Short helper text shown below the field when there's no error. */
  hint?: ReactNode;
  /**
   * Current length for an inline counter (pair with `max` for "12/120"). Only
   * renders when `max` is also provided.
   */
  count?: number;
  max?: number;
  className?: string;
  children: (slotProps: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
    'aria-required': boolean | undefined;
  }) => ReactNode;
}

export function FormField({
  label,
  required,
  error,
  hint,
  count,
  max,
  className,
  children,
}: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = error ? errId : hint ? hintId : undefined;

  return (
    <div className={cn('block', className)}>
      {label && (
        <label htmlFor={id} className="text-[11px] font-medium text-fg-muted">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          )}
        </label>
      )}
      <div className="mt-1">
        {children({
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          'aria-required': required || undefined,
        })}
      </div>
      <div className="mt-1 flex min-h-[14px] items-start justify-between gap-2 text-[11px]">
        <span
          id={error ? errId : hintId}
          className={cn(
            'leading-tight',
            error ? 'text-danger' : 'text-fg-subtle',
          )}
          role={error ? 'alert' : undefined}
        >
          {error ?? hint ?? '\u00A0'}
        </span>
        {typeof max === 'number' && typeof count === 'number' && (
          <span
            className={cn(
              'tabular-nums text-fg-subtle',
              count > max && 'text-danger',
            )}
          >
            {count}/{max}
          </span>
        )}
      </div>
    </div>
  );
}

type SlotInjected = {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
};

/**
 * Styled `<input>` that flips to danger styles when `aria-invalid`.
 */
export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & SlotInjected & { invalid?: boolean }
>(function TextInput({ className, invalid, ...rest }, ref) {
  const isInvalid = invalid ?? rest['aria-invalid'] === true;
  return (
    <input
      ref={ref}
      className={cn(
        'input',
        isInvalid && 'border-danger focus-visible:ring-danger/40',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & SlotInjected & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  const isInvalid = invalid ?? rest['aria-invalid'] === true;
  return (
    <textarea
      ref={ref}
      className={cn(
        'input min-h-[72px] resize-y',
        isInvalid && 'border-danger focus-visible:ring-danger/40',
        className,
      )}
      {...rest}
    />
  );
});

export const SelectInput = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & SlotInjected & { invalid?: boolean }
>(function SelectInput({ className, invalid, children, ...rest }, ref) {
  const isInvalid = invalid ?? rest['aria-invalid'] === true;
  return (
    <select
      ref={ref}
      className={cn(
        'input',
        isInvalid && 'border-danger focus-visible:ring-danger/40',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
