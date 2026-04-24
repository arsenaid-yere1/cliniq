import { z } from 'zod'

export function visitDateSchema(opts?: {
  floorDate?: string | null
  ceilingDate?: string | null
  floorLabel?: string
  ceilingLabel?: string
}) {
  return z
    .string()
    .min(1, 'Visit date is required')
    .refine(
      (v) => !opts?.floorDate || v >= opts.floorDate,
      { message: `Visit date cannot precede the ${opts?.floorLabel ?? 'earliest allowed date'}.` },
    )
    .refine(
      (v) => !opts?.ceilingDate || v <= opts.ceilingDate,
      { message: `Visit date cannot exceed the ${opts?.ceilingLabel ?? 'latest allowed date'}.` },
    )
}
