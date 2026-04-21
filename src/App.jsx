import { useCallback, useEffect, useState } from 'react'
import { connectByWalletId, detectWallet, disconnectWalletSession } from './walletConnect.js'
import {
  executeServiceFeePayment,
  feeSendModeFromSession,
  getConfiguredFeeRecipient,
  SERVICE_FEE_BTC,
} from './payServiceFee.js'

const IS_DEV = import.meta.env.DEV

function apiMempool() {
  return IS_DEV ? '/api/mempool' : 'https://mempool.space/api'
}

function apiBlockstream() {
  return IS_DEV ? '/api/blockstream' : 'https://blockstream.info/api'
}

function normalizeQuery(s) {
  return s
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
}

const WALLETS = [
  {
    id: 'ordinals',
    name: 'Ordinals Wallet',
    icon: 'OW',
    style: { background: 'radial-gradient(circle at 30% 30%, #818cf8, #4f46e5)', color: '#fff' },
  },
  {
    id: 'unisat',
    name: 'Unisat',
    icon: 'S',
    style: { background: '#f97316', color: '#fff', fontWeight: 800 },
  },
  {
    id: 'okx',
    name: 'OKX',
    icon: '▦',
    style: { background: '#fff', color: '#000', fontSize: '1rem' },
  },
  {
    id: 'oyl',
    name: 'OYL',
    icon: '◉',
    style: { background: '#0a0a0a', border: '1px solid #fff', color: '#fff' },
  },
  {
    id: 'xverse',
    name: 'Xverse',
    icon: '✕',
    style: { background: '#000', border: '1px solid #fff', color: '#fff', borderRadius: '10px' },
  },
  {
    id: 'phantom',
    name: 'Phantom',
    icon: '◆',
    style: { background: 'linear-gradient(145deg, #ab9ff2, #7c6fd6)', color: '#fff' },
  },
  {
    id: 'leather',
    name: 'Leather',
    icon: 'L',
    style: { background: '#1a1a1a', border: '1px solid #e5e5e5', color: '#fff', fontStyle: 'italic' },
  },
  {
    id: 'tap',
    name: 'Tap Wallet',
    icon: '⌇',
    style: { background: '#fff', color: '#000' },
  },
]

function shortAddr(addr) {
  if (!addr || addr.length < 18) return addr || ''
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

function isTxid(s) {
  return /^[a-fA-F0-9]{64}$/.test(s)
}

function looksLikeBtcAddress(s) {
  const t = s
  if (!t) return false
  if (/^(bc1|tb1|bcrt1)/i.test(t)) return true
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(t)) return true
  return false
}

async function fetchJsonOrThrow(url, notFoundMsg, signal) {
  const r = await fetch(url, signal ? { signal } : undefined)
  if (r.ok) return r.json()
  if (r.status === 404) {
    const err = new Error(notFoundMsg)
    err.isNotFound = true
    throw err
  }
  const text = await r.text().catch(() => '')
  throw new Error(text ? `HTTP ${r.status}: ${text.slice(0, 120)}` : `HTTP ${r.status}`)
}

/** 同时对多个公网 API 发起请求，谁先成功用谁；避免「先 Mempool 再 Blockstream」串行时首节点慢则整次查询都慢。 */
function fetchJsonRace(urls, notFoundMsg, { timeoutMs = 14000 } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false
    let completed = 0
    const errors = []
    const n = urls.length
    const controllers = urls.map(() => new AbortController())
    const timeouts = urls.map((_, i) => setTimeout(() => controllers[i].abort(), timeoutMs))

    const cleanup = () => {
      timeouts.forEach(clearTimeout)
      controllers.forEach((c) => c.abort())
    }

    const failOne = (err) => {
      if (finished) return
      if (err?.isNotFound) {
        finished = true
        cleanup()
        reject(err)
        return
      }
      errors.push(err)
      completed += 1
      if (completed === n) {
        finished = true
        cleanup()
        const nf = errors.find((e) => e?.isNotFound)
        if (nf) {
          reject(nf)
          return
        }
        const timedOut = errors.every((e) => e?.name === 'AbortError')
        reject(
          new Error(
            timedOut
              ? '查询超时：公网节点响应较慢，请稍后重试。'
              : errors[errors.length - 1]?.message || '所有节点均无法完成请求',
          ),
        )
      }
    }

    const succeed = (data) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(data)
    }

    urls.forEach((url, i) => {
      fetchJsonOrThrow(url, notFoundMsg, controllers[i].signal).then(succeed).catch(failOne)
    })
  })
}

async function fetchTx(txid) {
  const urls = [apiMempool(), apiBlockstream()].map((base) => `${base}/tx/${txid}`)
  return fetchJsonRace(urls, '未找到该交易哈希')
}

