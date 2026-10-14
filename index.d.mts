import resolveBrowserTrace from './index.js'

export type Options = resolveBrowserTrace.Options
export type Frame = resolveBrowserTrace.Frame
export type Frames = resolveBrowserTrace.Frames
export type Resolver = resolveBrowserTrace.Resolver
export type SourceMapInput = resolveBrowserTrace.SourceMapInput

export declare const createResolver: typeof resolveBrowserTrace.createResolver
export declare const setup: typeof resolveBrowserTrace.setup
export declare const formatStack: typeof resolveBrowserTrace.formatStack
export default resolveBrowserTrace
