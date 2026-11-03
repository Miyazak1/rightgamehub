import { decodePaperStudyInput } from './paper-study-input.mjs';
import { persistentPaperView, paperStudyError } from './paper-study-persistent-repository.mjs';
const actorId = actor => { if(!actor?.userId)throw paperStudyError('AUTH_REQUIRED',401);return actor.userId; };
export function createPersistentPaperStudyService({ repository, executionAgentUserId, signals, allowOfflineFixtures = false }) {
  return {
    async list(actor) { return (await repository.list(actorId(actor))).map(persistentPaperView); },
    async read(actor,id) { return persistentPaperView(await repository.read(actorId(actor),id)); },
    async source(actor,id) { return {pdfBase64:(await repository.source(actorId(actor),id)).toString('base64')}; },
    async import(actor,input) {
      const owner=actorId(actor),bytes=decodePaperStudyInput(input);await signals.check(owner);
      const row=await repository.import(owner,input,bytes,executionAgentUserId);await signals.notify(row.id);return persistentPaperView(row);
    },
    async analyze(actor,id) {
      const owner=actorId(actor);await repository.read(owner,id);
      if(!allowOfflineFixtures)throw paperStudyError('PAPER_STUDY_MODELS_DISABLED');
      await signals.check(owner);await repository.enqueue(owner,id,'analyze',executionAgentUserId);await signals.notify(id);return this.read(actor,id);
    },
    async draft(actor,id) {
      const owner=actorId(actor);await repository.read(owner,id);
      if(!allowOfflineFixtures)throw paperStudyError('PAPER_STUDY_MODELS_DISABLED');
      await signals.check(owner);await repository.enqueue(owner,id,'draft',executionAgentUserId);await signals.notify(id);return this.read(actor,id);
    },
    async ready() { return signals.ready(); },
  };
}
