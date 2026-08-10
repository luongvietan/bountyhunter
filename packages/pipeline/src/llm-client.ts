import { z } from 'zod';

export const FINDING_TRIAGE_SCRIPT = 'Finding Triage';

const MergeVerdictSchema = z.object({
  decision: z.enum(['approve', 'reject', 'pending']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
});

export type MergeVerdict = z.infer<typeof MergeVerdictSchema>;

export interface LlmClientConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface MergeReviewContext {
  leftName: string;
  leftSlug: string;
  rightName: string;
  rightSlug: string;
  similarity: number;
  leftHints: string[];
  rightPrograms: string[];
  leftRepoScopes: string[];
  rightRepoScopes: string[];
}

function envConfig(): LlmClientConfig | null {
  const apiUrl = process.env.RADAR_LLM_API_URL?.trim();
  const apiKey = process.env.RADAR_LLM_API_KEY?.trim();
  const model = process.env.RADAR_LLM_MODEL?.trim() ?? 'gpt-4o-mini';
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey, model };
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('LLM response is not JSON.');
  }
}

export async function reviewMergeCandidate(
  context: MergeReviewContext,
  config: LlmClientConfig | null = envConfig(),
): Promise<MergeVerdict | null> {
  if (!config) return null;

  const prompt = [
    'You decide whether two bug-bounty entity records refer to the same project.',
    'Return JSON only: {"decision":"approve"|"reject"|"pending","confidence":0-1,"reason":"..."}',
    'Approve only when evidence clearly matches. Reject when clearly different. Pending when uncertain.',
    '',
    `Left (provisional audit entity): ${context.leftName} (${context.leftSlug})`,
    `Audit hints: ${context.leftHints.join('; ') || 'none'}`,
    `Repo scopes: ${context.leftRepoScopes.join('; ') || 'none'}`,
    '',
    `Right (canonical program entity): ${context.rightName} (${context.rightSlug})`,
    `Programs: ${context.rightPrograms.join('; ') || 'none'}`,
    `Repo scopes: ${context.rightRepoScopes.join('; ') || 'none'}`,
    '',
    `Fuzzy similarity score: ${context.similarity.toFixed(3)}`,
  ].join('\n');

  const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Respond with a single JSON object. No markdown.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;

  const parsed = MergeVerdictSchema.safeParse(extractJsonObject(content));
  return parsed.success ? parsed.data : null;
}

export function llmConfigured(): boolean {
  return envConfig() !== null;
}
