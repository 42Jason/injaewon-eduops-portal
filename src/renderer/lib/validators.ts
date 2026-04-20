/**
 * Small validation helpers for form fields. Every validator returns either a
 * Korean error string (for the inline FormField message) or null.
 *
 * Compose with `firstError([...])` so multiple rules run in order and the
 * first failing message wins — matches the expected UX ("필수 > 형식 > 범위").
 */

export type ValidationResult = string | null;
export type Validator<T = string> = (value: T) => ValidationResult;

export function required(msg = '필수 항목입니다'): Validator<string | number | null | undefined> {
  return (v) => {
    if (v === null || v === undefined) return msg;
    if (typeof v === 'string' && v.trim() === '') return msg;
    return null;
  };
}

export function minLength(n: number, msg?: string): Validator<string> {
  return (v) => {
    if (!v) return null; // combine with `required()` if emptiness should fail
    return v.length >= n ? null : msg ?? `최소 ${n}자 이상 입력하세요`;
  };
}

export function maxLength(n: number, msg?: string): Validator<string> {
  return (v) => {
    if (!v) return null;
    return v.length <= n ? null : msg ?? `최대 ${n}자까지 입력할 수 있습니다`;
  };
}

export function pattern(re: RegExp, msg: string): Validator<string> {
  return (v) => {
    if (!v) return null;
    return re.test(v) ? null : msg;
  };
}

export function email(msg = '이메일 형식이 올바르지 않습니다'): Validator<string> {
  // Pragmatic — not RFC-5322 — but good enough for UI validation.
  return pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg);
}

export function koreanPhone(msg = '전화번호 형식이 올바르지 않습니다'): Validator<string> {
  // Allows digits, hyphens, plus, parens, space — 6 to 20 chars.
  return pattern(/^[0-9+\-\s()]{6,20}$/, msg);
}

export function numberRange(
  lo: number,
  hi: number,
  msg?: string,
): Validator<number | null | undefined> {
  return (v) => {
    if (v === null || v === undefined) return null;
    if (Number.isNaN(v)) return '숫자만 입력하세요';
    return v >= lo && v <= hi ? null : msg ?? `${lo} ~ ${hi} 사이의 값을 입력하세요`;
  };
}

/**
 * Date pair: returns an error if `end` is strictly before `start`.
 * Pass `yyyy-mm-dd` strings or Date objects.
 */
export function dateOrder(startLabel = '시작일', endLabel = '종료일'): Validator<{ start: string | Date | null; end: string | Date | null }> {
  return ({ start, end }) => {
    if (!start || !end) return null;
    const s = typeof start === 'string' ? new Date(start) : start;
    const e = typeof end === 'string' ? new Date(end) : end;
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    return e < s ? `${endLabel}은 ${startLabel}보다 이후여야 합니다` : null;
  };
}

/** Run validators in order; return the first non-null message, else null. */
export function firstError<T>(validators: Array<Validator<T>>): Validator<T> {
  return (v) => {
    for (const fn of validators) {
      const r = fn(v);
      if (r) return r;
    }
    return null;
  };
}

/**
 * Shape-based validator. Map field name → validator; returns an errors object
 * with only the fields that have a message (so `Object.keys(errs).length === 0`
 * means the form is valid).
 */
export function validateShape<
  V extends Record<string, unknown>,
  R extends { [K in keyof V]?: Validator<V[K]> },
>(values: V, rules: R): Partial<Record<keyof V, string>> {
  const out: Partial<Record<keyof V, string>> = {};
  for (const key of Object.keys(rules) as Array<keyof V>) {
    const fn = rules[key];
    if (!fn) continue;
    const msg = (fn as Validator<V[keyof V]>)(values[key]);
    if (msg) out[key] = msg;
  }
  return out;
}
