// blockmap.js：逻辑块落点、空闲池最小编号、下一个新块号
export function spotOf(map, logical) {
  for (const row of map) {
    if (row[0] === logical) return row[1];
  }
  return 0;
}

export function lowestFree(free) {
  return free.length > 0 ? free[0] : 0;
}

export function newTop(map, bad, free) {
  let top = 0;
  for (const row of map) {
    if (Number.isInteger(row[1]) && row[1] > top) top = row[1];
  }
  for (const block of bad) {
    if (block > top) top = block;
  }
  for (const block of free) {
    if (block > top) top = block;
  }
  return top + 1;
}
