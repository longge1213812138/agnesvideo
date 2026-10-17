/**
 * 验证队列满等待横幅的取消路径。
 * 依据 docs/research/2026-10-17-video-queue-full.md：队列满可能持续很久，
 * 用户必须有随时退出的手段，且取消不应留下"创建失败"记录。
 * 用法：node scripts/e2e-cancel-wait.mjs
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1280, height: 1000 },
})

try {
  const page = await browser.newPage()
  let posts = 0
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const u = req.url()
    if (req.method() === 'OPTIONS') return req.continue()
    if (u.includes('/videos') && req.method() === 'POST') {
      posts += 1
      // 始终队列满：模拟实测中"等待也不会恢复"的情形
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
    req.continue()
  })

  await page.goto(URL, { waitUntil: 'networkidle2' })
  await page.click('.linkbtn')
  await page.click('button.btn--primary')

  await page.waitForSelector('.banner--wait', { timeout: 15000 })
  const text = await page.$eval('.banner--wait', (el) => el.innerText)
  check('队列满时进入等待横幅', /服务端生成队列已满/.test(text), text.split('\n')[0])
  check('横幅明示不产生费用', /不会产生费用/.test(text))
  check('横幅显示重试进度', /第\s*1\s*\/\s*\d+\s*次重试/.test(text), text.match(/第[^\n]*次重试/)?.[0] ?? '')

  // 等待若干秒后取消
  await new Promise((r) => setTimeout(r, 4000))
  const banner = await page.$eval('.banner--wait', (el) => el.innerText)
  const cancelBtn = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.banner--wait button')).find((x) =>
      x.textContent?.includes('取消等待'),
    )
    if (!b) return false
    b.click()
    return true
  })
  check('横幅提供「取消等待」按钮', cancelBtn)
  void banner

  // 取消后：横幅消失、无错误横幅、无创建失败记录
  await page.waitForFunction(() => document.querySelector('.banner--wait') === null, { timeout: 10000 })
  check('取消后等待横幅消失', true)

  await new Promise((r) => setTimeout(r, 1200))
  const errBanner = await page.$('.banner:not(.banner--wait)')
  check('取消不弹出错误横幅', errBanner === null)

  const cards = await page.$$eval('.card', (els) => els.map((e) => e.innerText))
  check('取消不留下"创建失败"记录', cards.every((c) => !/创建失败/.test(c)), `${cards.length} 条记录`)
  await page.screenshot({ path: '.shot/12-cancel-wait.png' })

  // 取消后应能立刻重新提交（不被 60 秒节流锁死）
  const btnEnabled = await page.$eval('button.btn--primary', (b) => !b.disabled)
  check('取消后按钮恢复可用', btnEnabled === true)

  check('全程只提交了一次创建请求', posts === 1, `POST ${posts} 次`)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
