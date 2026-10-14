// A CommonJS TypeScript consumer.
import createResolver = require('resolve-browser-trace')

const resolve = createResolver({ mapsDir: '/srv/maps', root: '/srv/build', includeSource: true, onError: (error, info) => String(error) + info.file })
const fromString: createResolver.Resolver = createResolver('/srv/maps')

async function demo(stack: unknown) {
  const frames = await resolve(stack)
  const first: createResolver.Frame = frames[0]
  const text: string = frames.stack
  const where: string | null = first.source
  const mapped: boolean = first.mapped
  const rebuilt: string = createResolver.formatStack(frames)
  const viaSetup = createResolver.setup({ maps: { 'app.js': '{"version":3}' }, loadMap: async (name) => (name === 'x.js' ? null : undefined) })
  return [text, where, mapped, rebuilt, viaSetup, fromString]
}
void demo
