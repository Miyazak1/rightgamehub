import { createIsolatedAccountApi } from './account-api-fixture.mjs';
import { createPaperStudyMemoryRepository, createPaperStudyService } from '../../apps/api/src/paper-study-service.mjs';
import { createPaperStudyHttpHandler } from '../../apps/api/src/paper-study-routes.mjs';
import { createPaperStudyPipelineReplayProcessor } from './paper-study-replay.mjs';

export async function createPaperStudyApiFixture({ processor, mode = 'isolated-replay', onMail } = {}) {
  const repository = createPaperStudyMemoryRepository();
  const service = createPaperStudyService({ repository, processor: processor ?? await createPaperStudyPipelineReplayProcessor(), mode });
  const backend = await createIsolatedAccountApi({ onMail, handleBusinessRequest: (req, res, url, authenticate) => createPaperStudyHttpHandler({ service, authenticate })(req, res, url) });
  return { ...backend, repository, service };
}
