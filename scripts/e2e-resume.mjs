/**
 * 验证刷新恢复：页面刷新后，进行中的任务不能被当作失败，
 * 必须转为「已停止轮询」并可继续等待（ADR-0003）。
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
  let queryState = 'in_progress'

  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'OPTIONS') return req.continue()
    const u = req.url()
    if (u.includes('/videos')) {
      return respond(req, 200, {
        id: 't', task_id: 't', video_id: 'video_resume1', object: 'video',
        model: 'agnes-video-2.5-flash', status: 'queued', progress: 0,
        created_at: Date.now(), seconds: '5', size: '720P',
      })
    }
    if (u.includes('agnesapi')) {
      if (queryState === 'in_progress') {
        return respond(req, 200, {
          id: 't', object: 'video', status: 'in_progress', progress: 60, url: null,
          seconds: '5', size: '720P', error: null,
        })
      }
      return respond(req, 200, {
        id: 't', object: 'video', status: 'completed', progress: 100,
        url: 'https://example.com/done.mp4', seconds: '5', size: '720P', error: null,
      })
    }
    req.continue()
  })

  await page.goto(APP_URL, { waitUntil: 'networkidle2' })
  await page.click('.linkbtn')
  await page.click('button.btn--primary')
  await page.waitForFunction(() => /60%/.test(document.body.innerText), { timeout: 20000 })
  check('任务进入生成中', true, '60%')

  // 刷新：模拟"关掉窗口再打开"
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1500))
  const textAfter = await page.$eval('body', (el) => el.innerText)
  check('刷新后任务仍存在', /历史记录/.test(textAfter) && (await page.$$eval('.card', (e) => e.length)) === 1)
  check('刷新后不被误判为失败', !/生成失败/.test(textAfter))
  check('刷新后转为「已停止轮询」', /已停止轮询/.test(textAfter))
  check('提示服务端可能仍在生成', /服务端可能仍在生成/.test(textAfter))
  await page.screenshot({ path: '.shot/13-resume.png' })

  // 点「继续等待」应恢复轮询并最终完成
  queryState = 'completed'
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find((x) => /继续等待/.test(x.textContent ?? ''))
    b?.click()
  })
  await page.waitForSelector('video.preview__video', { timeout: 20000 })
  check('继续等待后取回成片', true)
  const statusText = await page.$eval('.card__status', (el) => el.textContent)
  check('卡片状态更新为已完成', /已完成/.test(statusText ?? ''), statusText ?? '')
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
