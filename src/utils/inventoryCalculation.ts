import type { InventoryMovement, Product } from '../types/inventory'

const increaseTypes = new Set<InventoryMovement['type']>(['restock', 'boothCancellation', 'return', 'adjustmentIncrease'])
export function movementDelta(movement: InventoryMovement): number { return increaseTypes.has(movement.type) ? movement.quantity : -movement.quantity }
export function calculateCurrentStock(product: Product, movements: InventoryMovement[]): number {
  return Math.max(0, product.initialStock + movements.filter((item) => item.productId === product.id).reduce((sum, item) => sum + movementDelta(item), 0))
}
export function calculateAllProductStocks(products: Product[], movements: InventoryMovement[]): Map<string, number> {
  return new Map(products.map((product) => [product.id, calculateCurrentStock(product, movements)]))
}
export function canDecreaseStock(product: Product, movements: InventoryMovement[], quantity: number): boolean { return Number.isInteger(quantity) && quantity >= 0 && calculateCurrentStock(product, movements) >= quantity }
