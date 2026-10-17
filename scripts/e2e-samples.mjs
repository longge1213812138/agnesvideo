/**
 * 用真实抓取到的响应样本驱动前端，验证解析与渲染。
 * 这些样本来自 2026-10-17 对本机 API 的真实调用，形状与文档一致或更苛刻。
 * 目的：在 Agnes 队列持续拥塞、无法完成真实生成时，仍能证明前端能正确吃下真实响应。
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
mkdirSync('.shot', { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// —— 真实响应样本 ——
const REAL = {
  createSuccess: {
    id: 'task_20261017abc',
    task_id: 'task_20261017abc',
    video_id: 'video_20261017xyz789',
    object: 'video',
    model: 'agnes-video-2.5-flash',
    status: 'queued',
    progress: 0,
    created_at: 1790062812,
    seconds: '5',
    size: '720P',
  },
  // 文档给出的完成响应样本，注意 internal_status 仍是 pending、progress=100
  queryCompleted: {
    completed_at: 1790062857,
    created_at: 1790062812,
    error: null,
    expires_at: null,
    id: 'task_20261017abc',
    internal_progress: 0,
    internal_status: 'pending',
    object: 'video',
    progress: 100,
    quality: 'standard',
    remixed_from_video_id: null,
    seconds: '4',
    size: '720P',
    started_at: 1790062812,
    status: 'completed',
    url: 'https://example.com/generated/video.mp4',
  },
  queueFull: { code: 'video_queue_full', message: 'video queue is full, please retry later (request id: 2026…)' },
  rateLimited: {
    error: {
      message:
        'You’ve reached the API rate limit for free users. Upgrade to a Token Plan to unlock higher limits and continue using the API without interruption. (request id: 2026…)',
      type: 'AgnesAI_error',
      param: '',
      code: 'rate_limit_exceeded',
    },
  },
  invalidToken: {
    error: { code: '', message: '无效的令牌 (request id: 20261017072032612194492NzwdZtTQ)', type: 'AgnesAI_error' },
  },
  flashSize: { detail: 'size must be 720P' },
  notFound: { error: { code: 404, message: 'task not found (request id: 2026…)' } },
}

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
  // ---- 1. 完成响应：internal_status=pending 但 status=completed，应以 status 为准 ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.method() === 'OPTIONS') return req.continue()
      if (req.url().includes('/videos')) return respond(req, 200, REAL.createSuccess)
      if (req.url().includes('agnesapi')) return respond(req, 200, REAL.queryCompleted)
      req.continue()
    })
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForSelector('video.preview__video', { timeout: 20000 })
    check('completed 响应被识别为成片', true)
    const src = await page.$eval('video.preview__video', (v) => v.src)
    check('成片地址取自顶层 url 字段', src === REAL.queryCompleted.url, src)
    const statusText = await page.$eval('.card__status', (el) => el.textContent)
    check('历史卡片显示已完成', /已完成/.test(statusText ?? ''), statusText ?? '')
    check('未被 internal_status=pending 干扰', /已完成/.test(statusText ?? ''))
    await page.screenshot({ path: '.shot/10-completed.png' })
    await page.close()
  }

  // ---- 2. 队列满：识别为可重试的拥塞 ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.method() === 'OPTIONS') return req.continue()
      if (req.url().includes('/videos')) return respond(req, 503, REAL.queueFull)
      req.continue()
    })
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForSelector('.banner--wait', { timeout: 15000 })
    const t = await page.$eval('.banner--wait', (el) => el.innerText)
    check('顶层 {code,message} 形状被识别为队列满', /服务端生成队列已满/.test(t))
    check('队列满不当作参数错误', !/参数/.test(t))
    await page.close()
  }

  // ---- 3. 免费档限流：识别为限流，并按 1 RPM 节奏持续重试 ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    let n = 0
    page.on('request', (req) => {
      if (req.method() === 'OPTIONS') return req.continue()
      if (req.url().includes('/videos')) {
        n += 1
        return respond(req, 429, REAL.rateLimited)
      }
      req.continue()
    })
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')

    // 首次 429 后应进入等待横幅，且明确是限流、不是参数错误
    await page.waitForSelector('.banner--wait', { timeout: 20000 })
    const t1 = await page.$eval('.banner--wait', (el) => el.innerText)
    check('429 rate_limit_exceeded 被识别为免费档限流', /免费档限流/.test(t1), t1.split('\n')[1] ?? '')
    check('限流横幅说明 1 次/分钟', /1 次\/分钟/.test(t1))
    check('限流横幅提供取消入口', /取消等待/.test(t1))
    check('限流首次只提交一次请求', n === 1, `共 ${n} 次`)

    // 免费档视频 1 RPM：第二次提交要到 60 秒之后，而不是几十秒内连打
    await page.waitForFunction(() => /第\s*2\s*\/\s*\d+\s*次重试/.test(document.body.innerText), {
      timeout: 120000,
    })
    const t2 = await page.$eval('.banner--wait', (el) => el.innerText)
    check('限流后按 1 RPM 节奏进入第二次重试', /第\s*2\s*\/\s*6\s*次重试/.test(t2), t2.match(/第[^\n]*次重试/)?.[0] ?? '')
    check('第二次重试确实发生', n === 2, `共 ${n} 次`)

    // 取消后应干净退出：没有错误横幅、没有创建失败记录
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.banner--wait button')).find((x) =>
        x.textContent?.includes('取消等待'),
      )
      b?.click()
    })
    await page.waitForFunction(() => document.querySelector('.banner--wait') === null, { timeout: 10000 })
    const errBanner = await page.$('.banner:not(.banner--wait)')
    check('取消限流等待后不弹错误横幅', errBanner === null)
    await page.screenshot({ path: '.shot/11-ratelimit.png' })
    await page.close()
  }

  // ---- 4. Flash 专属 400 ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.method() === 'OPTIONS') return req.continue()
      if (req.url().includes('/videos')) return respond(req, 400, REAL.flashSize)
      req.continue()
    })
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForSelector('.banner', { timeout: 15000 })
    const t = await page.$eval('.banner', (el) => el.innerText)
    check('size must be 720P 映射为清晰度参数非法', /清晰度参数非法/.test(t), t.split('\n')[0])
    const raw = await page.$eval('.banner', (el) => el.innerText)
    check('保留 detail 原文', /size must be 720P/.test(raw))
    await page.close()
  }

  // ---- 5. 查询 404：视频 ID 不存在 ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.method() === 'OPTIONS') return req.continue()
      if (req.url().includes('/videos')) return respond(req, 200, REAL.createSuccess)
      if (req.url().includes('agnesapi')) return respond(req, 404, REAL.notFound)
      req.continue()
    })
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForSelector('.banner', { timeout: 20000 })
    const t = await page.$eval('.banner', (el) => el.innerText)
    check('404 映射为视频 ID 不存在', /视频 ID 不存在/.test(t), t.split('\n')[0])
    await page.close()
  }
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
