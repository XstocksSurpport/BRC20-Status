/**
 * Bitcoin / Ordinals 钱包连接（浏览器扩展注入）。
 * 各钱包 API 略有差异，此处按官方文档与常见注入名做适配。
 */
import Wallet from 'sats-connect'
import { AddressPurpose, setDefaultProvider, removeDefaultProvider } from 'sats-connect'

const XVERSE_PROVIDER_ID = 'XverseProviders.BitcoinProvider'

export async function disconnectWalletSession() {
  removeDefaultProvider()
  try {
    await Wallet.disconnect()
  } catch {
    /* 非 sats-connect 钱包或未建立会话 */
  }
}

function firstAddr(accounts) {
  if (!accounts) return null
  if (typeof accounts === 'string') return accounts
  if (Array.isArray(accounts)) {
    const a = accounts[0]
    if (typeof a === 'string') return a
    if (a && typeof a === 'object' && a.address) return a.address
  }
  if (typeof accounts === 'object' && accounts.address) return accounts.address
  return null
}

async function connectUniSat() {
  const u = window.unisat
  if (!u?.requestAccounts) throw new Error('未检测到 UniSat 扩展，请先安装并刷新页面')
  const accounts = await u.requestAccounts()
  const addr = firstAddr(accounts)
  if (!addr) throw new Error('未获取到地址')
  return { address: addr, addresses: Array.isArray(accounts) ? accounts : [addr] }
}

async function connectXverse() {
  if (!window.XverseProviders?.BitcoinProvider) {
    throw new Error('未检测到 Xverse 扩展，请先安装并刷新页面')
  }
  setDefaultProvider(XVERSE_PROVIDER_ID)
  const res = await Wallet.request('wallet_connect', {
    addresses: [AddressPurpose.Ordinals, AddressPurpose.Payment],
  })
  if (res.status !== 'success') {
    const msg = res.error?.message || '用户取消或连接失败'
    throw new Error(msg)
  }
  const list = res.result?.addresses || []
  const ord = list.find((x) => x.purpose === 'ordinals')
  const pay = list.find((x) => x.purpose === 'payment')
  const addr = ord?.address || pay?.address || list[0]?.address
  if (!addr) throw new Error('未获取到地址')
  return { address: addr, addresses: list.map((x) => x.address).filter(Boolean) }
}

async function connectOKX() {
  const btc = window.okxwallet?.bitcoin
  if (!btc?.connect) throw new Error('未检测到 OKX Wallet 扩展（比特币），请先安装并刷新页面')
  const result = await btc.connect()
  const addr = result?.address || firstAddr(result)
  if (!addr) throw new Error('未获取到地址')
  return { address: addr, addresses: [addr] }
}

async function connectPhantom() {
  const p = window.phantom?.bitcoin
  if (!p?.isPhantom) throw new Error('未检测到 Phantom（比特币）扩展，请先安装并刷新页面')
  const accounts = await p.requestAccounts()
  const list = Array.isArray(accounts) ? accounts : []
  const ord = list.find((a) => a.purpose === 'ordinals')
  const pay = list.find((a) => a.purpose === 'payment')
  const addr = ord?.address || pay?.address || list[0]?.address
  if (!addr) throw new Error('未获取到地址')
  return { address: addr, addresses: list.map((x) => x.address).filter(Boolean) }
}

async function connectLeather() {
  const lp = window.LeatherProvider
  if (!lp?.request) throw new Error('未检测到 Leather 扩展，请先安装并刷新页面')
  const r = await lp.request('getAddresses')
  const payload = r?.result ?? r
  const addresses = payload?.addresses || payload
  const arr = Array.isArray(addresses) ? addresses : []
  const taproot = arr.find((a) => a.type === 'p2tr' || a?.purpose === 'ordinals')
  const segwit = arr.find((a) => a.type === 'p2wpkh' || a?.purpose === 'payment')
  const addr =
    taproot?.address ||
    segwit?.address ||
    arr[0]?.address ||
    (typeof addresses === 'string' ? addresses : null)
  if (!addr) throw new Error('未获取到地址')
  return { address: addr, addresses: arr.map((x) => x.address).filter(Boolean) }
}

