// ENV CONFIG
import { configDotenv } from "dotenv"
configDotenv()
// ENTRYPOINT
import axios, { Axios } from "axios"
import { v4 } from "uuid"
import WebSocket, { Data } from "ws"
import {
  TCreateOrder,
  THedgeOrder,
  THedgeTrade,
  TSocketReq,
  TSocketRes,
  TUserEvent,
} from "./types"
import { getSignedQuery, getSignedWsPayload, waitForSocket } from "./utils"

class BinanceBot {
  private api: Axios
  private ws: WebSocket | undefined
  private TP = 0.05
  private SL = 0.005
  private DELTA = 0.0001
  private MAX_PULLBACK = 10
  private tradeLog: THedgeTrade | undefined
  private eventLog = new Map<string, { resolve: Function; reject: Function }>()

  constructor() {
    this.api = this.setupApiClient()
  }

  public async start_hedge_trade({
    symbol,
    usdtQty,
    leverage,
    assetPrecision,
    stopPrice,
  }: THedgeOrder) {
    await Promise.all([
      this.setupClientSocket(),
      this.setupUserStreamSocket(),
      this.changeLeverage(symbol, leverage),
      this.changeMarginType(symbol, "ISOLATED"),
      this.setMultiAssetMode(false),
      this.setHedgeMode(true),
    ])

    const marketPrice = await this.getPrice(symbol)
    const pricePrecision = marketPrice.split(".").pop()!.length
    const quantity = (usdtQty / stopPrice).toFixed(assetPrecision)
    const isAboveMarketPrice = stopPrice > parseFloat(marketPrice)

    this.tradeLog = {
      symbol,
      usdtQty,
      stopPrice,
      pricePrecision,
      leverage,
      assetPrecision,
      quantity,
      shortPullback: -1,
      longPullback: -1,
    }

    await this.createMultipleOrder([
      {
        symbol,
        quantity,
        side: "BUY",
        positionSide: "LONG",
        newClientOrderId: "LONG",
        type: isAboveMarketPrice ? "STOP" : "TAKE_PROFIT",
        timeInForce: "GTX",
        stopPrice: stopPrice.toFixed(pricePrecision),
        price: (stopPrice * (1 + this.TP)).toFixed(pricePrecision),
      },
      {
        symbol,
        quantity,
        side: "SELL",
        positionSide: "SHORT",
        newClientOrderId: "SHORT",
        type: isAboveMarketPrice ? "TAKE_PROFIT" : "STOP",
        timeInForce: "GTX",
        stopPrice: stopPrice.toFixed(pricePrecision),
        price: (stopPrice * (1 - this.TP)).toFixed(pricePrecision),
      },
    ])
  }

  public async getPrice(symbol: string): Promise<string> {
    return this.sendSocket({
      method: "ticker.price",
      params: { symbol },
    }).then(({ result }) => result.price)
  }

  public createOrder(order: TCreateOrder) {
    return this.sendSocket({
      method: "order.place",
      params: order,
    })
  }

  private async createMultipleOrder(batchOrders: TCreateOrder[]) {
    await this.api
      .post(
        getSignedQuery("/fapi/v1/batchOrders", {
          batchOrders: this.encodeData(batchOrders),
        })
      )
      .then(({ data }) =>
        data.map((order: any) => {
          if (order.code) throw new Error(order.msg)
        })
      )
  }

  private async changeLeverage(symbol: string, leverage: number) {
    await this.api.post(
      getSignedQuery("/fapi/v1/leverage", { symbol, leverage })
    )
  }

  private async changeMarginType(
    symbol: string,
    marginType: "ISOLATED" | "CROSSED"
  ) {
    await this.api
      .post(getSignedQuery("/fapi/v1/marginType", { symbol, marginType }))
      .catch((err) => {
        if (err.response.data.code !== -4046) throw err
      })
  }

  private async setHedgeMode(dualSidePosition: boolean) {
    await this.api
      .post(getSignedQuery("/fapi/v1/positionSide/dual", { dualSidePosition }))
      .catch((err) => {
        if (err.response.data.code !== -4059) throw err
      })
  }

  private async setMultiAssetMode(multiAssetsMargin: boolean) {
    await this.api
      .post(getSignedQuery("/fapi/v1/multiAssetsMargin", { multiAssetsMargin }))
      .catch((err) => {
        if (err.response.data.code !== -4171) throw err
      })
  }

  public async cancelAllOrders() {
    await this.api.delete(
      getSignedQuery("/fapi/v1/allOpenOrders", {
        symbol: this.tradeLog!.symbol,
      })
    )
  }

