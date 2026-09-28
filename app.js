// app.js：渲染结果
import { spotOf, lowestFree, newTop } from "./blockmap.js";
import { step, close } from "./blockrun.js";

export function render(spec) {
  const events = spec.events || [];
  const half = Math.ceil(events.length / 2);
  const first = step(spec);
  const closed = close(Object.assign({}, spec, { state: first.state }));
  const r1 = step(Object.assign({}, spec, { events: events.slice(0, half) }));
  const r2 = step(Object.assign({}, spec, { state: r1.state, events: events.slice(half) }));
  const closedTwo = close(Object.assign({}, spec, { state: r2.state }));
  const replay = step(Object.assign({}, spec, { state: closed.state }));
  const wide = step(Object.assign({}, spec, { budget: spec.budget + 2 }));
  const full = step(Object.assign({}, spec, { events: events, budget: events.length + 2 }));
  const fullClosed = close(Object.assign({}, spec, { state: full.state }));
  const fingerprint = function (state) {
    return JSON.stringify({
      map: state.map, free: state.free, bad: state.bad, pending: state.pending,
      moves: state.moves, ledger: state.ledger, applied: state.applied.length
    });
  };
  return { map: closed.state.map.map(function (row) { return [row[0], row[1]]; }),
           free: closed.state.free.slice(),
           bad: closed.state.bad.slice(),
           pending: closed.state.pending.slice(),
           moves: closed.state.moves,
           served_first: first.served, served_wide: wide.served,
           pair_differs: first.served !== wide.served,
           ledger_before: first.ledger_before, ledger: first.ledger,
           catchup: closed.catchup, ledger_after: closed.state.ledger.length,
           mid_differs: fingerprint(r2.state) !== fingerprint(first.state),
           closed_equal: fingerprint(closedTwo.state) === fingerprint(closed.state),
           replay_new: replay.served, judged: first.judged, judged_bound: first.judged_bound,
           full_diff: fingerprint(closed.state) === fingerprint(fullClosed.state) ? 0 : 1,
           count_events: events.length,
           tail: spotOf([[5, 1]], 5) + lowestFree([4, 9]) + newTop([[5, 1]], [3], []) };
}
