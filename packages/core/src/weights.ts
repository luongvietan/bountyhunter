import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { SIGNAL_TYPES } from './signals.js';
import type { Weights } from './scoring.js';

const weightsShape = Object.fromEntries(
  SIGNAL_TYPES.map((t) => [t, z.number().min(0)]),
) as Record<(typeof SIGNAL_TYPES)[number], z.ZodNumber>;

const WeightsSchema = z.object({
  version: z.string().min(1),
  minConfidence: z.number().min(0).max(1),
  weights: z.object(weightsShape).strict(),
});

export function parseWeights(yamlText: string): Weights {
  return WeightsSchema.parse(parseYaml(yamlText)) as Weights;
}
