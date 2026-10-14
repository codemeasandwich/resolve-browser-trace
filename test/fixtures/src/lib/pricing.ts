export class PricingEngine {
  private readonly currency: string

  constructor(currency: string) {
    this.currency = currency
  }

  quote(sku: string, quantity: number): string {
    if (quantity < 0) {
      throw new RangeError(`negative quantity for ${sku} in ${this.currency}`)
    }
    return `${quantity} x ${sku}`
  }
}

export const applyDiscount = (total: number, percent: number): number => {
  if (percent > 100) {
    throw new RangeError('discount above 100%')
  }
  return total - (total * percent) / 100
}
