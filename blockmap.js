// blockmap.js：逻辑块落点、空闲池最小编号、下一个新块号
export function spotOf(map, logical) {
  for (const row of map) {
    if (row[0] === logical) return row[1];
  }
  return 0;
}

export function lowestFree(free) {
  return free.length ? free[0] : 0;
}

export function newTop(map, bad, free) {
  let top = 0;
  for (const row of map) {
    if (Number.isInteger(row[1]) && row[1] > top) top = row[1];
  }
  for (const physical of bad) {
    if (physical > top) top = physical;
  }
  for (const physical of free) {
    if (physical > top) top = physical;
  }
  return top + 1;
}
