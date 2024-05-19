import { bot } from "./bot"

const globalErrorHandler = async (err: any) => {
  await bot.cancelAllOrders()
  console.log(err)
  console.log("=============================")
  console.log("CLOSING TRADES")
  console.log("=============================")
}

process.on("uncaughtException", globalErrorHandler)
process.on("unhandledRejection", globalErrorHandler)

bot.start_hedge_trade({
  symbol: "FILUSDC",
  usdtQty: 10,
  leverage: 10,
  assetPrecision: 0,
  stopPrice: 5.8,
})
