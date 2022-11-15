import fetch from 'node-fetch';
import { DEFAULT_MAINNET_LIST, RawCoinInfo } from "@manahippo/coin-list/dist/list";
import { AptosClient } from "aptos-sdk";
import { aptos, BigDecimal } from "@sentio/sdk";
import { coin } from "@sentio/sdk/lib/builtin/aptos/0x1";
import { getPriceClient } from '@sentio/sdk/lib/utils/price'
import CoinInfo = coin.CoinInfo;
import { getRandomInt } from "../utils";

const client = new AptosClient("https://aptos-mainnet.nodereal.io/v1/0c58c879d41e4eab8fd2fc0406848c2b/")
const priceClient = getPriceClient("http://test-web-server:10010")

export interface BaseCoinInfoWithBridge extends RawCoinInfo {
  bridge: string
}

export interface SimpleCoinInfo {
  token_type: {  type: string }
  symbol: string
  decimals: number
  bridge: string
}

export const CORE_TOKENS = new Map<string, BaseCoinInfoWithBridge>()

for (const info of DEFAULT_MAINNET_LIST) {
  let bridge = "native"
  if (info.name.includes("Celer")) {
    bridge = "Celer"
  }
  if (info.name.includes("LayerZero")) {
    bridge = "LayerZero"
  }
  if (info.name.includes("Wormhole")) {
    bridge = "Wormhole"
  }
  if (!info.coingecko_id) {
    if (info.symbol.endsWith("APT")) {
      info.coingecko_id = "aptos"
    }
    if (info.symbol.startsWith("USD")) {
      info.coingecko_id = "usd-coin"
    }
    // TODO add moji
  }
  CORE_TOKENS.set(info.token_type.type, { ...info, bridge })
}

export function whiteListed(type: string): boolean {
  return CORE_TOKENS.has(type)
}

export function getCoinInfo(type: string): SimpleCoinInfo {
  const r = CORE_TOKENS.get(type)
  if (!r) {
    return {
      token_type: { type: type },
      symbol: type.split("::")[2],
      decimals: 1,
      bridge: "native"
    }
  }
  return r
}

export function scaleDown(n: bigint, decimal: number) {
  return new BigDecimal(n.toString()).div(new BigDecimal(10).pow(decimal))
}


export async function getPrice(coinType: string, timestamp: number) {
  if (!whiteListed(coinType)) {
    return 0.0
  }
  const date = new Date(timestamp / 1000)
  let price : any
  try {
    const response = await priceClient.getPrice({
      timestamp: date,
      coinId: {
        address: {
          chain: "aptos_mainnet",
          address: coinType,
        }
      }
    })
    price = response.price
  } catch (e) {
    console.log("error getting price", e, timestamp, coinType)
    price = 0
  }

  return price
}

export async function calculateValueInUsd(n: bigint, coinInfo: SimpleCoinInfo, timestamp: number | string) {
  if (typeof timestamp === 'string') {
    timestamp = parseInt(timestamp)
  }
  const price = await getPrice(coinInfo.token_type.type, timestamp)
  const amount = await scaleDown(n, coinInfo.decimals)
  return amount.multipliedBy(price)
}

export function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}