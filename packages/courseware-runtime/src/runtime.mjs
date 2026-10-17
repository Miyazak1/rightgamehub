import { defineCoursewareModule } from './module-contract.mjs';

const phases = new Set(['created', 'paused', 'running', 'disposed']);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function serializable(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.length <= 10000 && value.every(item => serializable(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 10000 && Object.values(value).every(item => serializable(item, seen));
  seen.delete(value);
  return valid;
}

function checkedState(value, moduleId) {
  if (!serializable(value)) fail('COURSEWARE_MODULE_STATE_INVALID', `Module ${moduleId} returned non-serializable state.`, { moduleId });
  return clone(value);
}

function checkedCommandLog(value, active) {
  if (!Array.isArray(value) || value.length > 10000) fail('COURSEWARE_RUNTIME_COMMAND_LOG_INVALID', 'Runtime command history must be a bounded array.');
  return value.map((command, index) => {
    const definition=command && typeof command === 'object' && !Array.isArray(command) ? active.get(command.moduleId) : null;
    if (!definition || typeof command.name !== 'string' || !definition.manifest.commands.includes(command.name) || !serializable(command.payload)) {
      fail('COURSEWARE_RUNTIME_COMMAND_LOG_INVALID', `Runtime command history entry ${index} is invalid.`, { index });
    }
    return { moduleId:command.moduleId,name:command.name,payload:clone(command.payload) };
  });
}

function dependencyCompatible(dependency, manifest) {
  return manifest.apiVersion === dependency.apiVersion && dependency.capabilities.every(capability => manifest.capabilities.includes(capability));
}

export class CoursewareModuleRegistry {
  #definitions = new Map();
  register(definition) {
    const normalized = defineCoursewareModule(definition);
    const id = normalized.manifest.id;
    if (this.#definitions.has(id)) fail('COURSEWARE_MODULE_DUPLICATE', `Module ${id} is already registered.`, { moduleId: id });
    this.#definitions.set(id, normalized);
    return normalized;
  }
  replace(definition) {
    const normalized = defineCoursewareModule(definition);
    this.#definitions.set(normalized.manifest.id, normalized);
    return normalized;
  }
  get(id) { return this.#definitions.get(id) ?? null; }
  has(id) { return this.#definitions.has(id); }
  list() { return [...this.#definitions.values()].map(item => item.manifest); }
}

export class CoursewareRuntime {
  #registry; #phase = 'created'; #active = new Map(); #states = new Map(); #events = []; #commands = []; #clock; #preferences;
  constructor({ registry = new CoursewareModuleRegistry(), locale = 'zh-CN', theme = 'light', motion = 'system' } = {}) {
    this.#registry = registry;
    this.#clock = { elapsedMs: 0, speed: 1 };
    this.#preferences = { locale, theme, motion };
  }
  get phase() { return this.#phase; }
  get registry() { return this.#registry; }
  get activeModules() { return [...this.#active.values()].map(item => item.manifest); }
  get events() { return clone(this.#events); }
  register(definition) { this.#assertUsable(); return this.#registry.register(definition); }
  #assertUsable() { if (this.#phase === 'disposed') fail('COURSEWARE_RUNTIME_DISPOSED', 'Runtime has been disposed.'); }
  #sessionView() { return Object.freeze({ phase: this.#phase, clock: clone(this.#clock), preferences: clone(this.#preferences), activeModuleIds: Object.freeze([...this.#active.keys()]) }); }
  #context(moduleId) {
    const caller = this.#active.get(moduleId) ?? this.#registry.get(moduleId);
    const accessibleModuleIds = new Set([moduleId, ...(caller?.manifest.dependencies ?? []).map(dependency => dependency.id)]);
    return Object.freeze({
      moduleId,
      dependencies:Object.freeze((caller?.manifest.dependencies ?? []).map(dependency => Object.freeze({ ...dependency,capabilities:Object.freeze([...dependency.capabilities]) }))),
      session: this.#sessionView(),
      observe: (id, query) => {
        if (id !== moduleId) {
          if (!caller?.manifest.dependencies.some(dependency => dependency.id === id)) fail('COURSEWARE_MODULE_ACCESS_DENIED', `Module ${moduleId} did not declare dependency ${id}.`, { moduleId, dependencyId:id });
        }
        return this.observe(id, query);
      },
      replay:Object.freeze({
        snapshot:(ownState) => clone({
          schemaVersion:1,
          phase:this.#phase,
          clock:this.#clock,
          preferences:this.#preferences,
          commands:this.#commands.filter(command => accessibleModuleIds.has(command.moduleId)),
          modules:Object.fromEntries([...this.#active]
            .filter(([id]) => accessibleModuleIds.has(id))
            .map(([id, definition]) => [id, {
              version:definition.manifest.version,
              stateSchemaVersion:definition.manifest.stateSchemaVersion,
              state:id === moduleId && ownState !== undefined ? checkedState(ownState, id) : this.#states.get(id),
            }])),
        }),
        commands:() => clone(this.#commands.filter(command => accessibleModuleIds.has(command.moduleId))),
      }),
    });
  }
  #record(type, moduleId, details = {}) { this.#events.push({ index: this.#events.length, type, moduleId, ...clone(details) }); }
  #resolveOrder(ids) {
    const order = []; const visiting = new Set(); const visited = new Set();
    const visit = id => {
      if (visited.has(id) || this.#active.has(id)) return;
      if (visiting.has(id)) fail('COURSEWARE_MODULE_DEPENDENCY_CYCLE', `Module dependency cycle contains ${id}.`, { moduleId: id });
      const definition = this.#registry.get(id);
      if (!definition) fail('COURSEWARE_MODULE_DEPENDENCY_MISSING', `Module ${id} is not registered.`, { moduleId: id });
      visiting.add(id);
      for (const dependency of definition.manifest.dependencies) {
        const target = this.#active.get(dependency.id) ?? this.#registry.get(dependency.id);
        if (!target) {
          if (dependency.optional) continue;
          fail('COURSEWARE_MODULE_DEPENDENCY_MISSING', `Module ${id} requires ${dependency.id}.`, { moduleId: id, dependencyId: dependency.id });
        }
        if (!dependencyCompatible(dependency, target.manifest)) fail('COURSEWARE_MODULE_DEPENDENCY_INCOMPATIBLE', `Module ${id} has an incompatible dependency on ${dependency.id}.`, { moduleId: id, dependencyId: dependency.id });
        visit(dependency.id);
      }
      visiting.delete(id); visited.add(id); order.push(id);
    };
    ids.forEach(visit); return order;
  }
  activate(ids) {
    this.#assertUsable();
    const requested = typeof ids === 'string' ? [ids] : [...ids];
    for (const id of this.#resolveOrder(requested)) {
      const definition = this.#registry.get(id);
      let state = this.#states.has(id) ? this.#states.get(id) : definition.createState?.(this.#context(id));
      state = checkedState(state ?? {}, id);
      const activated = definition.activate?.({ state: clone(state), context: this.#context(id) });
      if (activated !== undefined) state = checkedState(activated, id);
      this.#states.set(id, state); this.#active.set(id, definition); this.#record('module.activated', id, { version: definition.manifest.version });
    }
    if (this.#phase === 'created') this.#phase = 'paused';
    return this.activeModules;
  }
  start() { this.#assertUsable(); if (this.#phase === 'created') this.#phase = 'paused'; this.#phase = 'running'; this.#record('runtime.started', null); }
  pause() { this.#assertUsable(); if (this.#phase === 'running') { this.#phase = 'paused'; this.#record('runtime.paused', null); } }
  resume() { this.#assertUsable(); if (this.#phase !== 'paused') fail('COURSEWARE_RUNTIME_PHASE_INVALID', 'Only a paused runtime can resume.'); this.#phase = 'running'; this.#record('runtime.resumed', null); }
  advance(milliseconds) {
    this.#assertUsable();
    if (this.#phase !== 'running' || !Number.isFinite(milliseconds) || milliseconds < 0) fail('COURSEWARE_RUNTIME_PHASE_INVALID', 'Clock advances require a running runtime and non-negative duration.');
    this.#clock.elapsedMs += milliseconds * this.#clock.speed; this.#record('runtime.advanced', null, { milliseconds });
  }
  dispatch(moduleId, name, payload = {}) {
    this.#assertUsable();
    const definition = this.#active.get(moduleId);
    if (!definition) fail('COURSEWARE_MODULE_INACTIVE', `Module ${moduleId} is not active.`, { moduleId });
    if (!definition.manifest.commands.includes(name)) fail('COURSEWARE_MODULE_COMMAND_UNSUPPORTED', `Module ${moduleId} does not declare command ${name}.`, { moduleId, command: name });
    if (!serializable(payload)) fail('COURSEWARE_MODULE_COMMAND_INVALID', 'Command payload must be serializable.', { moduleId, command: name });
    if (this.#commands.length >= 10000) fail('COURSEWARE_RUNTIME_COMMAND_LIMIT_EXCEEDED', 'A courseware runtime session cannot contain more than 10,000 commands.');
    const current = clone(this.#states.get(moduleId));
    const next = definition.reduce({ state: current, command: Object.freeze({ name, payload: clone(payload) }), context: this.#context(moduleId) });
    this.#states.set(moduleId, checkedState(next, moduleId));
    this.#commands.push({ moduleId,name,payload:clone(payload) });
    this.#record('module.command', moduleId, { name, payload });
    return clone(this.#states.get(moduleId));
  }
  observe(moduleId, query = null) {
    this.#assertUsable();
    const definition = this.#active.get(moduleId);
    if (!definition) fail('COURSEWARE_MODULE_INACTIVE', `Module ${moduleId} is not active.`, { moduleId });
    const state = clone(this.#states.get(moduleId));
    return clone(definition.observe ? definition.observe({ state, query: clone(query), context: this.#context(moduleId) }) : state);
  }
  deactivate(moduleId) {
    this.#assertUsable();
    const definition = this.#active.get(moduleId);
    if (!definition) return false;
    const dependent = [...this.#active.values()].find(item => item.manifest.dependencies.some(dependency => !dependency.optional && dependency.id === moduleId));
    if (dependent) fail('COURSEWARE_MODULE_DEPENDENT_ACTIVE', `Module ${moduleId} is required by ${dependent.manifest.id}.`, { moduleId, dependentId: dependent.manifest.id });
    definition.deactivate?.({ state: clone(this.#states.get(moduleId)), context: this.#context(moduleId) });
    this.#active.delete(moduleId); this.#commands = this.#commands.filter(command => command.moduleId !== moduleId); this.#record('module.deactivated', moduleId, { version: definition.manifest.version }); return true;
  }
  swap(definition) {
    this.#assertUsable();
    const next = defineCoursewareModule(definition); const id = next.manifest.id; const current = this.#active.get(id);
    if (!current) { this.#registry.replace(next); this.activate(id); return { moduleId: id, fromVersion: null, toVersion: next.manifest.version }; }
    if (current.manifest.kind !== next.manifest.kind) fail('COURSEWARE_MODULE_SWAP_INCOMPATIBLE', 'Hot swap cannot change module kind.', { moduleId: id });
    if (next.manifest.hotSwap === 'session') fail('COURSEWARE_MODULE_RESTART_REQUIRED', `Module ${id} requires a new session.`, { moduleId: id });
    if (next.manifest.hotSwap === 'paused' && this.#phase !== 'paused') fail('COURSEWARE_MODULE_PAUSE_REQUIRED', `Module ${id} can only be swapped while paused.`, { moduleId: id });
    for (const dependent of this.#active.values()) {
      const requirement = dependent.manifest.dependencies.find(item => item.id === id);
      if (requirement && !dependencyCompatible(requirement, next.manifest)) fail('COURSEWARE_MODULE_DEPENDENCY_INCOMPATIBLE', `Hot swap would break ${dependent.manifest.id}.`, { moduleId: id, dependentId: dependent.manifest.id });
    }
    let state = clone(this.#states.get(id));
    if (current.manifest.stateSchemaVersion !== next.manifest.stateSchemaVersion) {
      if (!next.migrateState) fail('COURSEWARE_MODULE_STATE_MIGRATION_REQUIRED', `Module ${id} must migrate state schema ${current.manifest.stateSchemaVersion} to ${next.manifest.stateSchemaVersion}.`, { moduleId: id });
      state = next.migrateState({ state, from: current.manifest.stateSchemaVersion, to: next.manifest.stateSchemaVersion, context: this.#context(id) });
    }
    state = checkedState(state, id);
    current.deactivate?.({ state: clone(this.#states.get(id)), context: this.#context(id) });
    const activated = next.activate?.({ state: clone(state), context: this.#context(id) });
    if (activated !== undefined) state = checkedState(activated, id);
    this.#registry.replace(next); this.#active.set(id, next); this.#states.set(id, state);
    const supportedCommands = new Set(next.manifest.commands);
    this.#commands = this.#commands.filter(command => command.moduleId !== id || supportedCommands.has(command.name));
    this.#record('module.swapped', id, { fromVersion: current.manifest.version, toVersion: next.manifest.version });
    return { moduleId: id, fromVersion: current.manifest.version, toVersion: next.manifest.version };
  }
  snapshot() {
    this.#assertUsable();
    return clone({
      schemaVersion: 1,
      phase: this.#phase,
      clock: this.#clock,
      preferences: this.#preferences,
      commands: this.#commands,
      modules: Object.fromEntries([...this.#active].map(([id, definition]) => [id, { version: definition.manifest.version, stateSchemaVersion: definition.manifest.stateSchemaVersion, state: this.#states.get(id) }])),
    });
  }
  restore(snapshot) {
    this.#assertUsable();
    if (this.#phase === 'running') fail('COURSEWARE_MODULE_PAUSE_REQUIRED', 'Pause before restoring a snapshot.');
    if (!snapshot || snapshot.schemaVersion !== 1 || !phases.has(snapshot.phase) || !serializable(snapshot)) fail('COURSEWARE_RUNTIME_SNAPSHOT_INVALID', 'Snapshot is invalid.');
    const ids = Object.keys(snapshot.modules ?? {});
    if (ids.length !== this.#active.size || ids.some(id => !this.#active.has(id))) fail('COURSEWARE_RUNTIME_SNAPSHOT_INCOMPATIBLE', 'Snapshot module set differs from the active module set.');
    const restored = new Map();
    for (const id of ids) {
      const manifest = this.#active.get(id).manifest; const record = snapshot.modules[id];
      if (record.version !== manifest.version || record.stateSchemaVersion !== manifest.stateSchemaVersion) fail('COURSEWARE_RUNTIME_SNAPSHOT_INCOMPATIBLE', `Snapshot does not match module ${id}.`, { moduleId: id });
      restored.set(id, checkedState(record.state, id));
    }
    const restoredCommands=checkedCommandLog(snapshot.commands ?? [],this.#active);
    this.#states = restored; this.#clock = clone(snapshot.clock); this.#preferences = clone(snapshot.preferences); this.#commands = restoredCommands; this.#phase = snapshot.phase === 'running' ? 'paused' : snapshot.phase;
    this.#record('runtime.restored', null); return this.snapshot();
  }
  dispose() {
    if (this.#phase === 'disposed') return;
    for (const [id, definition] of [...this.#active].reverse()) {
      definition.deactivate?.({ state: clone(this.#states.get(id)), context: this.#context(id) });
      definition.dispose?.({ state: clone(this.#states.get(id)), context: this.#context(id) });
    }
    this.#active.clear(); this.#states.clear(); this.#phase = 'disposed';
  }
}
