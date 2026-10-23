// Developer City — parse a dropped or generated car spec into clamped parts.
// Finite numbers outside the legal range are clamped. A bad part fails the
// whole spec so the caller can keep the built-in sedan.

import type { CarPart, CarSpec } from '@/city/types';

const MAX_PARTS = 40;
const SIZE_MIN = 0.02;
const SIZE_MAX = 3;
const POS_MIN = -3;
const POS_MAX = 3;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function parseCarSpec(input: unknown): { spec: CarSpec | null; error: string | null } {
  if (!isRecord(input)) return fail('expected an object');
  if (input.kind !== 'car') return fail("kind must be 'car'");
  if (!Array.isArray(input.parts)) return fail('parts must be an array');
  if (input.parts.length === 0) return fail('empty parts');
  if (input.parts.length > MAX_PARTS) return fail('at most 40 parts');

  const parts: CarPart[] = [];
  for (let i = 0; i < input.parts.length; i += 1) {
    const parsed = parsePart(input.parts[i], i);
    if (typeof parsed === 'string') return fail(parsed);
    parts.push(parsed);
  }
  return { spec: { kind: 'car', parts }, error: null };
}

function parsePart(value: unknown, index: number): CarPart | string {
  if (!isRecord(value)) return `bad part ${index}`;
  if (value.shape !== 'box' && value.shape !== 'cylinder') {
    return `bad part ${index}: shape must be box or cylinder`;
  }
  const size = parseVec3(value.size, SIZE_MIN, SIZE_MAX);
  if (!size) return `bad part ${index}: size must be 3 numbers`;
  const position = parseVec3(value.position, POS_MIN, POS_MAX);
  if (!position) return `bad part ${index}: position must be 3 numbers`;
  if (typeof value.color !== 'string' || !COLOR.test(value.color)) {
    return `bad part ${index}: color must match #rrggbb`;
  }
  return { shape: value.shape, size, position, color: value.color };
}

function parseVec3(value: unknown, min: number, max: number): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const n = value[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[i] = clamp(n, min, max);
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(error: string): { spec: null; error: string } {
  return { spec: null, error };
}
