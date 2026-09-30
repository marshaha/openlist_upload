/**
 * setimmediate 包的替代品。
 * 原包为兼容 IE 实现了 <script> onreadystatechange 回退分支,
 * 该分支在现代 Chromium 中永远不会执行,但 createElement('script')
 * 会被 Obsidian 审核的静态扫描命中。现代环境用微任务调度即可。
 */
export function setImmediate<T extends unknown[]>(
  callback: (...args: T) => void,
  ...args: T
): number {
  void Promise.resolve().then(() => callback(...args));
  return 0;
}

export function clearImmediate(_handle: number): void {
  /* 微任务不可取消;jszip 仅使用 setImmediate */
}
