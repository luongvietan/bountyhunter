import { Prisma, type PrismaClient } from '@kritt-radar/db';

export type MergeDecisionAction = 'approve' | 'reject' | 'reopen';

export type MergeDecisionResult =
  | {
      ok: true;
      action: MergeDecisionAction;
      candidateId: string;
      reportsMoved: number;
      siblingsRejected: number;
    }
  | {
      ok: false;
      code: 'not_found' | 'conflict' | 'not_approvable';
      message: string;
    };

type DecisionInput = {
  candidateId: string;
  action: MergeDecisionAction;
  now?: Date;
};

const MAX_SERIALIZATION_RETRIES = 2;

export function normalizeAuditHintKey(projectHint: string): string {
  return projectHint.trim().toLowerCase();
}

function failure(
  code: 'not_found' | 'conflict' | 'not_approvable',
  message: string,
): MergeDecisionResult {
  return { ok: false, code, message };
}

function isSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

async function approveCandidate(
  tx: Prisma.TransactionClient,
  input: Required<DecisionInput>,
): Promise<MergeDecisionResult> {
  const candidate = await tx.mergeCandidate.findUnique({
    where: { id: input.candidateId },
    include: {
      leftEntity: {
        select: {
          id: true,
          auditReports: { select: { projectHint: true } },
          _count: { select: { programs: true } },
        },
      },
      rightEntity: {
        select: {
          id: true,
          auditReports: { select: { projectHint: true } },
          _count: { select: { programs: true } },
        },
      },
    },
  });

  if (candidate === null) {
    return failure('not_found', 'Merge candidate was not found.');
  }
  if (candidate.status !== 'pending') {
    return failure('conflict', 'Merge candidate is no longer pending.');
  }

  const leftIsProvisional = candidate.leftEntity._count.programs === 0;
  const rightIsProvisional = candidate.rightEntity._count.programs === 0;
  if (leftIsProvisional === rightIsProvisional) {
    return failure('not_approvable', 'Candidate requires exactly one provisional entity.');
  }

  const provisional = leftIsProvisional ? candidate.leftEntity : candidate.rightEntity;
  const canonical = leftIsProvisional ? candidate.rightEntity : candidate.leftEntity;
  if (provisional.auditReports.length === 0) {
    return failure('not_approvable', 'Provisional entity has no audit reports to merge.');
  }

  const aliasKeys = [
    ...new Set(provisional.auditReports.map(({ projectHint }) => normalizeAuditHintKey(projectHint))),
  ];
  if (aliasKeys.some((key) => key.length === 0)) {
    return failure('not_approvable', 'Audit report project hints must not be empty.');
  }

  const existingAliases = await tx.entityAlias.findMany({
    where: { kind: 'audit_hint', key: { in: aliasKeys } },
    select: { entityId: true, key: true },
  });
  if (existingAliases.some((alias) => alias.entityId !== canonical.id)) {
    return failure('conflict', 'An audit hint alias belongs to another entity.');
  }

  const claimed = await tx.mergeCandidate.updateMany({
    where: { id: candidate.id, status: 'pending' },
    data: { status: 'approved', decidedAt: input.now },
  });
  if (claimed.count !== 1) {
    return failure('conflict', 'Merge candidate was decided by another request.');
  }

  const existingKeys = new Set(existingAliases.map((alias) => alias.key));
  for (const key of aliasKeys) {
    if (existingKeys.has(key)) {
      await tx.entityAlias.updateMany({
        where: { kind: 'audit_hint', key, entityId: canonical.id },
        data: { source: 'manual' },
      });
    } else {
      await tx.entityAlias.create({
        data: { entityId: canonical.id, kind: 'audit_hint', key, source: 'manual' },
      });
    }
  }

  const reports = await tx.auditReport.updateMany({
    where: { entityId: provisional.id },
    data: { entityId: canonical.id },
  });
  const siblings = await tx.mergeCandidate.updateMany({
    where: {
      id: { not: candidate.id },
      status: 'pending',
      OR: [{ leftEntityId: provisional.id }, { rightEntityId: provisional.id }],
    },
    data: { status: 'rejected', decidedAt: input.now },
  });

  return {
    ok: true,
    action: 'approve',
    candidateId: candidate.id,
    reportsMoved: reports.count,
    siblingsRejected: siblings.count,
  };
}

async function transitionCandidate(
  tx: Prisma.TransactionClient,
  input: Required<DecisionInput>,
): Promise<MergeDecisionResult> {
  const candidate = await tx.mergeCandidate.findUnique({
    where: { id: input.candidateId },
    include: {
      leftEntity: { select: { id: true } },
      rightEntity: { select: { id: true } },
    },
  });
  if (candidate === null) {
    return failure('not_found', 'Merge candidate was not found.');
  }

  const expectedStatus = input.action === 'reject' ? 'pending' : 'rejected';
  if (candidate.status !== expectedStatus) {
    return failure('conflict', `Merge candidate is no longer ${expectedStatus}.`);
  }

  if (
    input.action === 'reopen' &&
    (candidate.leftEntity === null || candidate.rightEntity === null)
  ) {
    return failure('conflict', 'Merge candidate entities are no longer available.');
  }

  const transitioned = await tx.mergeCandidate.updateMany({
    where: { id: candidate.id, status: expectedStatus },
    data:
      input.action === 'reject'
        ? { status: 'rejected', decidedAt: input.now }
        : { status: 'pending', decidedAt: null },
  });
  if (transitioned.count !== 1) {
    return failure('conflict', 'Merge candidate was decided by another request.');
  }

  return {
    ok: true,
    action: input.action,
    candidateId: candidate.id,
    reportsMoved: 0,
    siblingsRejected: 0,
  };
}

export async function decideMergeCandidate(
  prisma: PrismaClient,
  input: DecisionInput,
): Promise<MergeDecisionResult> {
  const transactionInput: Required<DecisionInput> = {
    ...input,
    now: input.now ?? new Date(),
  };

  for (let retries = 0; ; retries += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          if (transactionInput.action === 'approve') {
            return approveCandidate(tx, transactionInput);
          }
          return transitionCandidate(tx, transactionInput);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isSerializationConflict(error) || retries >= MAX_SERIALIZATION_RETRIES) throw error;
    }
  }
}
