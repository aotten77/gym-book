import { describe, expect, it } from 'vitest';
import { parseNumberInput, toInputValue } from '@/lib/number-input';

describe('parseNumberInput', () => {
  it('accepts a german decimal comma', () => {
    expect(parseNumberInput('52,5')).toEqual({ status: 'valid', value: 52.5 });
  });

  it('accepts a decimal point', () => {
    expect(parseNumberInput('52.5')).toEqual({ status: 'valid', value: 52.5 });
  });

  it('reports an empty field separately from an invalid one', () => {
    expect(parseNumberInput('')).toEqual({ status: 'empty' });
    expect(parseNumberInput('   ')).toEqual({ status: 'empty' });
    expect(parseNumberInput('abc')).toEqual({ status: 'invalid' });
  });

  it('rejects negative values', () => {
    expect(parseNumberInput('-5')).toEqual({ status: 'invalid' });
  });

  it('accepts zero', () => {
    expect(parseNumberInput('0')).toEqual({ status: 'valid', value: 0 });
  });
});

describe('toInputValue', () => {
  it('renders numbers and treats undefined as an empty field', () => {
    expect(toInputValue(52.5)).toBe('52,5');
    expect(toInputValue(0)).toBe('0');
    expect(toInputValue(undefined)).toBe('');
  });
});
