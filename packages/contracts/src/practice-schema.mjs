const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const text = { type: 'string', minLength: 1, maxLength: 128 }, integer = { type: 'integer', minimum: 0 };
const uuid = { type: 'string', format: 'uuid' }, bool = { type: 'boolean' };
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const ref = name => ({ $ref: '#/components/schemas/' + name });
const list = items => ({ type: 'array', items });
const localized = obj({ 'zh-CN': { type: 'string' }, en: { type: 'string' } });
const option = obj({ id: text, text: { type: 'string' } });
export const practiceParams = obj({ id: uuid });
export const practiceCatalogQuery = obj({ subjectId: text, stageId: text, curriculumId: text, difficultyId: text }, []);
export const practiceStartSchema = obj({
  subjectId: text, curriculumId: text, topicId: text, stageId: nullable(text),
  difficultyId: { type: 'string', enum: ['basic','medium','hard'] }, count: { type: 'integer', enum: [3,5,10] },
  language: { type: 'string', enum: ['zh','en'] },
}, ['subjectId','curriculumId','topicId','difficultyId','count','language']);
export const practiceUpdateSchema = obj({ action: { type: 'string', enum: ['save','check','submit'] },
  expectedRevision: { type: 'integer', minimum: 1 }, questionId: text, answer: { type: 'string', minLength: 1, maxLength: 32 },
  elapsedSeconds: { type: 'integer', minimum: 0, maximum: 86400 }, currentIndex: { type: 'integer', minimum: 0, maximum: 9 },
}, ['action','expectedRevision']);
const batch = { id: uuid, previousId: nullable(uuid), config: ref('PracticeStart'),
  status: { type: 'string', enum: ['queued','preparing','ready','completed','failed'] },
  createdAt: { type: 'string', format: 'date-time' }, completedAt: nullable({ type: 'string', format: 'date-time' }),
  answered: integer, total: integer, correct: integer };
const batchRequired = Object.keys(batch).filter(k => k !== 'correct');
export const practiceSchemas = {
  PracticeStart: practiceStartSchema,
  PracticeUpdate: practiceUpdateSchema,
  PracticeQuestion: obj({ id: text, version: text, prompt: { type: 'string' }, options: list(option),
    answer: nullable(text), checked: bool, elapsedSeconds: integer,
    figure: nullable(obj({ svg: { type: 'string' }, caption: { type: 'string' } })),
    correctAnswer: text, explanation: { type: 'string' }, correct: bool,
  }, ['id','version','prompt','options','answer','checked','elapsedSeconds','figure']),
  PracticeBatchSummary: obj(batch, batchRequired),
  PracticeBatch: obj({ ...batch, revision: integer, currentIndex: integer, errorCode: nullable(text), items: list(ref('PracticeQuestion')) }, [...batchRequired,'revision','currentIndex','errorCode','items']),
  PracticeCatalog: obj({ schemaVersion: integer,
    subjects: list(obj({ id: text, title: localized })), stages: list(obj({ id: text, title: localized })), difficulties: list(obj({ id: text, title: localized })),
    curricula: list(obj({ id: text, subjectId: text, stageIds: list(text), title: localized, version: text })),
    topics: list(obj({ id: text, subjectId: text, curriculumId: text, stageIds: list(text), parentId: text, title: localized, questionTypes: list(text), difficultyIds: list(text) })),
    ready: bool, code: nullable(text), engineVersion: text, questionTypes: list(text), stageMappingReviewed: bool,
    capabilities: obj({ generation: bool, independentAssessment: bool, stepGrading: bool }),
  }),
  PracticeHistory: obj({ batches: list(ref('PracticeBatchSummary')),
    topics: list(obj({ topicId: text, attempted: integer, correct: integer })),
    wrong: list(obj({ batchId: uuid, config: ref('PracticeStart'), question: ref('PracticeQuestion') })),
  }),
};
const route = (method, path, operationId, response, extra = {}) => ({ method, path, operationId, response, auth: 'bearer', ...extra });
const key = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', pattern: '^[a-zA-Z0-9:_-]{8,128}$' } };
export const practiceRoutes = [
  route('get','/v1/learning/practice/catalog','getPracticeCatalog','PracticeCatalog',{ auth: 'anonymous', parameters: Object.keys(practiceCatalogQuery.properties).map(name => ({ name, in: 'query', schema: text })) }),
  route('get','/v1/me/practice','listPracticeHistory','PracticeHistory'),
  route('post','/v1/me/practice','startPractice','PracticeBatch',{ request: 'PracticeStart', parameters: [key] }),
  route('get','/v1/me/practice/{id}','getPractice','PracticeBatch',{ pathId: 'id' }),
  route('patch','/v1/me/practice/{id}','updatePractice','PracticeBatch',{ pathId: 'id', request: 'PracticeUpdate' }),
  route('post','/v1/me/practice/{id}/continue','continuePractice','PracticeBatch',{ pathId: 'id', parameters: [key] }),
  route('post','/v1/me/practice/{id}/retry','retryPractice','PracticeBatch',{ pathId: 'id' }),
];
