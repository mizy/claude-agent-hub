/**
 * Levenshtein 距离计算
 * 用于检测拼写错误
 */

/**
 * 计算两个字符串之间的 Levenshtein 距离
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length

  // 创建距离矩阵
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0))

  // 初始化第一行和第一列
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j

  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!
      } else {
        dp[i]![j] = Math.min(
          dp[i - 1]![j]! + 1,     // 删除
          dp[i]![j - 1]! + 1,     // 插入
          dp[i - 1]![j - 1]! + 1  // 替换
        )
      }
    }
  }

  return dp[m]![n]!
}

/**
 * 查找最接近的匹配
 */
export function findClosestMatch(
  input: string,
  candidates: string[],
  maxDistance = 2
): { match: string; distance: number } | null {
  let closest: string | null = null
  let minDistance = Infinity

  for (const candidate of candidates) {
    const distance = levenshteinDistance(input.toLowerCase(), candidate.toLowerCase())
    if (distance < minDistance && distance <= maxDistance) {
      minDistance = distance
      closest = candidate
    }
  }

  return closest ? { match: closest, distance: minDistance } : null
}
