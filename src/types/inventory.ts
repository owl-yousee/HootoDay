export type Product = {
  id: string; name: string; defaultPrice: number | null; initialStock: number; category: string; memo: string; isActive: boolean
  firstSaleEventId: string | null
  boothEnabled: boolean; boothDisplayName: string; boothDefaultPrice: number | null; boothListingQuantity: number | null; boothUrl: string
  createdAt: string; updatedAt: string
}

export type InventoryMovementType = 'restock' | 'eventSale' | 'eventSample' | 'boothSale' | 'boothCancellation' | 'return' | 'adjustmentIncrease' | 'adjustmentDecrease'
export type InventoryMovement = { id: string; productId: string; date: string; type: InventoryMovementType; quantity: number; eventSalesRecordId: string | null; boothSalesRecordId: string | null; memo: string; createdAt: string }
export type EventSalesStatus = 'planned' | 'completed'
export type EventSalesRecord = { id: string; eventId: string; productId: string; productNameSnapshot: string; unitPriceSnapshot: number; broughtQuantity: number; soldQuantity: number | null; sampleQuantity: number | null; status: EventSalesStatus; memo: string; updatedAt: string }
export type BoothOrderStatus = 'pending' | 'shipped' | 'cancelled'
export type BoothSalesRecord = { id: string; date: string; productId: string; productNameSnapshot: string; unitPriceSnapshot: number; quantity: number; orderReference: string; status: BoothOrderStatus; memo: string; createdAt: string; updatedAt: string }
