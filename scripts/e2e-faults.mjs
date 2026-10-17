/**
 * 故障注入验证：不依赖 Agnes 是否可用，直接拦截网络层断言前端行为。
 * 用法：node scripts/e2e-faults.mjs
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
mkdirSync('.shot', { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 场景 B 里 503 后要等满 30 秒退避，因此该场景的超时留足余量
const B_SCENARIO_TIMEOUT = 180_000
void sleep

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1280, height: 1000 },
})

try {
  // ---- 场景 A：网络完全不通 ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.url().includes('agnes-ai.com')) req.abort('failed')
      else req.continue()
    })
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForSelector('.banner', { timeout: 20000 })
    const text = await page.$eval('.banner', (el) => el.innerText)
    check('断网时显示网络错误', /无法连接 Agnes 服务/.test(text), text.split('\n')[0])
    check('断网提示给出可操作建议', /网络/.test(text))
    const card = await page.$$eval('.card', (els) => els.length)
    check('断网失败也记录到历史', card >= 1, `${card} 条`)
    await page.close()
  }

  // ---- 场景 B：503 队列满，验证自动重试横幅 ----
  {
    const page = await browser.newPage()
    let attempts = 0
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const u = req.url()
      // CORS 预检必须交回网络，否则浏览器会判定预检失败并拦截真实请求
      if (req.method() === 'OPTIONS') {
        req.continue()
        return
      }
      if (u.includes('agnes-ai.com') && req.method() === 'POST') {
        attempts += 1
        // 前一次返回队列满，第二次返回成功，验证重试后的成功路径
        if (attempts <= 1) {
          req.respond({
            status: 503,
            contentType: 'application/json',
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
              'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
            },
            body: JSON.stringify({ code: 'video_queue_full', message: 'video queue is full, please retry later' }),
          })
          return
        }
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            id: 'task_mock',
            task_id: 'task_mock',
            video_id: 'video_mock123456',
            object: 'video',
            model: 'agnes-video-2.5-flash',
            status: 'queued',
            progress: 0,
            created_at: Date.now(),
            seconds: '5',
            size: '720P',
          }),
        })
        return
      }
      if (u.includes('agnesapi')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            id: 'task_mock',
            object: 'video',
            status: 'in_progress',
            progress: 45,
            url: null,
            created_at: Date.now(),
            started_at: Date.now(),
            completed_at: null,
            expires_at: null,
            seconds: '5',
            size: '720P',
            quality: 'standard',
            remixed_from_video_id: null,
            error: null,
          }),
        })
        return
      }
      req.continue()
    })

    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')

    // 第一轮 503 后应出现自动重试横幅
    await page.waitForSelector('.banner--wait', { timeout: 15000 })
    const waitText = await page.$eval('.banner--wait', (el) => el.innerText)
    check('队列满时显示自动重试横幅', /服务端生成队列已满/.test(waitText), waitText.split('\n')[0])
    check('横幅说明不产生费用', /不会产生费用/.test(waitText))

    // 倒计时确实在走：等 3 秒后秒数应减少
    const n1 = Number((waitText.match(/(\d+)\s*秒后自动重试/) ?? [])[1] ?? -1)
    await new Promise((r) => setTimeout(r, 3000))
    const waitText2 = await page.$eval('.banner--wait', (el) => el.innerText)
    const n2 = Number((waitText2.match(/(\d+)\s*秒后自动重试/) ?? [])[1] ?? -1)
    check('重试倒计时逐秒递减', n1 > 0 && n2 > 0 && n2 < n1, `${n1}s → ${n2}s`)
    await page.screenshot({ path: '.shot/05-retrying.png' })

    // 503 默认退避 30 秒；两次 503 后第三次成功，再进入轮询
    await page.waitForFunction(() => /45%/.test(document.body.innerText), { timeout: B_SCENARIO_TIMEOUT })
    check('重试成功后进入轮询并显示进度', true, '45%')
    const statusText = await page.$eval('.card__status', (el) => el.textContent)
    check('历史卡片反映生成中状态', /生成中/.test(statusText ?? ''), statusText ?? '')
    await page.screenshot({ path: '.shot/06-progress.png' })
    await page.close()
  }

  // ---- 场景 C：任务失败（status=failed） ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const u = req.url()
      if (req.method() === 'OPTIONS') {
        req.continue()
        return
      }
      if (u.includes('/videos') && req.method() === 'POST') {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            id: 'task_f',
            task_id: 'task_f',
            video_id: 'video_fail9876',
            object: 'video',
            model: 'agnes-video-2.5-flash',
            status: 'queued',
            progress: 0,
            created_at: Date.now(),
            seconds: '5',
            size: '720P',
          }),
        })
        return
      }
      if (u.includes('agnesapi')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            id: 'task_f',
            object: 'video',
            status: 'failed',
            progress: 100,
            url: null,
            error: { message: 'Invalid reference media' },
          }),
        })
        return
      }
      req.continue()
    })

    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForFunction(() => /生成失败/.test(document.body.innerText), { timeout: 30000 })
    check('任务 failed 时标记为生成失败', true)
    const bannerText = await page.$eval('.banner', (el) => el.innerText)
    check('失败原因取服务端 error.message', /Invalid reference media/.test(bannerText), '已保留原文')
    await page.screenshot({ path: '.shot/07-failed.png' })
    await page.close()
  }

  // ---- 场景 D：429 退避不弹错误 ----
  {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    let polls = 0
    page.on('request', (req) => {
      const u = req.url()
      if (req.method() === 'OPTIONS') {
        req.continue()
        return
      }
      if (u.includes('/videos') && req.method() === 'POST') {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            id: 't',
            task_id: 't',
            video_id: 'video_429test',
            object: 'video',
            model: 'agnes-video-2.5-flash',
            status: 'queued',
            progress: 0,
            created_at: Date.now(),
            seconds: '5',
            size: '720P',
          }),
        })
        return
      }
      if (u.includes('agnesapi')) {
        polls += 1
        if (polls === 1) {
          req.respond({
            status: 429,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*', 'retry-after': '1' },
            body: JSON.stringify({ error: { message: 'rate limit', code: 'rate_limit_exceeded' } }),
          })
          return
        }
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ id: 't', object: 'video', status: 'completed', progress: 100, url: 'https://example.com/a.mp4' }),
        })
        return
      }
      req.continue()
    })

    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForFunction(() => !!document.querySelector('video.preview__video'), { timeout: 30000 })
    check('429 后自动退避并最终完成', true, `轮询 ${polls} 次`)
    const errBanner = await page.$('.banner')
    check('429 不弹出错误横幅', errBanner === null)
    await page.close()
  }
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
