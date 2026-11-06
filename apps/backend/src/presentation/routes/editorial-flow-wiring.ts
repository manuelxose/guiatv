/**
 * M14-R7 — Cableado del Observatorio editorial.
 *
 * Construye el controlador con los servicios que YA existen (generación, libro de
 * ejecución, proceso del runner, política editorial) y con el `BlogController`
 * real de la aplicación, para que la publicación manual use su misma ruta y su
 * misma invalidación de caché.
 */

import { EditorialFlowDiagnostics } from '../../application/services/EditorialFlowDiagnostics';
import { EditorialEvidenceRecovery } from '../../application/services/EditorialEvidenceRecovery';
import { EditorialFlowPublicationService } from '../../application/services/EditorialFlowPublication';
import { EditorialGenerationService } from '../../application/services/EditorialGenerationService';
import { EditorialJobLedger } from '../../application/services/EditorialJobLedger';
import { EditorialRunnerService } from '../../application/services/EditorialRunnerService';
import {
  MongoEditorialFlowAudit,
  MongoEditorialFlowPublicationStore,
  MongoEditorialFlowRead,
} from '../../infrastructure/database/EditorialFlowRepository';
import { BlogPublicationGateway } from '../controllers/BlogPublicationGateway';
import { EditorialFlowController } from '../controllers/EditorialFlowController';
import { editorialPolicyState } from '../controllers/EditorialOpsController';
import type { BlogController } from '../controllers/BlogController';

export function buildEditorialFlowController(blogController: BlogController): EditorialFlowController {
  const read = new MongoEditorialFlowRead();
  const audit = new MongoEditorialFlowAudit();
  const diagnostics = new EditorialFlowDiagnostics({ read });
  const generation = new EditorialGenerationService();
  const ledger = new EditorialJobLedger();
  const runnerProcess = new EditorialRunnerService();

  const recovery = new EditorialEvidenceRecovery({
    read,
    audit,
    topic: (topicId) => diagnostics.topic(topicId),
    generate: {
      createRequest: (kind, input, actor) => generation.createRequest(kind, input, actor),
      createQueueAction: (input, actor) => generation.createQueueAction(input, actor),
    },
    ledger: {
      retry: (jobId, actor) => ledger.retry(jobId, actor),
      archive: (jobId, actor) => ledger.archive(jobId, actor),
    },
  });

  const publication = new EditorialFlowPublicationService({
    gateway: new BlogPublicationGateway(blogController),
    store: new MongoEditorialFlowPublicationStore(),
    audit,
  });

  return new EditorialFlowController({
    diagnostics,
    recovery,
    publication,
    policy: editorialPolicyState,
    operations: () => generation.operationalState(),
    runnerProcess: () => runnerProcess.state(),
  });
}
