// import { Counter, Gauge, AccountEventTracker } from '@sentio/sdk'
import { DIMORegistryProcessor } from './types/eth/dimoregistry.js'


// export const vehicleOwnerTracker = AccountEventTracker.register('users')
// export const vehicleIDTracker = AccountEventTracker.register('vehicle')



DIMORegistryProcessor.bind({ address: '0xFA8beC73cebB9D88FF88a2f75E7D7312f2Fd39EC', network: 137 })
  .onEventVehicleNodeMinted(async (event, ctx) => {
    ctx.meter.Counter("test").add(1)
    const owner = event.args.owner
    const tokenId = event.args.tokenId.toString() //bignumber to string
      ctx.eventLogger.emit("users", { distinctId: owner } )
      ctx.eventLogger.emit("vehicle", { distinctId: tokenId } )
  })


