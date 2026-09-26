type Child = Node | string | null | false;

/** 要素を 1 つ組む。文は textContent として入れる (港から来た値を HTML として読まない) */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) node.append(c);
  return node;
}
