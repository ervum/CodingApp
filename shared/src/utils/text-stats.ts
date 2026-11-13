// text-stats.ts — used by backend (stored counts) AND frontend (live telemetry); identical results guaranteed.
const FENCE = /```[\s\S]*?```/g;
export function countWords(markdown: string): number {
  const prose = markdown.replace(FENCE, (block) => block.replace(/[^\s]+/g, 'w')); // code tokens count as words
  const m = prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-_]*/gu);
  return m ? m.length : 0;
}
export function countChars(markdown: string): number { return [...markdown].length; } // code points, not UTF-16 units
export function estimateTokens(text: string): number { return Math.ceil(countChars(text) / 4); }
