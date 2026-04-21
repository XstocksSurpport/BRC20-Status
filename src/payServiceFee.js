/**
 * 可选：向配置的收款地址支付固定手续费（由用户在钱包扩展内签名确认）。
 * 部署时在 .env 设置 VITE_FEE_RECIPIENT=你的收款比特币地址
 */
const FEE_SATS = 5_900_000 // 0.059 BTC

function apiMempool() {
  return import.meta.env.DEV ? '/api/mempool' : 'https://mempool.space/api'
}

async function recommendedFeeRate() {
  try {
    const r = await fetch(`${apiMempool()}/v1/fees/recommended`)
    if (!r.ok) return 10
    const j = await r.json()
    return j.halfHourFee || j.fastestFee || j.economyFee || 10
  } catch {
    return 10
  }
}

/** @returns {Promise<string>} 交易 id */
export async function payFeeWithUniSat(toAddress, satoshis = FEE_SATS) {
  const u = window.unisat
  if (!u?.sendBitcoin) throw new Error('当前 UniSat 版本不支持 sendBitcoin')
  const feeRate = await recommendedFeeRate()
  const txid = await u.sendBitcoin(toAddress, satoshis, { feeRate })
  return typeof txid === 'string' ? txid : txid?.txid || String(txid)
}

/** OKX 扩展：按文档使用 send，金额单位为 BTC 字符串 */
export async function payFeeWithOKX(fromAddress, toAddress, btcAmount = '0.059') {
  const btc = window.okxwallet?.bitcoin
  if (!btc?.send) throw new Error('当前 OKX 版本不支持 bitcoin.send')
  const result = await btc.send({
    from: fromAddress,
    to: toAddress,
    value: btcAmount,
  })
  return result?.txhash || result?.txid || String(result)
}

export function getConfiguredFeeRecipient() {
  const v = import.meta.env.VITE_FEE_RECIPIENT
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 当前会话能否在页面内调用扩展发起固定 BTC 手续费转账（见 SERVICE_FEE_BTC）。
 * Ordinals Wallet 若走 UniSat 兼容连接，通常存在 window.unisat.sendBitcoin。
 */
export function feeSendModeFromSession(session) {
  if (!session?.id) return null
  if (session.id === 'okx' && window.okxwallet?.bitcoin?.send) return 'okx'
  if (session.id === 'unisat' && window.unisat?.sendBitcoin) return 'unisat'
  if (session.id === 'ordinals' && window.unisat?.sendBitcoin) return 'unisat'
  return null
}

/** @returns {Promise<{ txid: string }>} */
export async function executeServiceFeePayment(walletSession) {
  const recipient = getConfiguredFeeRecipient()
  if (!recipient) throw new Error('未配置收款地址 VITE_FEE_RECIPIENT')
  const mode = feeSendModeFromSession(walletSession)
  if (!mode) {
    throw new Error('当前钱包不支持在此页发起转账，请使用 UniSat 或 OKX；Ordinals Wallet 需已注入 UniSat 接口')
  }
  if (mode === 'okx') {
    const txid = await payFeeWithOKX(walletSession.address, recipient, String(SERVICE_FEE_BTC))
    return { txid }
  }
  const txid = await payFeeWithUniSat(recipient)
  return { txid }
}

export const SERVICE_FEE_BTC = 0.059
export const SERVICE_FEE_SATS = FEE_SATS
