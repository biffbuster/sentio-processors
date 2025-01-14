import { PythEVMContext, PythEVMProcessor, PriceFeedUpdateEvent, getPythEVMContract, UpdatePriceFeedsCallTrace, UpdatePriceFeedsIfNecessaryCallTrace,
    BatchPriceFeedUpdateEvent } from "./types/eth/pythevm.js";
import { PRICE_MAP } from "./pyth.js";
import { CHAIN_IDS, Counter, Gauge } from "@sentio/sdk";
import { getPrice } from "./aptos.js";
// import { toBigDecimal } from "@sentio/sdk/";
// import { BigDecimal } from "@sentio/sdk/lib/core/big-decimal";
import { scaleDown } from '@sentio/sdk'


const commonOptions = { sparse: true }
const priceGauage = Gauge.register("evm_price", commonOptions)
const priceUnsafeGauage = Gauge.register("evm_price_unsafe", commonOptions)
const price_update_occur = Gauge.register("price_update_occur", commonOptions)
const batch_price_update_occur = Gauge.register("batch_price_update_occur", commonOptions)
const eth_balance = Gauge.register("eth_balance", commonOptions)

const CHAIN_ADDRESS_MAP = new Map<number, string>([
    [1, "0x4305FB66699C3B2702D4d05CF36551390A4c69C6"], //ETH
    [10, "0xff1a0f4744e8582df1ae09d5611b887b6a12925c"], //Optimism
    [56, "0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594"], //BSC
    // [97, "0xd7308b14bf4008e7c7196ec35610b1427c5702ea"], //BSC testnet
    [137, "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C"], //Polygon
    [42161, "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C"], //Arbitrum
    [250, "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C"], //Fantom
    [1313161554, "0xF89C7b475821EC3fDC2dC8099032c05c6c0c9AB9"], //Aurora
    [321, "0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B"], //KCC
    [43114, "0x4305FB66699C3B2702D4d05CF36551390A4c69C6"], //Avalanche
    [25, "0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B"], //Cronos
    [1101, "0xC5E56d6b40F3e3B5fbfa266bCd35C37426537c65"], // Polygon zkEVM
    [324, "0xf087c864AEccFb6A2Bf1Af6A0382B0d0f6c5D834"] // ZKsync
])

const CHAIN_NATIVE_MAP = new Map<number, string>([
    [1, "Crypto.ETH/USD"], //ETH
    [10, "Crypto.OP/USD"], //Optimism
    [56, "Crypto.BNB/USD"], //BSC
    // ["0xd7308b14bf4008e7c7196ec35610b1427c5702ea".toLowerCase(), "Crypto.BNB/USD"], //BSC testnet
    [137, "Crypto.MATIC/USD"], //Polygon
    [42161, "Crypto.ARB/USD"],//Arbitrum
    [250, "Crypto.FTM/USD"], //Fantom
    [1313161554, "Crypto.AURORA/USD"], //Aurora
    [321, "Crypto.KCS/USD"], //KCC
    [43114, "Crypto.AVAX/USD"], //Avalanche
    [25, "Crypto.CRO/USD"], //Cronos
    [1101, "Crypto.MATIC/USD"], // Polygon zk
    [324, "Crypto.ETH/USD"] // ZKsync
])

async function priceFeedUpdate(evt: PriceFeedUpdateEvent, ctx: PythEVMContext) {
    const price = evt.args.price
    const chainId = ctx.chainId
    const priceId = evt.args.id
    const address = ctx.address.toLowerCase()
    const symbol = PRICE_MAP.get(priceId) || "not listed"
    const nativeSymbol = CHAIN_NATIVE_MAP.get(chainId) || "not found"
    var isNative
    if (nativeSymbol == symbol) {
        isNative = "true"
    } else {
        isNative = "false"
    }
    try {
        const labels = {priceId, symbol, isNative}
        const pythContract = getPythEVMContract(ctx, ctx.address)
        const priceUnsafeStruct = await pythContract.getPriceUnsafe(priceId, {blockTag: evt.blockNumber})
        const priceUnsafe = scaleDown(priceUnsafeStruct.price, -priceUnsafeStruct.expo)
        priceGauage.record(ctx, price, labels)
        priceUnsafeGauage.record(ctx, priceUnsafe, labels)
        ctx.meter.Counter("price_update_counter").add(1, labels)
        price_update_occur.record(ctx, 1, labels)
        await recordGasUsage("priceFeedUpdate", evt.transactionHash, ctx)
    } catch (e) {
        console.log(ctx.chainId, priceId, ctx.address, evt.blockNumber, e)
    }
}

