// blockrun.js：按处理预算处理事件，用尽压账；close 把账做完
import { spotOf, lowestFree, newTop } from "./blockmap.js";

function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function cloneState(state) {
  const source = state || {};
  return {
    map: (source.map || []).map((row) => [row[0], row[1]]),
    free: (source.free || []).slice(),
    bad: (source.bad || []).slice(),
    pending: (source.pending || []).slice(),
    moves: source.moves || 0,
    ledger: (source.ledger || []).map((entry) => {
      const copy = [entry[0], entry[1]];
      if (entry.eventId !== undefined) copy.eventId = entry.eventId;
      return copy;
    }),
    applied: (source.applied || []).slice()
  };
}

function insertSorted(list, value) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, value);
}

function insertMapRow(map, logical, physical) {
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid][0] < logical) lo = mid + 1;
    else hi = mid;
  }
  map.splice(lo, 0, [logical, physical]);
}

function tagEntry(entry, eventId) {
  if (eventId !== undefined && eventId !== null) {
    Object.defineProperty(entry, "eventId", {
      value: eventId, enumerable: false, configurable: true, writable: true
    });
  }
  return entry;
}

// 结构与取值校验：返回 [kind, 数值]；不合法按优先级抛对应错误码
function classify(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw codeError("E_BAD_EVENT");
  }
  if (event.kind === "grow") {
    if (!isPositiveInteger(event.count)) throw codeError("E_BAD_COUNT");
    return ["grow", event.count];
  }
  if (event.kind === "use") {
    if (!isPositiveInteger(event.logical)) throw codeError("E_BAD_LOGICAL");
    return ["use", event.logical];
  }
  if (event.kind === "bad") {
    if (!isPositiveInteger(event.physical)) throw codeError("E_BAD_PHYS");
    return ["bad", event.physical];
  }
  throw codeError("E_BAD_EVENT");
}

function codeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// 用空闲池最小块，按待修顺序依次修好前面的逻辑块
function repairPending(state) {
  while (state.pending.length > 0 && state.free.length > 0) {
    const logical = state.pending[0];
    if (spotOf(state.map, logical) !== 0) {
      state.pending.shift();
      continue;
    }
    const physical = lowestFree(state.free);
    state.free.shift();
    state.pending.shift();
    insertMapRow(state.map, logical, physical);
  }
}

// 应用一条已通过结构校验的请求；语义错误（撞表）同样抛码
function applyRequest(state, kind, value) {
  if (kind === "grow") {
    const next = newTop(state.map, state.bad, state.free);
    for (let i = 0; i < value; i += 1) {
      insertSorted(state.free, next + i);
    }
    repairPending(state);
    return;
  }
  if (kind === "use") {
    const logical = value;
    if (spotOf(state.map, logical) !== 0) throw codeError("E_DUP_USE");
    if (state.free.length > 0) {
      const physical = lowestFree(state.free);
      state.free.shift();
      insertMapRow(state.map, logical, physical);
    } else {
      if (state.pending.indexOf(logical) === -1) state.pending.push(logical);
    }
    return;
  }
  // kind === "bad"
  const physical = value;
  const usedIndex = state.map.findIndex((row) => row[1] === physical);
  const freeIndex = state.free.indexOf(physical);
  if (usedIndex === -1 && freeIndex === -1) throw codeError("E_NO_BLOCK");
  if (freeIndex !== -1) {
    state.free.splice(freeIndex, 1);
  } else {
    const logical = state.map[usedIndex][0];
    state.map.splice(usedIndex, 1);
    if (state.free.length > 0) {
      const replacement = lowestFree(state.free);
      state.free.shift();
      insertMapRow(state.map, logical, replacement);
    } else {
      if (state.pending.indexOf(logical) === -1) state.pending.push(logical);
    }
    state.moves += 1;
  }
  insertSorted(state.bad, physical);
}

function enqueue(state, kind, value, eventId) {
  state.ledger.push(tagEntry([kind, value], eventId));
}

export function step(spec) {
  const state = cloneState(spec.state);
  const events = Array.isArray(spec.events) ? spec.events : [];
  let budget = Number.isInteger(spec.budget) ? spec.budget : Math.floor(spec.budget) || 0;
  if (budget < 0) budget = 0;

  const workTotal = state.ledger.length + events.length;
  let served = 0;

  // 先清旧账（FIFO）
  while (budget > 0 && state.ledger.length > 0) {
    const entry = state.ledger.shift();
    if (entry.eventId !== undefined && state.applied.indexOf(entry.eventId) !== -1) {
      continue;
    }
    let kind;
    let value;
    try {
      [kind, value] = classify({ id: entry.eventId, kind: entry[0], count: entry[0] === "grow" ? entry[1] : undefined,
        logical: entry[0] === "use" ? entry[1] : undefined, physical: entry[0] === "bad" ? entry[1] : undefined });
    } catch (error) {
      state.ledger.unshift(entry);
      throw error;
    }
    applyRequest(state, kind, value);
    if (entry.eventId !== undefined && state.applied.indexOf(entry.eventId) === -1) {
      state.applied.push(entry.eventId);
    }
    served += 1;
    budget -= 1;
  }

  // 再处理新事件
  let index = 0;
  while (index < events.length) {
    const event = events[index];
    index += 1;
    const eventId = event && typeof event === "object" ? event.id : undefined;
    if (eventId !== undefined && eventId !== null && state.applied.indexOf(eventId) !== -1) {
      continue; // 重放：已处理过，不花预算也不再压账
    }
    if (budget <= 0) {
      // 用尽后：结构/取值仍要判，不合法直接抛；合法的压在账上
      const [kind, value] = classify(event);
      enqueue(state, kind, value, eventId);
      continue;
    }
    const [kind, value] = classify(event);
    applyRequest(state, kind, value);
    if (eventId !== undefined && eventId !== null) state.applied.push(eventId);
    served += 1;
    budget -= 1;
  }

  return {
    state,
    served,
    ledger_before: state.ledger.length,
    ledger: state.ledger,
    judged: served,
    judged_bound: workTotal
  };
}

export function close(spec) {
  const state = cloneState(spec.state);
  let catchup = 0;
  while (state.ledger.length > 0) {
    const entry = state.ledger.shift();
    let kind;
    let value;
    try {
      [kind, value] = classify({ id: entry.eventId, kind: entry[0], count: entry[0] === "grow" ? entry[1] : undefined,
        logical: entry[0] === "use" ? entry[1] : undefined, physical: entry[0] === "bad" ? entry[1] : undefined });
    } catch (error) {
      state.ledger.unshift(entry);
      throw error;
    }
    applyRequest(state, kind, value);
    if (entry.eventId !== undefined && state.applied.indexOf(entry.eventId) === -1) {
      state.applied.push(entry.eventId);
    }
    catchup += 1;
  }
  return { state, catchup };
}