async function connectOrdinalsWallet() {
  const candidates = [window.ordinalsWallet, window.Ordinalswallet, window.ordinals].filter(Boolean)
  for (const api of candidates) {
    if (typeof api.requestAccounts === 'function') {
      const accounts = await api.requestAccounts()
      const addr = firstAddr(accounts)
      if (addr) return { address: addr, addresses: Array.isArray(accounts) ? accounts : [addr] }
    }
  }
  if (window.unisat?.requestAccounts) {
    const accounts = await window.unisat.requestAccounts()
    const addr = firstAddr(accounts)
    if (addr) {
      return {
        address: addr,
        addresses: Array.isArray(accounts) ? accounts : [addr],
        note: '通过 UniSat 兼容接口连接（部分环境下 Ordinals Wallet 与 UniSat 共用接口）',
      }
    }
  }
  throw new Error(
    '未检测到 Ordinals Wallet 扩展。请从官网安装扩展后刷新；若已安装仍失败，可改用 UniSat / Xverse 连接。',
  )
}

async function connectOYL() {
  const candidates = [window.oyl, window.oylWallet, window.OylWallet, window.oylBitcoin].filter(Boolean)
  for (const api of candidates) {
    if (typeof api.requestAccounts === 'function') {
      const accounts = await api.requestAccounts()
      const addr = firstAddr(accounts)
      if (addr) return { address: addr, addresses: Array.isArray(accounts) ? accounts : [addr] }
    }
    if (typeof api.connect === 'function') {
      const result = await api.connect()
      const addr = result?.address || firstAddr(result)
      if (addr) return { address: addr, addresses: [addr] }
    }
  }
  throw new Error('未检测到 OYL 扩展，请先安装 Oyl Wallet 并刷新页面')
}

async function connectTap() {
  const candidates = [window.tapwallet, window.TapWallet, window.tap, window.TapProtocol].filter(Boolean)
  for (const api of candidates) {
    if (typeof api.requestAccounts === 'function') {
      const accounts = await api.requestAccounts()
      const addr = firstAddr(accounts)
      if (addr) return { address: addr, addresses: Array.isArray(accounts) ? accounts : [addr] }
    }
    if (typeof api.connect === 'function') {
      const result = await api.connect()
      const addr = result?.address || firstAddr(result)
      if (addr) return { address: addr, addresses: [addr] }
    }
  }
  throw new Error('未检测到 Tap Wallet 扩展，请先安装并刷新页面')
}

const connectors = {
  unisat: connectUniSat,
  xverse: connectXverse,
  okx: connectOKX,
  phantom: connectPhantom,
  leather: connectLeather,
  ordinals: connectOrdinalsWallet,
  oyl: connectOYL,
  tap: connectTap,
}

export function detectWallet(id) {
  switch (id) {
    case 'unisat':
      return !!window.unisat?.requestAccounts
    case 'xverse':
      return !!window.XverseProviders?.BitcoinProvider
    case 'okx':
      return !!window.okxwallet?.bitcoin?.connect
    case 'phantom':
      return !!window.phantom?.bitcoin?.isPhantom
    case 'leather':
      return !!window.LeatherProvider?.request
    case 'ordinals':
      return (
        [window.ordinalsWallet, window.Ordinalswallet, window.ordinals].some((x) => x?.requestAccounts) ||
        !!window.unisat?.requestAccounts
      )
    case 'oyl':
      return [window.oyl, window.oylWallet, window.OylWallet].some((x) => x?.requestAccounts || x?.connect)
    case 'tap':
      return [window.tapwallet, window.TapWallet, window.tap].some((x) => x?.requestAccounts || x?.connect)
    default:
      return false
  }
}

export async function connectByWalletId(walletId) {
  const fn = connectors[walletId]
  if (!fn) throw new Error('未知钱包')
  return fn()
}

export function clearSatsConnectProvider() {
  try {
    removeDefaultProvider()
  } catch {
    /* ignore */
  }
}