async function batchPriceUpdate(evt: BatchPriceFeedUpdateEvent, ctx: PythEVMContext) {
    ctx.meter.Counter("batch_price_update_counter").add(1)
    batch_price_update_occur.record(ctx, 1)
    await recordGasUsage("batchPriceUpdate", evt.transactionHash, ctx)
    // other than onblock, also need to track this whenever batchPriceUpdate was triggered
    try {
        if (ctx.chainId == 250) {
            const amount = await ctx.contract.provider!.getBalance(ctx.address, ctx.blockNumber)
            eth_balance.record(ctx, amount)  
        }  
    } catch (e) {
        console.log("chainId" + ctx.chainId)
        console.log("blockNumber" + ctx.blockNumber)
        console.log(e)
        return
    }
}

async function updatePriceFeeds(call: UpdatePriceFeedsCallTrace, ctx: PythEVMContext) {
    const from = call.action.from
    ctx.meter.Counter("update_price_feed_caller").add(1, {"caller": from})
}

async function updatePriceFeedsIfNecessary(call: UpdatePriceFeedsIfNecessaryCallTrace, ctx: PythEVMContext) {
    const from = call.action.from
    ctx.meter.Counter("update_price_feed_if_necessary_caller").add(1, {"caller": from})
}

async function recordGasUsage(evt : string, hash : string, ctx: PythEVMContext) {
    try {
        const receipt = await ctx.contract.provider.getTransactionReceipt(hash)
        const gasUsed = receipt!.gasUsed
        const gasPrice = receipt!.gasPrice.scaleDown(18)
        ctx.meter.Counter("gas_usage").add(gasUsed.asBigDecimal().
        multipliedBy(gasPrice).toNumber(), {"event": evt})
    } catch (e) {
        console.log(e)
        return
    }
}

async function blockHandler(block: any, ctx:PythEVMContext) {
    try {
        if (ctx.chainId == 250) {
            const amount = await ctx.contract.provider!.getBalance(ctx.address, ctx.blockNumber)
            eth_balance.record(ctx, amount)   
        } 
    } catch (e) {
        console.log("chainId" + ctx.chainId)
        console.log("blockNumber" + ctx.blockNumber)
        console.log(e)
        return
    }
}

CHAIN_ADDRESS_MAP.forEach((addr, chainId) => {
    // TODO: has to enforce starting block for OP otherwise it will query old implementation contract and fail
    // other L2s have larger block number as starting point
    if (addr == "0xff1a0f4744e8582df1ae09d5611b887b6a12925c") {
        PythEVMProcessor.bind({address: addr, network: chainId, startBlock: 45722027})
        .onEventPriceFeedUpdate(priceFeedUpdate)
        .onCallUpdatePriceFeeds(updatePriceFeeds)
        .onCallUpdatePriceFeedsIfNecessary(updatePriceFeedsIfNecessary)
        .onEventBatchPriceFeedUpdate(batchPriceUpdate)
        .onBlockInterval(blockHandler, 10000)
    } 
    // else if (chainId == 250) { // TODO: individually pulling fantom eth_balance
    //     PythEVMProcessor.bind({address: addr, network: chainId})
    //     .onEventPriceFeedUpdate(priceFeedUpdate)
    //     .onCallUpdatePriceFeeds(updatePriceFeeds)
    //     .onCallUpdatePriceFeedsIfNecessary(updatePriceFeedsIfNecessary)
    //     .onEventBatchPriceFeedUpdate(batchPriceUpdate)
    //     .onBlockInterval(blockHandler, 10000)
    // }
    else {
        PythEVMProcessor.bind({address: addr, network: chainId})
        .onEventPriceFeedUpdate(priceFeedUpdate)
        .onCallUpdatePriceFeeds(updatePriceFeeds)
        .onCallUpdatePriceFeedsIfNecessary(updatePriceFeedsIfNecessary)
        .onEventBatchPriceFeedUpdate(batchPriceUpdate)
        .onBlockInterval(blockHandler)
    }
})

// PythEVMProcessor.bind({address: PYTH_ETH})
// .onEventPriceFeedUpdate(priceFeedUpdate)
// .onCallUpdatePriceFeeds(updatePriceFeeds)
// .onCallUpdatePriceFeedsIfNecessary(updatePriceFeedsIfNecessary)
// .onEventBatchPriceFeedUpdate(batchPriceUpdate)

// PythEVMProcessor.bind({address: PYTH_OP, network: 10})
// .onEventPriceFeedUpdate(priceFeedUpdate)
// .onCallUpdatePriceFeeds(updatePriceFeeds)
// .onCallUpdatePriceFeedsIfNecessary(updatePriceFeedsIfNecessary)
// .onEventBatchPriceFeedUpdate(batchPriceUpdate)

// PythEVMProcessor.bind({address: PYTH_BSC, network: 56})
// .onEventPriceFeedUpdate(priceFeedUpdate)
// .onCallUpdatePriceFeeds(updatePriceFeeds)
// .onCallUpdatePriceFeedsIfNecessary(updatePriceFeedsIfNecessary)
// .onEventBatchPriceFeedUpdate(batchPriceUpdate)