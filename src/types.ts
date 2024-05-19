type TOrderId =
  | "LONG_TP"
  | "LONG"
  | "LONG_SL"
  | "SHORT_TP"
  | "SHORT"
  | "SHORT_SL"

type TSide = "BUY" | "SELL"

type TPositionSide = "LONG" | "SHORT"

type TWorkingType = "MARK_PRICE" | "CONTRACT_PRICE"

type TTimeInForce = "GTC" | "IOC" | "FOK" | "GTX"

type TExecutionType =
  | "NEW"
  | "CANCELED"
  | "CALCULATED"
  | "EXPIRED"
  | "TRADE"
  | "AMENDMENT"

type TOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "EXPIRED"
  | "EXPIRED_IN_MATCH"

const OrderType = {
  MARKET: "MARKET",
  LIMIT: "LIMIT",
  STOP: "STOP",
  STOP_MARKET: "STOP_MARKET",
  TAKE_PROFIT: "TAKE_PROFIT",
  TAKE_PROFIT_MARKET: "TAKE_PROFIT_MARKET",
  TRAILING_STOP_MARKET: "TRAILING_STOP_MARKET",
} as const

type TOrderType = typeof OrderType

type TCreateGeneralOrder = {
  symbol: string
  side: TSide
  positionSide: TPositionSide
  newClientOrderId: TOrderId
  workingType?: TWorkingType
  priceProtect?: boolean
}

type TCreateStopLimitOrder = TCreateGeneralOrder & {
  type: TOrderType["STOP"] | TOrderType["TAKE_PROFIT"]
  quantity: string
  price: string
  stopPrice: string
  timeInForce: TTimeInForce
}

export type TCreateOrder = TCreateStopLimitOrder

type TOrderEvent = {
  e: "ORDER_TRADE_UPDATE" // Event Type
  E: number // Event Time
  T: number // Transaction Time
  o: {
    s: string // Symbol
    c: TOrderId // Client Order Id
    S: TSide // Side
    o: keyof TOrderType // Order Type
    f: TTimeInForce // Time in Force
    q: string // Original Quantity
    p: string // Original Price
    ap: string // Average Price
    sp: string // Stop Price
    x: TExecutionType // Execution Type
    X: TOrderStatus // Order Status
    i: number // Order Id
    l: string // Order Last Filled Quantity
    z: string // Order Filled Accumulated Quantity
    L: string // Last Filled Price
    N: string // Commission Asset, will not push if no commission
    n: string // Commission, will not push if no commission
    T: number // Order Trade Time
    t: number // Trade Id
    b: string // Bids Notional
    a: string // Ask Notional
    m: boolean // Is this trade the maker side?
    R: boolean // Is this reduce only
    wt: TWorkingType // Stop Price Working Type
    ot: keyof TOrderType // Original Order Type
    ps: TPositionSide // Position Side
    cp: boolean // If Close-All, pushed with conditional order
    pP: boolean // If price protection is turned on
    rp: string // Realized Profit of the trade
    V: string // STP mode
    pm: string // Price match mode
    gtd: number // TIF GTD order auto cancel time
  }
}

export type TUserEvent = TOrderEvent

export type TSocketReq = {
  method: string
  params: Record<string, any>
}

export type TSocketRes = {
  id: string
  status: number
  result: Record<string, any>
  error: {
    code: number
    msg: string
  }
  rateLimits: {
    rateLimitType: string
    interval: string
    intervalNum: number
    limit: number
    count: number
  }[]
}

export type THedgeOrder = {
  symbol: string
  usdtQty: number
  stopPrice: number
  leverage: number
  assetPrecision: number
}

export type THedgeTrade = THedgeOrder & {
  quantity: string
  shortPullback: number
  longPullback: number
  pricePrecision: number
}
