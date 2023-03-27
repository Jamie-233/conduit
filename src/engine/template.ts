/**
 * `{{ path.to.value }}` interpolation for node configuration.
 *
 * This is deliberately *not* JavaScript evaluation. Workflows get shared and
 * imported; anything that runs `new Function` on config would make opening
 * someone else's workflow equivalent to running their code. A path lookup
 * covers what low-code users actually need — pull a field out of upstream
 * data — with nothing to escape.
 */

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g
const SEGMENT = /[^.[\]]+|\[(\d+)\]/g

export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const m of path.matchAll(SEGMENT)) {
    const key = m[1] ?? m[0]
    if (cur === null || cur === undefined) return undefined
    // Block prototype walking: "{{ input.__proto__.constructor }}" must not
    // reach anything that wasn't in the data.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined
    if (typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * A field that is *only* a placeholder keeps the value's type, so
 * `{{ input.count }}` yields a number, not "42". Mixed text always yields a
 * string — the behaviour users expect from templates everywhere else.
 */
export function render(template: string, scope: Record<string, unknown>): unknown {
  const whole = template.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/)
  if (whole) return getPath(scope, whole[1]!)
  return template.replace(TOKEN, (_, path: string) => {
    const v = getPath(scope, path)
    if (v === undefined || v === null) return ''
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

export function renderConfig(config: Record<string, unknown>, scope: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    out[k] = typeof v === 'string' && v.includes('{{') ? render(v, scope) : v
  }
  return out
}
