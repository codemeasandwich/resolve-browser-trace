// An ES module TypeScript consumer.
import createResolver, { createResolver as named, formatStack, type Frame, type Options } from 'resolve-browser-trace'

const options: Options = { maps: { 'app.js': new Uint8Array() }, maxFrames: 50 }
const resolve = createResolver(options)
const again = named('/srv/maps')

async function demo(stack: unknown) {
  const frames: Frame[] = await resolve(stack)
  return [formatStack(frames), again]
}
void demo
