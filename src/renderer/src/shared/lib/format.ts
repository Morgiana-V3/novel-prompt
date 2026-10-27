export function fmtCount(numericValue: number): string {
  if (numericValue >= 1_000_000) {
    return (numericValue / 1_000_000).toFixed(1) + 'M'
  }
  if (numericValue >= 1000) {
    return (numericValue / 1000).toFixed(1) + 'k'
  }
  return String(numericValue)
}

export const cleanErr = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).replace(
    /^(Error: )?(Error invoking remote method '[^']+': )?(Error: )?/,
    '',
  )
