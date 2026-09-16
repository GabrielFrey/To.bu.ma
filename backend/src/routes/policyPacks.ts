import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { writeAudit } from '../services/audit.js';
import {
  exportPolicyPack,
  getBuiltinPack,
  importPolicyPack,
  listBuiltinPacks,
  parsePolicyPack,
} from '../services/policyPacks.js';
import { forecastRun } from '../services/runForecast.js';
import { simulatePolicies } from '../services/policySimulation.js';
import { assertScopeOwnership } from '../services/scopeGuard.js';
import { actor, orgId } from './context.js';
import { policyActionSchema, scopeSchema } from './schemas.js';

const importSchema = z.object({
  packId: z.string().optional(),
  pack: z.unknown().optional(),
  scopeBindings: scopeSchema.extend({ organizationId: z.string().optional() }).optional(),
});

export async function registerPolicyPackRoutes(v1: FastifyInstance) {
  v1.get('/policy-packs', async () => listBuiltinPacks());
  v1.get('/policy-packs/export', async (req) => exportPolicyPack(orgId(req)));

  v1.get('/policy-packs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pack = getBuiltinPack(id);
    if (!pack) return reply.code(404).send({ error: 'policy pack not found' });
    return pack;
  });

  v1.post('/policy-packs/import', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = importSchema.parse(req.body);
    const raw = body.pack ?? (body.packId ? getBuiltinPack(body.packId) : undefined);
    if (!raw) return reply.code(400).send({ error: 'pack or packId required' });
    let pack;
    try {
      pack = parsePolicyPack(raw);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const organizationId = orgId(req);
    // Scope bindings name real entities in this tenant; validate before binding.
    if (body.scopeBindings) await assertScopeOwnership(organizationId, body.scopeBindings);
    const result = await importPolicyPack({ organizationId, pack, scopeBindings: body.scopeBindings });
    await writeAudit({
      organizationId,
      actor: actor(req),
      action: 'policy_pack.import',
      target: pack.id,
      metadata: {
        packName: pack.name,
        budgetsCreated: result.budgetsCreated,
        policiesCreated: result.policiesCreated,
      },
    });
    return reply.code(201).send({ ...result, packId: pack.id, packName: pack.name });
  });

  // ---- Run-level forecast ----
  v1.post('/forecast/run', async (req, reply) => {
    const body = z
      .object({
        model: z.string(),
        estimatedSteps: z.number().int().positive().max(10_000),
        avgPromptTokens: z.number().int().min(0),
        avgCompletionTokens: z.number().int().min(0),
        toolCallsPerStep: z.number().int().min(0).optional(),
        avgToolTokens: z.number().int().min(0).optional(),
        scope: scopeSchema.optional(),
      })
      .parse(req.body);
    const chain = await assertScopeOwnership(orgId(req), body.scope);
    return reply.send(await forecastRun({ chain, ...body }));
  });

  // ---- Policy simulation / dry-run ----
  v1.post('/policies/simulate', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = z
      .object({
        budgetId: z.string().optional(),
        hypotheticalPolicies: z.array(
          z.object({
            name: z.string(),
            condition: z.string(),
            action: policyActionSchema,
            priority: z.number().int().optional(),
            params: z.record(z.unknown()).optional(),
          })
        ),
        lookbackHours: z.number().int().positive().optional(),
        sampleLimit: z.number().int().positive().max(5000).optional(),
      })
      .parse(req.body);
    return reply.send(
      await simulatePolicies({
        organizationId: orgId(req),
        budgetId: body.budgetId,
        hypotheticalPolicies: body.hypotheticalPolicies,
        lookbackHours: body.lookbackHours,
        sampleLimit: body.sampleLimit,
      })
    );
  });
}
