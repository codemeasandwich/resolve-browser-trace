export interface CartItem {
  sku: string
  quantity: number
  unitPrice: number
}

export function validateCart(items: CartItem[]): void {
  if (items.length === 0) {
    throw new Error('cart is empty')
  }
}

export function checkout(items: CartItem[]): number {
  validateCart(items)
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
}
