import { registerHooks } from 'node:module'

// Node tests exercise the real workflow with in-memory bindings.
const stubUrl = 'cloudflare-test:workers'
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'cloudflare:workers' ? { url: stubUrl, shortCircuit: true } : nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === stubUrl) {
      return {
        format: 'commonjs',
        source: 'exports.WorkflowEntrypoint = class { constructor(ctx, env) { this.ctx = ctx; this.env = env } }',
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})
