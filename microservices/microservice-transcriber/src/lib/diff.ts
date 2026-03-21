/**
 * Simple word-level diff for comparing two transcripts.
 */

export interface DiffEntry {
  type: "equal" | "added" | "removed";
  text: string;
}

/**
 * Compute a word-level diff between two texts.
 * Uses a simple longest common subsequence approach.
 */
export function wordDiff(textA: string, textB: string): DiffEntry[] {
  const wordsA = textA.split(/\s+/).filter(Boolean);
  const wordsB = textB.split(/\s+/).filter(Boolean);

  // LCS table
  const m = wordsA.length;
  const n = wordsB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (wordsA[i - 1] === wordsB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffEntry[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsA[i - 1] === wordsB[j - 1]) {
      result.unshift({ type: "equal", text: wordsA[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", text: wordsB[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", text: wordsA[i - 1] });
      i--;
    }
  }

  // Merge consecutive entries of the same type
  const merged: DiffEntry[] = [];
  for (const entry of result) {
    const last = merged[merged.length - 1];
    if (last && last.type === entry.type) {
      last.text += " " + entry.text;
    } else {
      merged.push({ ...entry });
    }
  }

  return merged;
}

/**
 * Format a diff for terminal display.
 */
export function formatDiff(entries: DiffEntry[]): string {
  return entries
    .map((e) => {
      if (e.type === "equal") return e.text;
      if (e.type === "added") return `[+${e.text}+]`;
      return `[-${e.text}-]`;
    })
    .join(" ");
}

/**
 * Compute diff stats.
 */
export function diffStats(entries: DiffEntry[]): { equal: number; added: number; removed: number; similarity: number } {
  const equalWords = entries.filter((e) => e.type === "equal").reduce((n, e) => n + e.text.split(/\s+/).length, 0);
  const addedWords = entries.filter((e) => e.type === "added").reduce((n, e) => n + e.text.split(/\s+/).length, 0);
  const removedWords = entries.filter((e) => e.type === "removed").reduce((n, e) => n + e.text.split(/\s+/).length, 0);
  const total = equalWords + addedWords + removedWords;
  return {
    equal: equalWords,
    added: addedWords,
    removed: removedWords,
    similarity: total > 0 ? Math.round((equalWords / total) * 100) : 100,
  };
}