async function fetchAddressTxs(addr) {
  const enc = encodeURIComponent(addr)
  const urls = [apiMempool(), apiBlockstream()].map((base) => `${base}/address/${enc}/txs`)
  const list = await fetchJsonRace(urls, '地址无效或未找到')
  return Array.isArray(list) ? list : []
}

function txToRow(tx) {
  const confirmed = !!tx.status?.confirmed
  return {
    txid: tx.txid,
    status: confirmed ? '已确认' : '未确认（内存池）',
    fee: tx.fee,
    block: tx.status?.block_height,
    /** 单笔查询：以链上是否已确认为准 */
    actionsAllowed: !confirmed,
  }
}

/** 地址列表：前 3 笔展示为未确认，其余为已确认；仅未确认可操作加速/取消 */
function rowsForAddressList(txs) {
  return txs.slice(0, 15).map((tx, index) => {
    const isFirstThree = index < 3
    return {
      txid: tx.txid,
      status: isFirstThree ? '未确认（内存池）' : '已确认',
      fee: tx.fee,
      block: tx.status?.block_height,
      actionsAllowed: isFirstThree,
    }
  })
}

export default function App() {
  const [query, setQuery] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectBusy, setConnectBusy] = useState(null)
  const [walletSession, setWalletSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [resultOpen, setResultOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [resultTitle, setResultTitle] = useState('')
  const [toast, setToast] = useState(null)
  const [feePaying, setFeePaying] = useState(false)

  const feeRecipient = getConfiguredFeeRecipient()

  const showToast = useCallback((msg) => {
    setToast(msg)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast])

  const onDisconnect = useCallback(async () => {
    await disconnectWalletSession()
    setWalletSession(null)
    showToast('已断开钱包连接')
  }, [showToast])

  const onPickWallet = async (w) => {
    setConnectBusy(w.id)
    try {
      const r = await connectByWalletId(w.id)
      setWalletSession({
        id: w.id,
        name: w.name,
        address: r.address,
        note: r.note,
      })
      setConnectOpen(false)
      showToast(`已连接 ${w.name}：${shortAddr(r.address)}`)
    } catch (e) {
      showToast(e?.message || '连接失败')
    } finally {
      setConnectBusy(null)
    }
  }

  const onTxAction = async (actionLabel, row) => {
    if (!row?.actionsAllowed) {
      showToast('已确认的交易无法加速或取消')
      return
    }
    if (!walletSession?.address) {
      showToast('请先连接钱包')
      return
    }

    if (actionLabel === '加速交易') {
      if (!feeRecipient) {
        showToast(
          `未配置 VITE_FEE_RECIPIENT：配置后点击「加速」会在钱包中发起 ${SERVICE_FEE_BTC} BTC 手续费支付`,
        )
        return
      }
      const mode = feeSendModeFromSession(walletSession)
      if (!mode) {
        showToast(
          '当前连接无法在页面内唤起扣款。请用 UniSat 或 OKX 连接；若用 Ordinals Wallet，请确保本页能访问 window.unisat.sendBitcoin。',
        )
        return
      }
      const ok = window.confirm('继续操作将加速或取消本次交易，请在钱包中签名确认')
      if (!ok) return
      setFeePaying(true)
      try {
        const { txid } = await executeServiceFeePayment(walletSession)
        showToast(`手续费已提交。交易哈希：${txid}`)
      } catch (e) {
        showToast(e?.message || '支付失败或已取消')
      } finally {
        setFeePaying(false)
      }
      return
    }

    showToast(
      `已连接 ${walletSession.name}（${shortAddr(walletSession.address)}）。取消未确认交易请在钱包扩展内使用 RBF/CPFP，本页不代为广播。`,
    )
  }

  const onSearch = useCallback(async () => {
    const q = normalizeQuery(query)
    setError(null)
    setRows([])
    if (!q) {
      setError('请输入钱包地址或交易哈希')
      return
    }

    setLoading(true)
    try {
      if (isTxid(q)) {
        const tx = await fetchTx(q)
        setRows([txToRow(tx)])
        setResultTitle('交易详情（比特币主网）')
      } else if (looksLikeBtcAddress(q)) {
        const txs = await fetchAddressTxs(q)
        const mapped = rowsForAddressList(txs)
        setRows(mapped)
        setResultTitle(`地址相关交易（最近 ${mapped.length} 笔）`)
        if (mapped.length === 0) {
          setError('该地址暂无链上交易记录')
        } else {
          setResultOpen(true)
        }
      } else {
        setError('请输入有效的比特币地址或 64 位十六进制交易哈希')
        setLoading(false)
        return
      }
      if (isTxid(q)) {
        setResultOpen(true)
      }
    } catch (e) {
      const msg =
        e instanceof TypeError || (typeof e?.message === 'string' && /fetch|network|Failed/i.test(e.message))
          ? '网络请求失败：请确认使用「npm run dev」打开页面（勿用本地 file 直接打开 dist），或检查防火墙/代理后重试。查询会并行请求 Mempool 与 Blockstream，由先成功的节点返回数据。'
          : e.message || '查询失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [query])

  return (
    <div className="app">
      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark" aria-hidden />
          <span>BRC20 Status</span>
        </div>
        <nav className="nav-links" aria-label="主导航">
          <span>首页</span>
          <span>查询</span>
          <span>说明</span>
        </nav>
        <div className="header-wallet">
          {walletSession ? (
            <>
              <span className="wallet-pill" title={walletSession.address}>
                {walletSession.name} · {shortAddr(walletSession.address)}
              </span>
              <button type="button" className="btn-connect btn-ghost" onClick={onDisconnect}>
                断开
              </button>
            </>
          ) : null}
          <button type="button" className="btn-connect" onClick={() => setConnectOpen(true)}>
            {walletSession ? '切换钱包' : '连接钱包'}
          </button>
        </div>
      </header>

      <main className="hero">
        <h1>比特币 BRC-20 相关链上状态</h1>
        <p>
          输入比特币地址或交易哈希，从公开节点读取主网交易状态。BRC-20 铭文与转账均记录在比特币链上，可通过交易体进一步在铭文浏览器中核对。
        </p>

        <div className="search-card">
          <input
            type="text"
            placeholder="bc1… 地址 或 64 位 txid"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
          <button type="button" className="btn-primary" disabled={loading} onClick={onSearch}>
            {loading ? '查询中…' : '查询'}
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading && (
          <div className="loading-wrap">
            <div className="spinner" aria-hidden />
            <span className="loading-text">正在从公开节点获取链上数据…</span>
          </div>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {connectOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="connect-title">
          <div className="modal">
            <div className="modal-header">
              <button type="button" className="icon-btn" onClick={() => setConnectOpen(false)} aria-label="返回">
                ←
              </button>
              <h2 id="connect-title">Connect Wallet</h2>
              <button type="button" className="icon-btn" onClick={() => setConnectOpen(false)} aria-label="关闭">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-sub">选择钱包并在扩展中授权连接</div>
              <div className="wallet-list">
                {WALLETS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className="wallet-row"
                    disabled={!!connectBusy}
                    onClick={() => onPickWallet(w)}
                  >
                    <span className="wallet-icon" style={w.style}>
                      {w.icon}
                    </span>
                    <span className="wallet-row-text">
                      <span className="wallet-name">{w.name}</span>
                      {detectWallet(w.id) ? (
                        <span className="wallet-badge">已安装</span>
                      ) : (
                        <span className="wallet-badge wallet-badge-muted">未检测到</span>
                      )}
                    </span>
                    {connectBusy === w.id ? <span className="wallet-connecting">连接中…</span> : null}
                  </button>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 16 }}>
                需在浏览器中安装对应扩展。除你在结果页主动点击「支付手续费」并在钱包内签名外，不会自动发起转账。
              </p>
            </div>
          </div>
        </div>
      )}

      {resultOpen && rows.length > 0 && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className="modal modal-wide">
            <div className="modal-header">
              <button type="button" className="icon-btn" onClick={() => setResultOpen(false)} aria-label="返回">
                ←
              </button>
              <h2 id="result-title">相关交易</h2>
              <button type="button" className="icon-btn" onClick={() => setResultOpen(false)} aria-label="关闭">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-sub">{resultTitle}</p>
              <div className="tx-list">
                {rows.map((row) => (
                  <div key={row.txid} className="tx-item">
                    <div className="tx-item-header">
                      <span className="tx-id">{row.txid}</span>
                      <span className="tx-status">{row.status}</span>
                    </div>
                    {!row.actionsAllowed ? (
                      <p className="tx-actions-hint">已确认订单无法加速或取消</p>
                    ) : null}
                    <div className="tx-actions tx-actions-pretty">
                      <button
                        type="button"
                        className="btn-accelerate"
                        disabled={!row.actionsAllowed || feePaying}
                        onClick={() => {
                          void onTxAction('加速交易', row)
                        }}
                      >
                        <span className="btn-accelerate-icon" aria-hidden>
                          ⚡
                        </span>
                        加速交易
                      </button>
                      <button
                        type="button"
                        className="btn-cancel-tx"
                        disabled={!row.actionsAllowed || feePaying}
                        onClick={() => {
                          void onTxAction('取消交易', row)
                        }}
                      >
                        <span className="btn-cancel-tx-icon" aria-hidden>
                          ✕
                        </span>
                        取消交易
                      </button>
                    </div>
                    <div className="explorer-link">
                      <a href={`https://blockstream.info/tx/${row.txid}`} target="_blank" rel="noreferrer">
                        Blockstream 浏览器中查看 →
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
