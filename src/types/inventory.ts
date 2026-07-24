export type Product = {
  id: string; name: string; defaultPrice: number | null; initialStock: number; category: string; memo: string; isActive: boolean
  firstSaleEventId: string | null
  boothEnabled: boolean; boothDisplayName: string; boothDefaultPrice: number | null; boothListingQuantity: number | null; boothUrl: string
  boothWarehouseCustomerUnitPrice: number | null; boothWarehouseReceiptUnitPrice: number | null
  createdAt: string; updatedAt: string
}

export type InventoryMovementType = 'restock' | 'eventSale' | 'eventSample' | 'boothSale' | 'boothCancellation' | 'boothWarehouseSale' | 'return' | 'adjustmentIncrease' | 'adjustmentDecrease'
export type InventoryMovement = { id: string; productId: string; date: string; type: InventoryMovementType; quantity: number; eventSalesRecordId: string | null; boothSalesRecordId: string | null; boothWarehouseSalesRecordId: string | null; memo: string; createdAt: string }
export type EventSalesStatus = 'planned' | 'completed'
export type EventSalesRecord = { id: string; eventId: string; productId: string; productNameSnapshot: string; unitPriceSnapshot: number; broughtQuantity: number; soldQuantity: number | null; sampleQuantity: number | null; status: EventSalesStatus; memo: string; updatedAt: string }
export type BoothOrderStatus = 'pending' | 'shipped' | 'cancelled'
export type BoothSalesRecord = { id: string; date: string; productId: string; productNameSnapshot: string; unitPriceSnapshot: number; quantity: number; orderReference: string; status: BoothOrderStatus; shippingFee: number | null; shippedAt: string | null; memo: string; createdAt: string; updatedAt: string }

export type BoothWarehouseSaleRecord = {
  id: string; date: string; productId: string; productNameSnapshot: string
  customerUnitPriceSnapshot: number; receiptUnitPriceSnapshot: number; quantity: number
  memo: string; createdAt: string; updatedAt: string
}

export type AnniversaryPlanItemDescriptions = {
  rabbit: string
  mushroom: string
  cat: string
}
export type AnniversaryCampaign = {
  id: string; year: number; name: string
  planItemDescriptions?: AnniversaryPlanItemDescriptions
  completedAt: string | null; createdAt: string; updatedAt: string
}

export type AnniversaryShipmentStatus = 'unprepared' | 'preparing' | 'prepared' | 'not_shipped' | 'shipped'
export type AnniversaryShippingQrImage = {
  storagePath: string
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  sizeBytes: number
  createdAt: string
  updatedAt: string
}
export type AnniversaryShipment = {
  id: string; campaignId: string; fanboxPlan: string; destinationNumber: string; itemDescription: string
  quantity: number; status: AnniversaryShipmentStatus; shippedAt: string | null; memo: string
  shippingQrImage?: AnniversaryShippingQrImage
  createdAt: string; updatedAt: string
}