  private async sendSocket(data: TSocketReq) {
    return new Promise<TSocketRes>((resolve, reject) => {
      const id = v4()
      this.eventLog.set(id, { resolve, reject })

      this.ws!.send(
        this.encodeData({
          ...data,
          id,
          params: getSignedWsPayload(data.params),
        })
      )
    })
  }

  private async setupUserStreamSocket() {
    const apiPath = "/fapi/v1/listenKey"
    const { data } = await this.api.post<{ listenKey: string }>(apiPath)
    setInterval(() => this.api.put(apiPath), 15 * 60 * 1000) // 15 min

    const wsPath = process.env.WS_USER_STREAM_URL + data.listenKey
    let ws = await this.createUserStreamSocket(wsPath)
    setInterval(async () => {
      const newWs = await this.createUserStreamSocket(wsPath)
      ws.close()
      ws = newWs
    }, 6 * 60 * 60 * 1000) // 6 hr
  }

  private async createUserStreamSocket(url: string) {
    let i = 0
    const ws = new WebSocket(url)

    ws.on("error", (err) => console.log(err))
    ws.on("close", () => console.log("client stream ws closed!"))
    ws.on("ping", (data) => ws.pong(data))
    ws.on("pong", () => {
      console.log("User Stream:", i)
      i = (i + 1) % 10
    })
    ws.on("message", (_data) => {
      const data: TUserEvent = this.decodeData(_data)
      if (data.e !== "ORDER_TRADE_UPDATE") return

      const id = data.o.c
      const side = data.o.S
      const symbol = data.o.s
      const orderType = data.o.o
      const orderStatus = data.o.X
      const positionSide = data.o.ps
      const tradeLog = this.tradeLog!

      if (symbol != tradeLog.symbol) return

      // LONG ENTERED
      if (
        side == "BUY" &&
        positionSide == "LONG" &&
        orderType == "LIMIT" &&
        orderStatus == "FILLED"
      ) {
        console.log(data.o)

        tradeLog.longPullback++

        const SLOrder: TCreateOrder = {
          symbol,
          quantity: tradeLog.quantity,
          side: "SELL",
          positionSide: "LONG",
          newClientOrderId: "LONG_SL",
          type: "STOP",
          timeInForce: "GTX",
          stopPrice: (tradeLog.stopPrice * (1 - this.SL)).toFixed(
            tradeLog.pricePrecision
          ),
          price: (tradeLog.stopPrice * (1 - this.TP)).toFixed(
            tradeLog.pricePrecision
          ),
        }

        // NOT FIRST LONG: ONLY OPEN SL
        if (tradeLog.longPullback > 0) this.createOrder(SLOrder)
        // FIRST LONG: OPEN BOTH TP AND SL
        else {
          const TPOrder: TCreateOrder = {
            symbol,
            quantity: tradeLog.quantity,
            side: "SELL",
            positionSide: "LONG",
            newClientOrderId: "LONG_TP",
            type: "TAKE_PROFIT",
            timeInForce: "GTX",
            stopPrice: (tradeLog.stopPrice * (1 + this.TP)).toFixed(
              tradeLog.pricePrecision
            ),
            price: (tradeLog.stopPrice * (1 - this.TP)).toFixed(
              tradeLog.pricePrecision
            ),
          }

          this.createMultipleOrder([TPOrder, SLOrder])
        }
      }
      // SHORT ENTERED
      else if (
        side == "SELL" &&
        positionSide == "SHORT" &&
        orderType == "LIMIT" &&
        orderStatus == "FILLED"
      ) {
        console.log(data.o)

        tradeLog.shortPullback++

        const SLOrder: TCreateOrder = {
          symbol,
          quantity: tradeLog.quantity,
          side: "BUY",
          positionSide: "SHORT",
          newClientOrderId: "SHORT_SL",
          type: "STOP",
          timeInForce: "GTX",
          stopPrice: (tradeLog.stopPrice * (1 + this.SL)).toFixed(
            tradeLog.pricePrecision
          ),
          price: (tradeLog.stopPrice * (1 + this.TP)).toFixed(
            tradeLog.pricePrecision
          ),
        }

        // NOT FIRST SHORT: ONLY OPEN SL
        if (tradeLog.shortPullback > 0) this.createOrder(SLOrder)
        // FIRST SHORT: OPEN BOTH TP AND SL
        else {
          const TPOrder: TCreateOrder = {
            symbol,
            quantity: tradeLog.quantity,
            side: "BUY",
            positionSide: "SHORT",
            newClientOrderId: "SHORT_TP",
            type: "TAKE_PROFIT",
            timeInForce: "GTX",
            stopPrice: (tradeLog.stopPrice * (1 - this.TP)).toFixed(
              tradeLog.pricePrecision
            ),
            price: (tradeLog.stopPrice * (1 + this.TP)).toFixed(
              tradeLog.pricePrecision
            ),
          }

          this.createMultipleOrder([TPOrder, SLOrder])
        }
      }
      // LONG FILLED
      else if (
        side == "SELL" &&
        positionSide == "LONG" &&
        orderType == "LIMIT" &&
        orderStatus == "FILLED"
      ) {
        console.log(data.o)

        // TP HIT: CLOSE ALL ORDERS AND POSITIONS
        if (id === "LONG_TP") this.cancelAllOrders()
        // SL HIT
        else if (id === "LONG_SL") {
          // PULLBACK LIMIT REACHED: CLOSE ALL ORDERS AND POSITIONS
          if (
            tradeLog.longPullback + tradeLog.shortPullback ==
            this.MAX_PULLBACK
          )
            throw new Error("MAX PULLBACK LIMIT REACHED")
          // PULLBACK LIMIT NOT REACHED: NEW LONG ORDER
          else {
            this.createOrder({
              symbol,
              quantity: tradeLog.quantity,
              side: "BUY",
              positionSide: "LONG",
              newClientOrderId: "LONG",
              type: "STOP",
              timeInForce: "GTX",
              stopPrice: (
                tradeLog.stopPrice *
                (1 - this.SL + this.DELTA)
              ).toFixed(tradeLog.pricePrecision),
              price: (tradeLog.stopPrice * (1 + this.TP)).toFixed(
                tradeLog.pricePrecision
              ),
            })
          }
        }
      }
      // SHORT FILLED
      else if (
        side == "BUY" &&
        positionSide == "SHORT" &&
        orderType == "LIMIT" &&
        orderStatus == "FILLED"
      ) {
        console.log(data.o)

        // TP HIT: CLOSE ALL ORDERS AND POSITIONS
        if (id === "SHORT_TP") this.cancelAllOrders()
        // SL HIT
        else if (id === "SHORT_SL") {
          // PULLBACK LIMIT REACHED: CLOSE ALL ORDERS AND POSITIONS
          if (
            tradeLog.longPullback + tradeLog.shortPullback ==
            this.MAX_PULLBACK
          )
            throw new Error("MAX PULLBACK LIMIT REACHED")
          // PULLBACK LIMIT NOT REACHED: NEW SHORT ORDER
          else {
            this.createOrder({
              symbol,
              quantity: tradeLog.quantity,
              side: "SELL",
              positionSide: "SHORT",
              newClientOrderId: "SHORT",
              type: "STOP",
              timeInForce: "GTX",
              stopPrice: (
                tradeLog.stopPrice *
                (1 + this.SL - this.DELTA)
              ).toFixed(tradeLog.pricePrecision),
              price: (tradeLog.stopPrice * (1 - this.TP)).toFixed(
                tradeLog.pricePrecision
              ),
            })
          }
        }
      }

      console.log("===========================================================")
    })

    await waitForSocket(ws)

    setInterval(() => ws.ping(), 10 * 1000)

    return ws
  }

