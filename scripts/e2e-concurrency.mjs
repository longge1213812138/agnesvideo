/**
 * 验证并发上限：最多 3 个任务同时轮询，其余排队（设计共识 Q3）。
 * 用截图之外的网络计数断言，避免依赖界面文案。
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
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
  const page = await browser.newPage()
  // 记录每个 video_id 被轮询了几次
  const pollsByVideo = new Map()
  let created = 0

  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'OPTIONS') return req.continue()
    const u = req.url()
    if (u.includes('/videos')) {
      created += 1
      const vid = `video_conc_${created}`
      return respond(req, 200, {
        id: 't', task_id: 't', video_id: vid, object: 'video',
        model: 'agnes-video-2.5-flash', status: 'queued', progress: 0,
        created_at: Date.now(), seconds: '5', size: '720P',
      })
    }
    if (u.includes('agnesapi')) {
      const vid = new URL(u).searchParams.get('video_id')
      pollsByVideo.set(vid, (pollsByVideo.get(vid) ?? 0) + 1)
      return respond(req, 200, {
        id: 't', object: 'video', status: 'in_progress', progress: 30, url: null,
        seconds: '5', size: '720P', error: null,
      })
    }
    req.continue()
  })

  await page.goto(APP_URL, { waitUntil: 'networkidle2' })

  // 依次提交 5 个任务
  for (let i = 0; i < 5; i++) {
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    await page.waitForFunction((n) => document.querySelectorAll('.card').length >= n, {}, i + 1)
  }

  check('5 个任务都已创建', created === 5, `${created} 个`)
  const cards = await page.$$eval('.card', (els) => els.length)
  check('历史里有 5 条记录', cards === 5, `${cards} 条`)

  // 等若干轮询周期，让并发差异显现
  await new Promise((r) => setTimeout(r, 12000))

  const running = [...pollsByVideo.entries()].filter(([, n]) => n > 0)
  check('同时在轮询的任务不超过 3 个', running.length <= 3, `实际 ${running.length} 个正在轮询`)
  check('多出的任务进入排队而非被丢弃', pollsByVideo.size + 2 >= 3, `已轮询 ${pollsByVideo.size} 个`)

  const bodyText = await page.$eval('body', (el) => el.innerText)
  check('界面显示排队数量', /排队/.test(bodyText), (bodyText.match(/\d+ 个排队中/) ?? ['无'])[0])
  check('顶部显示并发上限', /\/3 生成中/.test(bodyText), (bodyText.match(/\d+\/3 生成中/) ?? ['无'])[0])
  await page.screenshot({ path: '.shot/12-concurrency.png' })
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
