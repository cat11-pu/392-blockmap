// blockrun.js：按处理预算处理事件，用尽预算后压账；收尾把账做完
import { spotOf, lowestFree, newTop } from "./blockmap.js";

const DEFAULT_CODES = {
  bad_logical_code: "E_BAD_LOGICAL",
  bad_phys_code: "E_BAD_PHYS",
  bad_count_code: "E_BAD_COUNT",
  dup_use_code: "E_DUP_USE",
  no_block_code: "E_NO_BLOCK",
  event_error_code: "E_BAD_EVENT"
};

function code(spec, name) {
  const value = spec[name];
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_CODES[name];
}

function fail(spec, name, message) {
  const error = new Error(message);
  error.code = code(spec, name);
  throw error;
}

function isPosInt(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function cloneState(state) {
  state = state || {};
  return {
    map: (state.map || []).map((row) => [row[0], row[1]]),
    free: (state.free || []).slice(),
    bad: (state.bad || []).slice(),
    pending: (state.pending || []).slice(),
    moves: state.moves || 0,
    ledger: (state.ledger || []).slice(),
    applied: (state.applied || []).slice()
  };
}

function insertSorted(list, value) {
  let at = 0;
  while (at < list.length && list[at] < value) at += 1;
  list.splice(at, 0, value);
}

function insertMapRow(map, logical, physical) {
  let at = 0;
  while (at < map.length && map[at][0] < logical) at += 1;
  map.splice(at, 0, [logical, physical]);
}

// 账上一条记录压缩成 [kind, 编号]，id 作为不可枚举属性带着走（JSON/指纹看不见）
function toTuple(event) {
  let kind;
  let number;
  if (event && typeof event === "object" && !Array.isArray(event)) {
    kind = event.kind;
    number = kind === "grow" ? event.count
      : kind === "use" ? event.logical
      : kind === "bad" ? event.physical
      : undefined;
  }
  const tuple = [kind, number];
  if (event && typeof event === "object" && event.id !== undefined && event.id !== null) {
    Object.defineProperty(tuple, "__id", { value: event.id });
  }
  return tuple;
}

function itemId(item) {
  return Object.prototype.hasOwnProperty.call(item, "__id") ? item.__id : undefined;
}

// 校验事件（账上条目先还原成事件对象再判），不合法直接抛对应报码
function validate(spec, item, fromLedger) {
  let event;
  if (fromLedger) {
    event = { id: itemId(item), kind: item[0] };
    if (event.kind === "grow") event.count = item[1];
    else if (event.kind === "use") event.logical = item[1];
    else if (event.kind === "bad") event.physical = item[1];
  } else {
    event = item;
  }
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    fail(spec, "event_error_code", "事件必须是对象");
  }
  if (event.kind !== "grow" && event.kind !== "use" && event.kind !== "bad") {
    fail(spec, "event_error_code", "事件类型不合法");
  }
  if (event.kind === "grow" && !isPosInt(event.count)) {
    fail(spec, "bad_count_code", "扩容个数必须是正整数");
  }
  if (event.kind === "use" && !isPosInt(event.logical)) {
    fail(spec, "bad_logical_code", "逻辑块号必须是正整数");
  }
  if (event.kind === "bad" && !isPosInt(event.physical)) {
    fail(spec, "bad_phys_code", "物理块号必须是正整数");
  }
  return event;
}

// 待修清单靠前的逻辑块依次拿空闲块修好
function repairPending(state) {
  while (state.pending.length > 0 && state.free.length > 0) {
    const logical = state.pending[0];
    if (spotOf(state.map, logical) !== 0) {
      state.pending.shift();
      continue;
    }
    const physical = state.free.shift();
    insertMapRow(state.map, logical, physical);
    state.pending.shift();
  }
}

// 对当前状态施加一条已校验事件
function applyEvent(state, spec, event) {
  if (event.kind === "grow") {
    let top = newTop(state.map, state.bad, state.free);
    for (let i = 0; i < event.count; i += 1) {
      state.free.push(top + i);
    }
    repairPending(state);
    return;
  }
  if (event.kind === "use") {
    if (spotOf(state.map, event.logical) !== 0) {
      fail(spec, "dup_use_code", "逻辑块已有映射");
    }
    const at = state.pending.indexOf(event.logical);
    if (at >= 0) state.pending.splice(at, 1);
    if (state.free.length > 0) {
      insertMapRow(state.map, event.logical, state.free.shift());
    } else {
      state.pending.push(event.logical);
    }
    return;
  }
  // bad
  let mappedAt = -1;
  for (let i = 0; i < state.map.length; i += 1) {
    if (state.map[i][1] === event.physical) { mappedAt = i; break; }
  }
  const freeAt = state.free.indexOf(event.physical);
  if (mappedAt < 0 && freeAt < 0) {
    fail(spec, "no_block_code", "坏块事件指向既不在用也不在空闲池的块");
  }
  if (freeAt >= 0) {
    state.free.splice(freeAt, 1);
  }
  if (mappedAt >= 0) {
    const logical = state.map[mappedAt][0];
    state.map.splice(mappedAt, 1);
    if (state.free.length > 0) {
      insertMapRow(state.map, logical, state.free.shift());
    } else {
      state.pending.push(logical);
    }
    state.moves += 1;
  }
  insertSorted(state.bad, event.physical);
}

export function step(spec) {
  const state = cloneState(spec.state);
  const events = Array.isArray(spec.events) ? spec.events : [];
  let budget = Number.isFinite(spec.budget) ? Math.max(0, Math.trunc(spec.budget)) : 0;
  const bound = state.ledger.length + events.length;
  let served = 0;
  const appliedSet = new Set(state.applied);
  const queuedIds = new Set(state.ledger.map(itemId));

  // 阶段一：先还账（FIFO），受预算限制
  let at = 0;
  while (at < state.ledger.length) {
    const item = state.ledger[at];
    const id = itemId(item);
    if (id !== undefined && appliedSet.has(id)) {
      state.ledger.splice(at, 1);
      continue;
    }
    if (budget <= 0) { at += 1; continue; }
    const event = validate(spec, item, true);
    budget -= 1;
    state.ledger.splice(at, 1);
    applyEvent(state, spec, event);
    if (id !== undefined) { state.applied.push(id); appliedSet.add(id); }
    served += 1;
  }

  // 阶段二：再扫新事件，预算用尽就压账（同 id 不重复记）
  for (const item of events) {
    const id = item && typeof item === "object" ? item.id : undefined;
    if (id !== undefined && appliedSet.has(id)) continue;
    if (budget > 0) {
      const event = validate(spec, item, false);
      budget -= 1;
      applyEvent(state, spec, event);
      if (id !== undefined) { state.applied.push(id); appliedSet.add(id); }
      served += 1;
    } else if (id === undefined || !queuedIds.has(id)) {
      state.ledger.push(toTuple(item));
      if (id !== undefined) queuedIds.add(id);
    }
  }

  return {
    state,
    served,
    ledger_before: state.ledger.length,
    ledger: state.ledger.slice(),
    judged: served,
    judged_bound: bound
  };
}

export function close(spec) {
  const state = cloneState(spec.state);
  let catchup = 0;
  const appliedSet = new Set(state.applied);

  // 把账做完，不再受预算限制
  while (state.ledger.length > 0) {
    const item = state.ledger.shift();
    const id = itemId(item);
    if (id !== undefined && appliedSet.has(id)) continue;
    const event = validate(spec, item, true);
    applyEvent(state, spec, event);
    if (id !== undefined) { state.applied.push(id); appliedSet.add(id); }
    catchup += 1;
  }

  return { state, catchup };
}
