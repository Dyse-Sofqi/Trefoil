let counter = 0;

/** 生成短 id（足够白板内唯一） */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1296;
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}${rnd}${counter.toString(36)}`;
}
