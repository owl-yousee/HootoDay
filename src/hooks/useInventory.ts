import { useEffect, useState } from 'react'
import type {
  AnniversaryCampaign,
  AnniversaryShipment,
  BoothSalesRecord,
  BoothWarehouseSaleRecord,
  EventSalesRecord,
  InventoryMovement,
  Product,
} from '../types/inventory'
import { calculateCurrentStock } from '../utils/inventoryCalculation'
import {
  loadAnniversaryCampaigns,
  loadAnniversaryShipments,
  loadBoothSalesRecords,
  loadBoothWarehouseSalesRecords,
  loadEventSalesRecords,
  loadInventoryMovements,
  loadProducts,
  saveAnniversaryCampaigns,
  saveAnniversaryShipments,
  saveBoothSalesRecords,
  saveBoothWarehouseSalesRecords,
  saveEventSalesRecords,
  saveInventoryMovements,
  saveProducts,
} from '../utils/inventoryStorage'

export function useInventory() {
 const [products,setProducts]=useState<Product[]>(loadProducts); const [inventoryMovements,setInventoryMovements]=useState<InventoryMovement[]>(loadInventoryMovements); const [eventSalesRecords,setEventSalesRecords]=useState<EventSalesRecord[]>(loadEventSalesRecords); const [boothSalesRecords,setBoothSalesRecords]=useState<BoothSalesRecord[]>(loadBoothSalesRecords)
 const [boothWarehouseSalesRecords,setBoothWarehouseSalesRecords]=useState<BoothWarehouseSaleRecord[]>(loadBoothWarehouseSalesRecords); const [anniversaryCampaigns,setAnniversaryCampaigns]=useState<AnniversaryCampaign[]>(loadAnniversaryCampaigns); const [anniversaryShipments,setAnniversaryShipments]=useState<AnniversaryShipment[]>(loadAnniversaryShipments)
 useEffect(()=>saveProducts(products),[products]); useEffect(()=>saveInventoryMovements(inventoryMovements),[inventoryMovements]); useEffect(()=>saveEventSalesRecords(eventSalesRecords),[eventSalesRecords]); useEffect(()=>saveBoothSalesRecords(boothSalesRecords),[boothSalesRecords])
 useEffect(()=>saveBoothWarehouseSalesRecords(boothWarehouseSalesRecords),[boothWarehouseSalesRecords]); useEffect(()=>saveAnniversaryCampaigns(anniversaryCampaigns),[anniversaryCampaigns]); useEffect(()=>saveAnniversaryShipments(anniversaryShipments),[anniversaryShipments])
 const saveProduct=(v:Product)=>setProducts(c=>c.some(x=>x.id===v.id)?c.map(x=>x.id===v.id?v:x):[...c,v])
 const addMovement=(v:InventoryMovement)=>setInventoryMovements(c=>[...c,v])
 const saveEventSale=(record:EventSalesRecord,movementDate:string):string|null=>{ const product=products.find(x=>x.id===record.productId); if(!product)return '商品が見つかりません。'; const old=eventSalesRecords.find(x=>x.id===record.id); const oldUsed=old?.status==='completed'?(old.soldQuantity??0)+(old.sampleQuantity??0):0; const needed=record.status==='completed'?(record.soldQuantity??0)+(record.sampleQuantity??0):0; const available=calculateCurrentStock(product,inventoryMovements)+oldUsed; if(needed>available)return `在庫が不足しています（販売可能 ${available}個）。`; setEventSalesRecords(c=>c.some(x=>x.id===record.id)?c.map(x=>x.id===record.id?record:x):[...c,record]); setInventoryMovements(c=>[...c.filter(x=>x.eventSalesRecordId!==record.id),...(record.status==='completed'&&record.soldQuantity?[{id:crypto.randomUUID(),productId:record.productId,date:movementDate,type:'eventSale' as const,quantity:record.soldQuantity,eventSalesRecordId:record.id,boothSalesRecordId:null,boothWarehouseSalesRecordId:null,memo:'',createdAt:new Date().toISOString()}]:[]),...(record.status==='completed'&&record.sampleQuantity?[{id:crypto.randomUUID(),productId:record.productId,date:movementDate,type:'eventSample' as const,quantity:record.sampleQuantity,eventSalesRecordId:record.id,boothSalesRecordId:null,boothWarehouseSalesRecordId:null,memo:'',createdAt:new Date().toISOString()}]:[])]); return null }
 const deleteEventSale=(id:string)=>{setEventSalesRecords(c=>c.filter(record=>record.id!==id));setInventoryMovements(c=>c.filter(movement=>movement.eventSalesRecordId!==id))}
 const saveBoothSale=(record:BoothSalesRecord,expectedExistingId:string|null=null):string|null=>{ const product=products.find(x=>x.id===record.productId); if(!product)return '商品が見つかりません。'; const old=boothSalesRecords.find(x=>x.id===record.id); if(expectedExistingId&&(record.id!==expectedExistingId||!old))return '編集対象のBOOTH販売記録が見つかりません。画面を閉じて再確認してください。'; const oldUsed=old&&old.status!=='cancelled'?old.quantity:0; const needed=record.status==='cancelled'?0:record.quantity; const available=calculateCurrentStock(product,inventoryMovements)+oldUsed; if(needed>available)return `在庫が不足しています（販売可能 ${available}個）。`; setBoothSalesRecords(c=>old?c.map(x=>x.id===record.id?record:x):[...c,record]); setInventoryMovements(c=>[...c.filter(x=>x.boothSalesRecordId!==record.id),...(needed?[{id:crypto.randomUUID(),productId:record.productId,date:record.date,type:'boothSale' as const,quantity:needed,eventSalesRecordId:null,boothSalesRecordId:record.id,boothWarehouseSalesRecordId:null,memo:'',createdAt:new Date().toISOString()}]:[])]); return null }
 const deleteBoothSale=(id:string)=>{setBoothSalesRecords(c=>c.filter(record=>record.id!==id));setInventoryMovements(c=>c.filter(movement=>movement.boothSalesRecordId!==id))}
 return {products,inventoryMovements,eventSalesRecords,boothSalesRecords,boothWarehouseSalesRecords,anniversaryCampaigns,anniversaryShipments,saveProduct,addMovement,saveEventSale,deleteEventSale,saveBoothSale,deleteBoothSale,replaceProducts:setProducts,replaceInventoryMovements:setInventoryMovements,replaceEventSalesRecords:setEventSalesRecords,replaceBoothSalesRecords:setBoothSalesRecords,replaceBoothWarehouseSalesRecords:setBoothWarehouseSalesRecords,replaceAnniversaryCampaigns:setAnniversaryCampaigns,replaceAnniversaryShipments:setAnniversaryShipments}
}
