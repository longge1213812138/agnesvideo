/**
 * 启动器：起一个本地静态服务，再用 Edge 的 --app 模式打开无地址栏窗口。
 *
 * 选本地 HTTP 而不是 file:// 的原因：file:// 的 origin 是 null，
 * localStorage 在部分策略下会被判为 opaque 而失效，历史记录可能悄悄丢失。
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
}

/** 在给定的候选端口上找第一个可用的。 */
function listen(server, port) {
  return new Promise((res, rej) => {
    const onError = (e) => {
      server.off('listening', onListening)
      rej(e)
    }
    const onListening = () => {
      server.off('error', onError)
      res(server.address().port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

async function bindAnyPort(server, candidates) {
  let lastErr
  for (const p of candidates) {
    try {
      return await listen(server, p)
    } catch (e) {
      lastErr = e
      if (e.code !== 'EADDRINUSE') throw e
    }
  }
  // 全部占用时退回系统随机端口
  try {
    return await listen(server, 0)
  } catch {
    throw lastErr
  }
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const rel = normalize(decoded).replace(/^([/\\])+/, '')
  const abs = join(DIST, rel || 'index.html')
  // 防目录穿越
  if (!abs.startsWith(DIST + sep) && abs !== DIST) return null
  return abs
}

function findEdge() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? null
}

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('\n[启动失败] 找不到 dist/index.html。')
    console.error('请先构建：pnpm build\n')
    process.exit(1)
  }

  const server = createServer(async (req, res) => {
    try {
      const abs = safePath(req.url ?? '/')
      if (!abs) {
        res.writeHead(403).end('forbidden')
        return
      }
      let target = abs
      try {
        const st = await stat(target)
        if (st.isDirectory()) target = join(target, 'index.html')
      } catch {
        // 未知路径回落单页入口
        target = join(DIST, 'index.html')
      }
      const body = await readFile(target)
      res.writeHead(200, {
        'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })

  const port = await bindAnyPort(server, [5178, 5179, 5180, 5181])
  const url = `http://127.0.0.1:${port}/`

  // 独立的用户数据目录，避免与日常 Edge 实例冲突导致 --app 被并入已有窗口
  const profileDir = join(ROOT, '.edge-profile')
  const browser = findEdge() ?? findChrome()

  console.log(`[Agnes Video Studio] 本地服务已就绪：${url}`)
  console.log('关闭窗口后按 Ctrl+C 或直接关掉本窗口即可退出。')

  if (browser) {
    // 不 detach：浏览器进程生命周期与本启动器绑定，
    // 用户关掉窗口即结束本进程，不会残留后台 Node 与孤儿浏览器进程。
    const child = spawn(
      browser,
      [
        `--app=${url}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,900',
      ],
      { stdio: 'ignore' },
    )
    child.on('exit', () => {
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 800)
    })
    child.on('error', (e) => {
      console.error('[启动失败] 无法启动浏览器：', e.message)
      console.log(`请手动在浏览器打开：${url}`)
    })
  } else {
    console.log('未找到 Edge/Chrome，请手动在浏览器打开上面的地址。')
  }

  process.on('SIGINT', () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 800)
  })
}

main().catch((e) => {
  console.error('[启动失败]', e)
  process.exit(1)
})
