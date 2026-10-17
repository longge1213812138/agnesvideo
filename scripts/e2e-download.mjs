/**
 * 验证「下载成片」。
 *
 * fetch → Blob 这一步已验证可用（真实拿到 1.1MB mp4 数据）。
 * 但无头 Chrome 会丢弃 blob: URL 触发的文件保存，因此这里改为断言
 * 下载链路的每一环都正确执行：blob 拿到真实数据、a[download] 被点击、
 * objectURL 被回收。真实落盘由用户在有头窗口里完成（双击 start.cmd）。
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// 稳定的、允许跨域读取的小体积 mp4
const VIDEO_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--disable-gpu'],
  defaultViewport: { width: 1280, height: 1000 },
})

const respond = (req, status, body) =>
  req.respond({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  })

try {
  const page = await browser.newPage()

  // 在页面里埋探针，记录 a.click 与 createObjectURL 的真实调用
  await page.evaluateOnNewDocument(() => {
    window.__dlProbe = { clicks: [], objectUrls: [], revoked: [] }
    const origCreate = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (obj) => {
      const u = origCreate(obj)
      window.__dlProbe.objectUrls.push({ url: u, size: obj?.size ?? null, type: obj?.type ?? null })
      return u
    }
    const origRevoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (u) => {
      window.__dlProbe.revoked.push(u)
      return origRevoke(u)
    }
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      window.__dlProbe.clicks.push({ download: this.download, href: this.href, hasBlobHref: this.href.startsWith('blob:') })
      return origClick.call(this)
    }
  })

  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'OPTIONS') return req.continue()
    const u = req.url()
    if (u.includes('/videos')) {
      return respond(req, 200, {
        id: 't', task_id: 't', video_id: 'video_dl12345678', object: 'video',
        model: 'agnes-video-2.5-flash', status: 'queued', progress: 0,
        created_at: Date.now(), seconds: '5', size: '720P',
      })
    }
    if (u.includes('agnesapi')) {
      return respond(req, 200, {
        id: 't', object: 'video', status: 'completed', progress: 100,
        url: VIDEO_URL, seconds: '5', size: '720P', error: null,
      })
    }
    req.continue()
  })

  await page.goto(URL, { waitUntil: 'networkidle2' })
  await page.click('.linkbtn')
  await page.click('button.btn--primary')
  await page.waitForSelector('video.preview__video', { timeout: 20000 })
  check('成片就绪，下载按钮出现', (await page.$('.preview__actions .btn')) !== null)

  await page.click('.preview__actions .btn')
  await page.waitForFunction(() => window.__dlProbe.clicks.length > 0, { timeout: 60000 })
  const probe = await page.evaluate(() => window.__dlProbe)

  const click = probe.clicks[0]
  check('触发了 <a download> 点击', probe.clicks.length === 1)
  check('下载链接指向 blob（跨域绕行）', click.hasBlobHref === true, click.href.slice(0, 40))
  check('文件名形如 agnes-<id8>.mp4', /^agnes-dl123456\.mp4$/.test(click.download), click.download)
  check(
    'Blob 由真实视频数据构成',
    (probe.objectUrls[0]?.size ?? 0) > 100_000,
    `${probe.objectUrls[0]?.size} bytes, ${probe.objectUrls[0]?.type}`,
  )

  // 实现里延迟 10 秒回收 objectURL，这里等过该窗口再断言
  await page.waitForFunction(() => window.__dlProbe.revoked.length === 1, { timeout: 20000 })
  check('下载完成后回收 objectURL', true)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