  private async setupClientSocket() {
    const path = process.env.WS_URL!
    this.ws = await this.createClientSocket(path)

    setInterval(async () => {
      const newWs = await this.createClientSocket(path)
      this.ws!.close()
      this.ws = newWs
    }, 6 * 60 * 60 * 1000) // 6hr
  }

  private async createClientSocket(url: string) {
    let i = 0
    const ws = new WebSocket(url)

    ws.on("error", (err) => console.log(err))
    ws.on("close", () => console.log("client ws closed!"))
    ws.on("ping", (data) => ws.pong(data))
    ws.on("pong", () => {
      console.log("WS:", i)
      i = (i + 1) % 10
    })
    ws.on("message", (_data) => {
      const data: TSocketRes = this.decodeData(_data)

      const fxns = this.eventLog.get(data.id)
      if (!fxns) return
      this.eventLog.delete(data.id)

      const { resolve, reject } = fxns

      if (data.status === 200) {
        console.log(data.result)
        resolve(data)
      } else {
        console.log(data.error)
        reject(data.error.msg)
      }
      console.log("===========================================================")
    })

    await waitForSocket(ws)

    setInterval(() => ws.ping(), 10 * 1000)

    return ws
  }

  private setupApiClient() {
    return axios.create({
      baseURL: process.env.API_BASE_URL,
      headers: { "X-MBX-APIKEY": process.env.API_KEY },
    })
  }

  private decodeData(data: Data) {
    return JSON.parse(data.toString())
  }

  private encodeData(data: Record<string, any>) {
    return JSON.stringify(data)
  }
}

export const bot = new BinanceBot()
