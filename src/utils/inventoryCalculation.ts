import type { BoothSalesRecord, BoothWarehouseSaleRecord, EventSalesRecord, InventoryMovement, Product } from '../types/inventory'

export type ProductSalesSummary = {
  eventSoldQuantity: number
  eventSalesAmount: number
  boothSoldQuantity: number
  boothSalesAmount: number
  boothWarehouseSoldQuantity: number
  boothWarehouseReceiptAmount: number
  boothHomeShippingSoldQuantity: number
  boothHomeShippingSalesAmount: number
  boothHomeShippingShippingFeeAmount: number
  boothTotalSoldQuantity: number
}

const increaseTypes = new Set<InventoryMovement['type']>(['restock', 'boothCancellation', 'return', 'adjustmentIncrease'])
export function movementDelta(movement: InventoryMovement): number { return increaseTypes.has(movement.type) ? movement.quantity : -movement.quantity }
export function calculateCurrentStock(product: Product, movements: InventoryMovement[]): number {
  return Math.max(0, product.initialStock + movements.filter((item) => item.productId === product.id).reduce((sum, item) => sum + movementDelta(item), 0))
}
export function calculateAllProductStocks(products: Product[], movements: InventoryMovement[]): Map<string, number> {
  return new Map(products.map((product) => [product.id, calculateCurrentStock(product, movements)]))
}
export function canDecreaseStock(product: Product, movements: InventoryMovement[], quantity: number): boolean { return Number.isInteger(quantity) && quantity >= 0 && calculateCurrentStock(product, movements) >= quantity }
export function calculateProductSalesSummary(productId: string, eventSales: EventSalesRecord[], boothSales: BoothSalesRecord[], boothWarehouseSales: BoothWarehouseSaleRecord[] = []): ProductSalesSummary {
  const eventSummary = eventSales
    .filter((record) => record.productId === productId && record.status === 'completed')
    .reduce((summary, record) => {
      const soldQuantity = record.soldQuantity ?? 0
      return {
        quantity: summary.quantity + soldQuantity,
        amount: summary.amount + soldQuantity * record.unitPriceSnapshot,
      }
    }, { quantity: 0, amount: 0 })
  const boothSummary = boothSales
    .filter((record) => record.productId === productId && record.status !== 'cancelled')
    .reduce((summary, record) => ({
      quantity: summary.quantity + record.quantity,
      amount: summary.amount + record.quantity * record.unitPriceSnapshot,
    }), { quantity: 0, amount: 0 })
  const boothShippingFeeAmount = boothSales
    .filter((record) => record.productId === productId && record.status !== 'cancelled')
    .reduce((sum, record) => sum + (record.shippingFee ?? 0), 0)
  const boothWarehouseSummary = boothWarehouseSales
    .filter((record) => record.productId === productId)
    .reduce((summary, record) => ({
      quantity: summary.quantity + record.quantity,
      receiptAmount: summary.receiptAmount + record.quantity * record.receiptUnitPriceSnapshot,
    }), { quantity: 0, receiptAmount: 0 })
  return {
    eventSoldQuantity: eventSummary.quantity,
    eventSalesAmount: eventSummary.amount,
    boothSoldQuantity: boothSummary.quantity,
    boothSalesAmount: boothSummary.amount,
    boothWarehouseSoldQuantity: boothWarehouseSummary.quantity,
    boothWarehouseReceiptAmount: boothWarehouseSummary.receiptAmount,
    boothHomeShippingSoldQuantity: boothSummary.quantity,
    boothHomeShippingSalesAmount: boothSummary.amount,
    boothHomeShippingShippingFeeAmount: boothShippingFeeAmount,
    boothTotalSoldQuantity: boothWarehouseSummary.quantity + boothSummary.quantity,
  }
}
