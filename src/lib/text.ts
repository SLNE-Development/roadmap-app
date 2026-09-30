/** Formats a count with its noun, `plural(1, "member")` is "1 member" and `plural(3, "member")` is "3 members". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
