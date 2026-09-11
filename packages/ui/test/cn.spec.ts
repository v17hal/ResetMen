import { describe, expect, it } from 'vitest';

import { cn } from '../src/cn.js';

/**
 * The owner's laptop showed the selected Capacity tab and "+ Add rule" as blank dark blocks.
 * The live button's text colour was rgb(11, 15, 20) on green: `text-body-sm` had been
 * mistaken for a colour and had deleted `text-primary-fg`.
 */
describe('cn', () => {
  it('keeps a text colour alongside a type-scale size', () => {
    // The exact order Button applies them: variant, then size.
    const classes = cn('bg-primary text-primary-fg', 'text-body-sm');
    expect(classes).toContain('text-primary-fg');
    expect(classes).toContain('text-body-sm');
  });

  it('keeps white text on a danger button', () => {
    expect(cn('bg-danger text-white', 'text-body')).toContain('text-white');
  });

  it('keeps the size when a caller overrides the colour', () => {
    // A ghost "Delete" button: size from Button, colour from the caller.
    const classes = cn('text-text', 'text-body-sm', 'text-danger');
    expect(classes).toContain('text-body-sm');
    expect(classes).toContain('text-danger');
    expect(classes).not.toContain('text-text ');
  });

  it('still lets a later size replace an earlier one', () => {
    expect(cn('text-body-sm', 'text-h1')).toBe('text-h1');
    expect(cn('text-caption', 'text-body-sm')).toBe('text-body-sm');
  });

  it('still lets a later colour replace an earlier one', () => {
    expect(cn('text-primary', 'text-danger')).toBe('text-danger');
  });
});
