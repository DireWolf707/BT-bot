import { createHmac } from "crypto"
import WebSocket from "ws"

const stringifyKeyValuePair = ([key, value]: [string, any]) => {
  const valueString = Array.isArray(value) ? `["${value.join('","')}"]` : value
  return `${key}=${encodeURIComponent(valueString)}`
}

export const getSignature = (queryString: string) =>
  createHmac("sha256", process.env.API_SECRET!)
    .update(queryString)
    .digest("hex")

export const getSignedWsPayload = (_params: Record<string, any>) => {
  const params: Record<string, any> = {
    ..._params,
    apiKey: process.env.API_KEY!,
    timestamp: Date.now(),
  }

  const queryString = Object.entries(params)
    .sort()
    .map(([key, val]) => `${key}=${val}`)
    .join("&")

  const signature = getSignature(queryString)

  return { ...params, signature }
}

export const buildQueryString = (params: Record<string, any>) =>
  Object.entries(params).map(stringifyKeyValuePair).join("&")

export const getSignedQuery = (
  path: string,
  params: Record<string, any> = {}
) => {
  const timestamp = Date.now()
  const queryString = buildQueryString({ ...params, timestamp })
  const signature = getSignature(queryString)

  return path + "?" + queryString + "&signature=" + signature
}

export const waitForSocket = (ws: WebSocket) => {
  return new Promise<void>((resolve, reject) => {
    const maxNumberOfAttempts = 1000
    const intervalTime = 10 // 1000 * 10 = 10s

    let currentAttempt = 1
    const interval = setInterval(() => {
      if (currentAttempt > maxNumberOfAttempts) {
        clearInterval(interval)
        reject(new Error("Maximum number of attempts exceeded"))
      } else if (ws.readyState === ws.OPEN) {
        clearInterval(interval)
        resolve()
      }

      currentAttempt++
    }, intervalTime)
  })
}
