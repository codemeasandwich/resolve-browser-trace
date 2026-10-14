import { checkout, type CartItem } from './lib/cart'
import { PricingEngine, applyDiscount } from './lib/pricing'
import { CartView } from './view'

const h = (tag: string, props: unknown, ...children: unknown[]) => ({ tag, props, children })
;(globalThis as Record<string, unknown>).h = h

const scenarios = {
  emptyCheckout(): number {
    return checkout([])
  },
  quoteNegative(): string {
    return new PricingEngine('EUR').quote('mug-blue', -2)
  },
  bigDiscount(): number {
    return applyDiscount(100, 150)
  },
  blankRow(): unknown {
    return CartView({ labels: ['mug', ''] })
  },
  async rejectLater(): Promise<void> {
    await Promise.resolve()
    const items: CartItem[] = []
    checkout(items)
  },
  async lazyFailure(): Promise<void> {
    const mod = await import('./lib/lazy')
    mod.lazyFail('network')
  },
}

;(globalThis as Record<string, unknown>).scenarios = scenarios
export type Scenarios = typeof scenarios
