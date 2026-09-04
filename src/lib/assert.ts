/**
 * Indexed access is checked (`noUncheckedIndexedAccess`) and non-null
 * assertions are banned by the linter, so use these instead of `!`.
 */

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Reads arr[index], throwing with context instead of returning undefined. */
export function at<T>(arr: readonly T[], index: number, what = "array"): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`${what}: no element at index ${index} (length ${arr.length})`);
  }
  return value;
}

export function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
  ctor: new () => T,
): T {
  const el = root.querySelector(selector);
  if (!(el instanceof ctor)) {
    throw new Error(`expected ${selector} to be a ${ctor.name}, got ${el?.nodeName ?? "nothing"}`);
  }
  return el;
}
