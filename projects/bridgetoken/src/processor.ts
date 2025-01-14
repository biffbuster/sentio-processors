import { SimpleCoinInfo, whitelistCoins } from "@sentio/sdk/aptos/ext";
import {CHAIN_IDS} from "@sentio/sdk";
import {account, coin, type_info} from "@sentio/sdk/aptos/builtin/0x1";
import {getPriceByType} from "@sentio/sdk/utils";
import {defaultMoveCoder, getAptosClient} from "@sentio/sdk/aptos";

const BRIDGE_TOKENS = new Map<string, SimpleCoinInfo>()
const PRICES = new Map<string, number>()

const date = new Date(2022, 11, 1)

for (const token of whitelistCoins().values()) {
    if (token.bridge === "native") {
        continue
    }

    BRIDGE_TOKENS.set(token.token_type.type, token)

    getPriceByType(CHAIN_IDS.APTOS_MAINNET, token.token_type.type, date).then((price) => {
        price = price || 0
        PRICES.set(token.token_type.type, price)
        console.log("price", token.token_type.type, price)
    })
}

const client = getAptosClient()!

// coin.bind().onEventDepositEvent(async (evt, ctx) => {
//   const payload = ctx.transaction.payload as TransactionPayload_EntryFunctionPayload
//   const token = BRIDGE_TOKENS.get(payload.type_arguments[0])
//   if (!token) {
//     return
//   }
//
//   const amount = scaleDown(evt.data_decoded.amount, token.decimals)
//   const value = amount.multipliedBy(PRICES.get(token.token_type.type)!)
//
//   // const value = await calculateValueInUsd(evt.data_decoded.amount, token, priceTimestamp)
//   if (!value.isGreaterThan(0)) {
//     return
//   }
//
//   ctx.logger.info("deposit", {value: value.toNumber(), token: token.symbol, bridge: token.bridge, account: evt.guid.account_address})
// }).onEventWithdrawEvent(async (evt, ctx) => {
//   const payload = ctx.transaction.payload as TransactionPayload_EntryFunctionPayload
//   const token = BRIDGE_TOKENS.get(payload.type_arguments[0])
//   if (!token) {
//     return
//   }
//
//   const amount = scaleDown(evt.data_decoded.amount, token.decimals)
//   const value = amount.multipliedBy(PRICES.get(token.token_type.type)!)
//   // const value = await calculateValueInUsd(evt.data_decoded.amount, token, priceTimestamp)
//   if (!value.isGreaterThan(0)) {
//     return
//   }
//   ctx.logger.info("withdraw", {value: value.negated().toNumber(), token: token.symbol, bridge: token.bridge, account: evt.guid.account_address})
// })

coin.bind()


// defaultMoveCoder().load(coin.ABI)
account.bind().onEventCoinRegisterEvent(async (call, ctx) => {
    const type = extractTypeName(call.data_decoded.type_info)
    const accountAddress = call.guid.account_address
    const token = BRIDGE_TOKENS.get(type)
    if (!token) {
        return
    }
    const coinStore = `0x1::coin::CoinStore<${token.token_type.type}>`;

    const res = await client.getAccountResource(accountAddress, coinStore)
    const decodedRes = defaultMoveCoder().decodeResource<coin.CoinStore<any>>(res)
    if (!decodedRes) {
        console.log(res)
        process.exit(1)
        return
    }
    const amount = decodedRes.data_decoded.coin.value.scaleDown(token.decimals)
    const value = amount.multipliedBy(PRICES.get(token.token_type.type)!)

    ctx.eventLogger.emit("coin_register", {
        distinctId: accountAddress,
        "token": {
            "symbol": token.symbol,
            "bridge": token.bridge,
        },
        "amount": value.toNumber(),
    })
})

function extractTypeName(typeInfo: type_info.TypeInfo) {
    return [typeInfo.account_address, hex_to_ascii(typeInfo.module_name), hex_to_ascii(typeInfo.struct_name)].join("::")
    // if (rawName.startsWith("Coin<")) {
    //   return rawName.substring(5, rawName.length - 1)
    // } else {
    //   return rawName
    // }
}

function hex_to_ascii(str1: String) {
    var hex = str1.toString();
    if (hex.startsWith("0x")) {
        hex = hex.substring(2)
    }
    var str = '';
    for (var n = 0; n < hex.length; n += 2) {
        str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
    }
    return str;
}