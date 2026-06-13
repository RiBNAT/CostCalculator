/** Stable pastel color pair for a category name (chip background / text). */
export function categoryColor(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { bg: `hsl(${hue}, 75%, 93%)`, fg: `hsl(${hue}, 65%, 32%)` };
}
